import type { Subprocess } from "bun";
import { shellQuote } from "../profiles/detect";

/**
 * Terminal backend built on tmux control mode (`tmux -C`), a line protocol
 * designed for programmatic clients: bidirectional I/O over plain pipes with no
 * pty of our own, and the session survives disconnects because tmux — not this
 * process — owns the child. (node-pty does not work under Bun; `script(1)`
 * needs a tty on its own stdin, so neither is an option here.)
 */

export interface StartSessionOptions {
  name: string;
  command: string;
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export function tmuxAvailable(): boolean {
  return Bun.spawnSync(["tmux", "-V"]).success;
}

/** tmux session names cannot contain `.` or `:`; keep them predictable. */
export function sessionNameFor(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `cc-${safe || "session"}`;
}

export function buildResumeCommand(opts: { cwd: string; sessionId: string; configDir: string }): string {
  return `cd ${shellQuote(opts.cwd)} && CLAUDE_CONFIG_DIR=${shellQuote(opts.configDir)} claude --resume ${shellQuote(opts.sessionId)}`;
}

export function buildNewSessionCommand(opts: { cwd: string; configDir: string }): string {
  return `cd ${shellQuote(opts.cwd)} && CLAUDE_CONFIG_DIR=${shellQuote(opts.configDir)} claude`;
}

export function hasSession(name: string): boolean {
  return Bun.spawnSync(["tmux", "has-session", "-t", `=${name}`]).success;
}

/** Creates the session if absent; returns true when it exists afterwards. */
export function startSession(opts: StartSessionOptions): boolean {
  if (hasSession(opts.name)) return true;
  const args = [
    "new-session",
    "-d",
    "-s",
    opts.name,
    "-x",
    String(opts.cols ?? 120),
    "-y",
    String(opts.rows ?? 32),
    "-c",
    opts.cwd,
    opts.command,
  ];
  const result = Bun.spawnSync(["tmux", ...args], {
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  return result.success && hasSession(opts.name);
}

export function killSession(name: string): void {
  Bun.spawnSync(["tmux", "kill-session", "-t", `=${name}`]);
}

export interface TmuxSessionInfo {
  name: string;
  windows: number;
  createdAt: number;
  attached: boolean;
}

export function listTmuxSessions(): TmuxSessionInfo[] {
  const result = Bun.spawnSync([
    "tmux",
    "list-sessions",
    "-F",
    "#{session_name}\t#{session_windows}\t#{session_created}\t#{session_attached}",
  ]);
  if (!result.success) return []; // no server running yet
  return new TextDecoder()
    .decode(result.stdout)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, windows, created, attached] = line.split("\t");
      return {
        name: name!,
        windows: Number(windows ?? 0),
        createdAt: Number(created ?? 0) * 1000,
        attached: attached !== "0",
      };
    });
}

/** tmux escapes non-printable bytes in %output as octal (\\ooo). */
export function decodeControlOutput(payload: string): string {
  return payload.replace(/\\([0-7]{3})/g, (_all, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/** Byte-exact input: send-keys -H takes hex, so any key or control char works. */
export function encodeSendKeys(sessionName: string, data: string): string {
  const hex = [...new TextEncoder().encode(data)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return `send-keys -t ${sessionName} -H ${hex}`;
}

type OutputHandler = (chunk: string) => void;
type CloseHandler = (reason: string) => void;

/**
 * One control-mode client attached to a tmux session. Output arrives as
 * `%output %<pane> <escaped>` lines; anything else is protocol chatter we
 * ignore apart from the fatal notifications.
 */
export class TmuxAttachment {
  #name: string;
  #proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  #outputHandlers: OutputHandler[] = [];
  #closeHandlers: CloseHandler[] = [];
  #buffer = "";
  #closed = false;
  #readyPromise: Promise<void>;

  constructor(name: string) {
    this.#name = name;
    this.#proc = Bun.spawn(["tmux", "-C", "attach", "-t", name], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.#readyPromise = this.#pump();
  }

  ready(): Promise<void> {
    return this.#readyPromise;
  }

  onOutput(handler: OutputHandler): void {
    this.#outputHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.#closeHandlers.push(handler);
    if (this.#closed) handler("already closed");
  }

  async #pump(): Promise<void> {
    const proc = this.#proc!;
    const decoder = new TextDecoder();

    void (async () => {
      let stderr = "";
      for await (const chunk of proc.stderr) stderr += decoder.decode(chunk);
      if (stderr.trim()) this.#fail(stderr.trim());
    })();

    void (async () => {
      for await (const chunk of proc.stdout) {
        this.#buffer += decoder.decode(chunk, { stream: true });
        let index: number;
        while ((index = this.#buffer.indexOf("\n")) >= 0) {
          const line = this.#buffer.slice(0, index);
          this.#buffer = this.#buffer.slice(index + 1);
          this.#handleLine(line);
        }
      }
      this.#fail("tmux client exited");
    })();

    // give tmux a moment to reject a missing session before callers write
    await Bun.sleep(150);
  }

  #handleLine(line: string): void {
    if (line.startsWith("%output ")) {
      const rest = line.slice("%output ".length);
      const space = rest.indexOf(" ");
      if (space < 0) return;
      const decoded = decodeControlOutput(rest.slice(space + 1));
      for (const handler of this.#outputHandlers) handler(decoded);
      return;
    }
    if (line.startsWith("%exit") || line.startsWith("%session-closed")) {
      this.#fail(line);
    }
  }

  #fail(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const handler of this.#closeHandlers) handler(reason);
  }

  /**
   * Current screen contents (with escapes) so a reconnecting client sees state.
   * capture-pane pads to the full pane height; keeping those blank rows would
   * push the live output that follows down to the bottom of the viewport.
   */
  snapshot(): string {
    const result = Bun.spawnSync(["tmux", "capture-pane", "-p", "-e", "-J", "-t", this.#name]);
    if (!result.success) return "";
    const text = new TextDecoder().decode(result.stdout);
    const lines = text.split("\n");
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
    return lines.length === 0 ? "" : lines.join("\r\n") + "\r\n";
  }

  write(data: string): void {
    if (this.#closed || !this.#proc) return;
    this.#proc.stdin.write(encodeSendKeys(this.#name, data) + "\n");
    this.#proc.stdin.flush();
  }

  resize(cols: number, rows: number): void {
    if (this.#closed || !this.#proc) return;
    this.#proc.stdin.write(`refresh-client -C ${Math.max(20, cols)},${Math.max(5, rows)}\n`);
    this.#proc.stdin.flush();
  }

  close(): void {
    this.#closed = true;
    try {
      this.#proc?.kill();
    } catch {
      // already gone
    }
    this.#proc = null;
  }
}
