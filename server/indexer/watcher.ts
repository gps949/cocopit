import { watch, type FSWatcher as NodeFsWatcher } from "node:fs";
import { join } from "node:path";
import type { IndexScheduler, ScanSource } from "./scheduler";

export interface FsWatcherOptions {
  debounceMs?: number;
  pollMs?: number;
  /** Test hook: rely on the poll fallback only. */
  disableWatch?: boolean;
}

/**
 * Debounced fs.watch over <claudeDir>/projects with a periodic poll fallback
 * (recursive watch can drop events). Change signals just kick an incremental
 * runScan — computeWork picks out the files that actually changed. Events that
 * arrive while a scan runs set a dirty flag and one follow-up scan runs after.
 */
export class FsWatcher {
  #scheduler: IndexScheduler;
  #sources: ScanSource[];
  #debounceMs: number;
  #pollMs: number;
  #disableWatch: boolean;
  #watchers: NodeFsWatcher[] = [];
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #scanning = false;
  #dirty = false;
  #stopped = true;

  constructor(scheduler: IndexScheduler, input: string | ScanSource[], opts: FsWatcherOptions = {}) {
    this.#scheduler = scheduler;
    this.#sources = typeof input === "string" ? [{ profileId: "default", dir: input }] : input;
    this.#debounceMs = opts.debounceMs ?? 500;
    this.#pollMs = opts.pollMs ?? 5 * 60_000;
    this.#disableWatch = opts.disableWatch ?? false;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    if (!this.#disableWatch) {
      for (const source of this.#sources) {
        try {
          const sub = source.product === "codex" ? "sessions" : "projects";
          this.#watchers.push(
            watch(join(source.dir, sub), { recursive: true }, () => this.#onEvent()),
          );
        } catch {
          // watched dir missing or watch unsupported — the poll fallback covers us
        }
      }
    }
    this.#pollTimer = setInterval(() => this.#kick(), this.#pollMs);
  }

  stop(): void {
    this.#stopped = true;
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers = [];
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  #onEvent(): void {
    if (this.#stopped) return;
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#kick();
    }, this.#debounceMs);
  }

  #kick(): void {
    if (this.#stopped) return;
    if (this.#scanning) {
      this.#dirty = true;
      return;
    }
    this.#scanning = true;
    void this.#scheduler.runScan(this.#sources).finally(() => {
      this.#scanning = false;
      if (this.#dirty && !this.#stopped) {
        this.#dirty = false;
        this.#kick();
      }
    });
  }
}
