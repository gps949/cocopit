import { open } from "node:fs/promises";

export interface MessagePointer {
  seq: number;
  uuid: string;
  byte_offset: number;
  byte_len: number;
}

export interface MessageRecord {
  seq: number;
  uuid: string;
  record: unknown | null;
  byteLen: number;
  /** true when the body exceeded maxBodyBytes and was not read */
  truncated?: boolean;
  error?: string;
}

/** Real transcripts carry single lines up to ~10 MB (large tool results). */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

/**
 * Reads full message bodies straight from the session JSONL via stored byte
 * offsets — bodies are never stored in the index. Tolerates a file that has
 * changed underneath (per-row error instead of a failed request). Bodies over
 * maxBodyBytes are reported as truncated rather than materialized, so a page of
 * pointers can never blow up memory; fetch those one at a time.
 */
export async function readMessageRecords(
  filePath: string,
  pointers: MessagePointer[],
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<MessageRecord[]> {
  if (pointers.length === 0) return [];
  const handle = await open(filePath, "r");
  try {
    const out: MessageRecord[] = [];
    for (const pointer of pointers) {
      if (pointer.byte_len > maxBodyBytes) {
        out.push({
          seq: pointer.seq,
          uuid: pointer.uuid,
          record: null,
          byteLen: pointer.byte_len,
          truncated: true,
        });
        continue;
      }
      const buffer = Buffer.alloc(pointer.byte_len);
      const { bytesRead } = await handle.read(buffer, 0, pointer.byte_len, pointer.byte_offset);
      try {
        const text = buffer.subarray(0, bytesRead).toString("utf8");
        out.push({
          seq: pointer.seq,
          uuid: pointer.uuid,
          record: JSON.parse(text.trimEnd()),
          byteLen: pointer.byte_len,
        });
      } catch (err) {
        out.push({
          seq: pointer.seq,
          uuid: pointer.uuid,
          record: null,
          byteLen: pointer.byte_len,
          error: `stale offset: ${(err as Error).message}`,
        });
      }
    }
    return out;
  } finally {
    await handle.close();
  }
}
