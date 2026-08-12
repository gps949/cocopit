import { existsSync, mkdirSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { LineSplitter } from "../indexer/scanner-lines";

/**
 * Claude Code names a project's storage directory after its working directory,
 * with the separators and dots flattened to dashes — so a hidden directory
 * produces a double dash. Verified against the names on this machine.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

export interface HandOffOptions {
  sourceFile: string;
  targetConfigDir: string;
  cwd: string;
  newSessionId: string;
  /** Read granularity; exposed so tests can force chunk-boundary conditions. */
  chunkBytes?: number;
}

/**
 * Copies a conversation into another profile so it can be continued there.
 *
 * `claude --resume` takes a session id and looks for it under its own config
 * directory, so continuing a conversation under a different account means the
 * transcript has to exist there. The copy takes a fresh id — session ids are the
 * index's primary key, and the same id under two profiles would have the two
 * files overwrite each other's row.
 *
 * Only the top-level sessionId field is rewritten. A blind string replace would
 * also hit the id wherever it appears inside the conversation (paths, logs,
 * things Claude said), corrupting the transcript to fix a header.
 *
 * Message uuids are deliberately kept: they are what identifies the two
 * sessions as one conversation, so the console can show where this came from.
 */
export async function handOffSession(
  options: HandOffOptions,
): Promise<{ path: string; records: number }> {
  const projectDir = join(options.targetConfigDir, "projects", encodeProjectDir(options.cwd));
  const targetPath = join(projectDir, `${options.newSessionId}.jsonl`);
  if (existsSync(targetPath)) {
    throw new Error(`目标已存在,拒绝覆盖:${targetPath}`);
  }
  mkdirSync(projectDir, { recursive: true });

  const source = await open(options.sourceFile, "r");
  const target = await open(targetPath, "wx");
  try {
    const buffer = Buffer.alloc(options.chunkBytes ?? 1 << 20);
    const splitter = new LineSplitter();
    let position = 0;
    let records = 0;

    const write = async (line: string) => {
      if (!line.trim()) return;
      let out = line;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        if (typeof record.sessionId === "string") {
          record.sessionId = options.newSessionId;
          out = JSON.stringify(record);
        }
      } catch {
        // an unparseable line is copied through untouched rather than dropped
      }
      await target.write(out + "\n");
      records += 1;
    };

    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      for (const line of splitter.push(buffer.subarray(0, bytesRead))) await write(line.text);
    }
    for (const line of splitter.push(new Uint8Array(0))) await write(line.text);

    return { path: targetPath, records };
  } finally {
    await source.close();
    await target.close();
  }
}
