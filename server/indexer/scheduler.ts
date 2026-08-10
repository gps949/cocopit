import type { Database } from "bun:sqlite";
import { cpus } from "node:os";
import type { IndexStatus } from "../../shared/types";
import { listClaudeFiles } from "../cc/paths";
import { loadPricingTable } from "../cost/engine";
import { getPricingVersion } from "../cost/recalc";
import { Ingestor, type IngestPricing } from "./ingest";
import { computeWork, type WorkItem } from "./scanner";
import type { WorkerJob, WorkerReply } from "./worker";

export interface ScanSummary {
  workItems: number;
  filesDone: number;
  errors: number;
  durationMs: number;
}

export interface SchedulerOptions {
  workers?: number;
  pricing?: IngestPricing;
}

const EMIT_INTERVAL_MS = 500;

function idleStatus(): IndexStatus {
  return {
    phase: "idle",
    pct: 0,
    bytesTotal: 0,
    bytesDone: 0,
    filesTotal: 0,
    filesDone: 0,
    currentFiles: [],
    errors: 0,
  };
}

/**
 * Drives a scan: enumerate files, diff against cursors, fan work out to
 * parse-only workers, ingest batches on the main thread as they arrive.
 * Emits throttled "progress" CustomEvents carrying IndexStatus.
 */
export class IndexScheduler extends EventTarget {
  #db: Database;
  #workerCount: number;
  #pricing: IngestPricing | null;
  #running: Promise<ScanSummary> | null = null;
  #status: IndexStatus = idleStatus();
  #lastEmit = 0;

  constructor(db: Database, opts: SchedulerOptions = {}) {
    super();
    this.#db = db;
    this.#workerCount = opts.workers ?? Math.min(4, Math.max(2, cpus().length - 2));
    this.#pricing = opts.pricing ?? null;
  }

  #resolvePricing(): IngestPricing {
    if (!this.#pricing) {
      this.#pricing = { table: loadPricingTable(), version: getPricingVersion(this.#db) };
    }
    return this.#pricing;
  }

  /** Swap the live pricing used by future scans (after a PUT /api/pricing). */
  setPricing(pricing: IngestPricing): void {
    this.#pricing = pricing;
  }

  get status(): IndexStatus {
    return { ...this.#status, currentFiles: [...this.#status.currentFiles] };
  }

  /** Only one scan at a time; a re-entrant call joins the running scan. */
  runScan(claudeDir: string): Promise<ScanSummary> {
    if (this.#running) return this.#running;
    // flip synchronously so a status probe right after the call never sees the
    // previous scan's idle/pct=1 while file enumeration is still underway
    this.#status = { ...idleStatus(), phase: "scanning", startedAt: Date.now() };
    this.#emit(true);
    this.#running = this.#doScan(claudeDir).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #doScan(claudeDir: string): Promise<ScanSummary> {
    const t0 = performance.now();
    const tasks = await listClaudeFiles(claudeDir);
    const work = computeWork(this.#db, tasks);
    const bytesTotal = work.reduce((n, w) => n + Math.max(0, w.task.size - w.startOffset), 0);

    this.#status = {
      ...this.#status,
      bytesTotal,
      filesTotal: work.length,
    };
    this.#emit(true);

    if (work.length > 0) {
      const ingestor = new Ingestor(this.#db, this.#resolvePricing());
      const queue = [...work];
      const lanes = Math.min(this.#workerCount, work.length);
      await Promise.all(Array.from({ length: lanes }, () => this.#runLane(queue, ingestor)));
    }

    this.#db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('last_scan_at', $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run({ $v: String(Date.now()) });

    this.#status.phase = "idle";
    this.#status.pct = 1;
    this.#status.currentFiles = [];
    this.#status.finishedAt = Date.now();
    this.#emit(true);

    return {
      workItems: work.length,
      filesDone: this.#status.filesDone,
      errors: this.#status.errors,
      durationMs: performance.now() - t0,
    };
  }

  /** One worker lane: owns a Worker, pulls items off the shared queue until empty. */
  #runLane(queue: WorkItem[], ingestor: Ingestor): Promise<void> {
    return new Promise((resolve) => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      let current: WorkItem | null = null;

      const finishItem = () => {
        if (!current) return;
        const i = this.#status.currentFiles.indexOf(current.task.path);
        if (i >= 0) this.#status.currentFiles.splice(i, 1);
        this.#status.filesDone++;
        this.#updatePct();
        this.#emit();
      };

      const next = () => {
        current = queue.shift() ?? null;
        if (!current) {
          worker.terminate();
          resolve();
          return;
        }
        this.#status.currentFiles.push(current.task.path);
        ingestor.beginFile(current);
        const job: WorkerJob = {
          path: current.task.path,
          startOffset: current.startOffset,
          seqStart: current.seqStart,
        };
        worker.postMessage(job);
      };

      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data as WorkerReply;
        const item = current;
        if (!item) return;
        if (msg.type === "batch") {
          ingestor.applyBatch(item, msg.lines);
          this.#status.bytesDone += msg.lines.reduce((n, l) => n + l.byteLen, 0);
          this.#status.errors += msg.lines.reduce((n, l) => n + (l.ok ? 0 : 1), 0);
          this.#updatePct();
          this.#emit();
        } else if (msg.type === "done") {
          ingestor.finishFile(item, msg.consumedBytes);
          finishItem();
          next();
        } else {
          this.#status.errors++;
          finishItem();
          next();
        }
      };

      worker.onerror = () => {
        this.#status.errors++;
        finishItem();
        next();
      };

      next();
    });
  }

  #updatePct(): void {
    const { bytesTotal, bytesDone, filesTotal, filesDone } = this.#status;
    this.#status.pct =
      bytesTotal > 0 ? Math.min(1, bytesDone / bytesTotal) : filesTotal > 0 ? filesDone / filesTotal : 1;
  }

  #emit(force = false): void {
    const now = performance.now();
    if (!force && now - this.#lastEmit < EMIT_INTERVAL_MS) return;
    this.#lastEmit = now;
    this.dispatchEvent(new CustomEvent<IndexStatus>("progress", { detail: this.status }));
  }
}
