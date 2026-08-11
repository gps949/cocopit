import { open } from "node:fs/promises";
import { LineSplitter } from "../indexer/scanner-lines";
import { DEFAULT_MAX_BODY_BYTES, type MessageRecord } from "./sessionReader";

export interface SubagentTranscript {
  records: MessageRecord[];
  /** Lines in the whole file, so the UI can page without reading it twice. */
  total: number;
  /** true when the file grew past what one pass will scan. */
  truncatedFile: boolean;
}

export interface SubagentReadOptions {
  offset?: number;
  limit?: number;
  maxBodyBytes?: number;
  /** Read granularity; exposed so tests can force chunk-boundary conditions. */
  chunkBytes?: number;
}

/** A subagent transcript is a task delegation, not a conversation — this is plenty. */
const MAX_LINES = 20_000;

/**
 * Subagent transcripts live in their own JSONL files, indexed for cost but never
 * parsed into the message table — so unlike session messages there are no stored
 * byte offsets to seek with, and the file has to be walked. Walking is done in
 * one streaming pass that keeps only the requested window's bytes, so a 6 MB
 * transcript costs one read, not one read per record.
 */
export async function readSubagentTranscript(
  filePath: string,
  options: SubagentReadOptions = {},
): Promise<SubagentTranscript> {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? 200);
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  const handle = await open(filePath, "r");
  try {
    const records: MessageRecord[] = [];
    let seq = 0;
    let truncatedFile = false;

    const buffer = Buffer.alloc(options.chunkBytes ?? 1 << 20);
    let position = 0;
    // splitting on bytes, not on per-chunk strings: a CJK character straddling a
    // read boundary decodes correctly only if the split happens before decoding
    const splitter = new LineSplitter();

    const emit = (line: string, byteLen: number) => {
      if (seq >= offset && records.length < limit) {
        if (byteLen > maxBodyBytes) {
          records.push({ seq, uuid: "", record: null, byteLen, truncated: true });
        } else {
          try {
            const record = JSON.parse(line) as { uuid?: string };
            records.push({ seq, uuid: record.uuid ?? "", record, byteLen });
          } catch (err) {
            records.push({ seq, uuid: "", record: null, byteLen, error: (err as Error).message });
          }
        }
      }
      seq += 1;
    };

    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;

      for (const line of splitter.push(buffer.subarray(0, bytesRead))) {
        const text = line.text.trimEnd();
        if (text) emit(text, line.byteLen);
      }
      if (seq >= MAX_LINES) {
        truncatedFile = true;
        break;
      }
    }
    // LineSplitter never emits a partial trailing line; a transcript still being
    // written ends without \n, so flush whatever it is holding
    for (const line of splitter.push(new Uint8Array(0))) {
      const text = line.text.trimEnd();
      if (text) emit(text, line.byteLen);
    }

    return { records, total: seq, truncatedFile };
  } finally {
    await handle.close();
  }
}
