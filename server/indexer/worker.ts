// Bun Worker: parses one JSONL file at a time and posts structured batches.
// No database access here — the main process is the single SQLite writer.
import { createReadStream } from "node:fs";
import { parseCodexLine, parseLine, type CodexContext, type ParsedLine } from "./parser";
import { LineSplitter } from "./scanner-lines";

export interface WorkerJob {
  path: string;
  startOffset: number;
  seqStart: number;
  /** Absent means Claude Code. */
  product?: "claude" | "codex";
  /** Needed by the Codex parser to synthesize globally-unique uuids. */
  sessionId?: string;
}

export type WorkerReply =
  | { type: "batch"; lines: ParsedLine[] }
  | { type: "done"; consumedBytes: number }
  | { type: "error"; message: string };

const BATCH_SIZE = 2000;

declare var self: Worker;

self.onmessage = async (event: MessageEvent) => {
  const job = event.data as WorkerJob;
  try {
    const splitter = new LineSplitter(job.startOffset);
    let seq = job.seqStart;
    let batch: ParsedLine[] = [];
    const codexCtx: CodexContext | null =
      job.product === "codex" ? { sessionId: job.sessionId ?? "unknown" } : null;

    const stream = createReadStream(job.path, { start: job.startOffset });
    for await (const chunk of stream) {
      for (const raw of splitter.push(chunk as Uint8Array)) {
        batch.push(codexCtx ? parseCodexLine(raw, seq++, codexCtx) : parseLine(raw, seq++));
        if (batch.length >= BATCH_SIZE) {
          postMessage({ type: "batch", lines: batch } satisfies WorkerReply);
          batch = [];
        }
      }
    }
    if (batch.length > 0) {
      postMessage({ type: "batch", lines: batch } satisfies WorkerReply);
    }
    postMessage({ type: "done", consumedBytes: splitter.consumedBytes } satisfies WorkerReply);
  } catch (err) {
    postMessage({ type: "error", message: (err as Error).message } satisfies WorkerReply);
  }
};
