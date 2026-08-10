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
  error?: string;
}

/**
 * Reads full message bodies straight from the session JSONL via stored byte
 * offsets — bodies are never stored in the index. Tolerates a file that has
 * changed underneath (per-row error instead of a failed request).
 */
export async function readMessageRecords(
  filePath: string,
  pointers: MessagePointer[],
): Promise<MessageRecord[]> {
  if (pointers.length === 0) return [];
  const handle = await open(filePath, "r");
  try {
    const out: MessageRecord[] = [];
    for (const pointer of pointers) {
      const buffer = Buffer.alloc(pointer.byte_len);
      const { bytesRead } = await handle.read(buffer, 0, pointer.byte_len, pointer.byte_offset);
      try {
        const text = buffer.subarray(0, bytesRead).toString("utf8");
        out.push({ seq: pointer.seq, uuid: pointer.uuid, record: JSON.parse(text.trimEnd()) });
      } catch (err) {
        out.push({
          seq: pointer.seq,
          uuid: pointer.uuid,
          record: null,
          error: `stale offset: ${(err as Error).message}`,
        });
      }
    }
    return out;
  } finally {
    await handle.close();
  }
}
