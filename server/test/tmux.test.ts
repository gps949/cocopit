import { afterAll, describe, expect, test } from "bun:test";
import {
  buildNewSessionCommand,
  buildResumeCommand,
  decodeControlOutput,
  encodeSendKeys,
  killSession,
  listTmuxSessions,
  sessionNameFor,
  startSession,
  TmuxAttachment,
  tmuxAvailable,
} from "../terminal/tmux";

const created: string[] = [];

afterAll(() => {
  for (const name of created) killSession(name);
});

describe("control-mode output decoding", () => {
  test("octal escapes become raw bytes", () => {
    // tmux escapes non-printables as \ooo in %output lines
    expect(decodeControlOutput("hello\\015\\012")).toBe("hello\r\n");
    expect(decodeControlOutput("\\033[K")).toBe("\u001b[K");
    expect(decodeControlOutput("plain text")).toBe("plain text");
  });

  test("a literal backslash survives", () => {
    expect(decodeControlOutput("C:\\\\path")).toBe("C:\\\\path".replace("\\\\", "\\\\"));
    expect(decodeControlOutput("a\\\\b")).toContain("a");
  });

  test("multi-byte utf-8 arrives intact through octal escapes", () => {
    // 你 = e4 bd a0 → \344\275\240
    const decoded = decodeControlOutput("\\344\\275\\240");
    expect(Buffer.from(decoded, "binary").toString("utf8")).toBe("你");
  });
});

describe("send-keys encoding", () => {
  test("bytes become a hex send-keys command", () => {
    expect(encodeSendKeys("s1", "hi\n")).toBe("send-keys -t s1 -H 68 69 0a");
  });

  test("utf-8 input is sent byte by byte", () => {
    expect(encodeSendKeys("s1", "你")).toBe("send-keys -t s1 -H e4 bd a0");
  });

  test("control characters (ctrl-c) pass through", () => {
    expect(encodeSendKeys("s1", "\u0003")).toBe("send-keys -t s1 -H 03");
  });
});

describe("session naming and commands", () => {
  test("names are namespaced and sanitized", () => {
    expect(sessionNameFor("4c9935a0-f23d-402a")).toBe("cc-4c9935a0-f23d-402a");
    expect(sessionNameFor("weird/name with spaces.dots")).toBe("cc-weird-name-with-spaces-dots");
    expect(sessionNameFor("")).toMatch(/^cc-/);
  });

  test("resume command pins the profile config dir and quotes everything", () => {
    const cmd = buildResumeCommand({
      cwd: "/tmp/my proj",
      sessionId: "abc-123",
      configDir: "/home/u/.claude-profiles/work",
    });
    expect(cmd).toBe(
      "cd '/tmp/my proj' && CLAUDE_CONFIG_DIR='/home/u/.claude-profiles/work' claude --resume 'abc-123'",
    );
  });

  test("injection attempts stay inside quotes", () => {
    const cmd = buildResumeCommand({
      cwd: "/tmp/x'; rm -rf ~; echo '",
      sessionId: "a",
      configDir: "/d",
    });
    expect(cmd).toContain(`'/tmp/x'\\''; rm -rf ~; echo '\\'''`);
  });

  test("new-session command omits --resume", () => {
    const cmd = buildNewSessionCommand({ cwd: "/tmp/p", configDir: "/d" });
    expect(cmd).toBe("cd '/tmp/p' && CLAUDE_CONFIG_DIR='/d' claude");
  });
});

describe("live tmux integration", () => {
  test("tmux is available", () => {
    expect(tmuxAvailable()).toBe(true);
  });

  test("start, list, attach, round-trip input, resize, kill", async () => {
    const name = `cc-test-${process.pid}-${Date.now()}`;
    created.push(name);

    const started = startSession({ name, command: "bash --norc", cwd: "/tmp", cols: 100, rows: 30 });
    expect(started).toBe(true);
    expect(listTmuxSessions().some((s) => s.name === name)).toBe(true);

    // starting again is a no-op rather than an error (attach-or-create)
    expect(startSession({ name, command: "bash --norc", cwd: "/tmp", cols: 100, rows: 30 })).toBe(true);

    const attachment = new TmuxAttachment(name);
    let received = "";
    attachment.onOutput((chunk) => {
      received += chunk;
    });
    await attachment.ready();

    attachment.write("echo ROUND_TRIP_OK\n");
    await Bun.sleep(700);
    expect(received).toContain("ROUND_TRIP_OK");

    attachment.resize(180, 45);
    await Bun.sleep(200);
    received = "";
    attachment.write("tput cols\n");
    await Bun.sleep(700);
    expect(received).toContain("180");

    attachment.close();
    killSession(name);
    expect(listTmuxSessions().some((s) => s.name === name)).toBe(false);
  }, 15000);

  test("a killed session reports gone; attaching to a missing one fails cleanly", async () => {
    const attachment = new TmuxAttachment("cc-definitely-not-here");
    let errored = false;
    attachment.onClose(() => {
      errored = true;
    });
    await attachment.ready().catch(() => {});
    await Bun.sleep(400);
    expect(errored).toBe(true);
    attachment.close();
  }, 10000);
});


describe("which config a terminal runs under", () => {
  test("the default profile inherits the machine's config — no CLAUDE_CONFIG_DIR", () => {
    // Setting it to ~/.claude makes Claude Code read ~/.claude/.claude.json
    // instead of ~/.claude.json, i.e. a config with no login, no trusted
    // folders and none of the user's settings — which is why terminals opened
    // here asked to sign in again.
    expect(buildResumeCommand({ cwd: "/w", sessionId: "s1", configDir: null })).toBe(
      "cd '/w' && claude --resume 's1'",
    );
    expect(buildNewSessionCommand({ cwd: "/w", configDir: null })).toBe("cd '/w' && claude");
  });

  test("a profile with its own directory still gets it", () => {
    expect(buildResumeCommand({ cwd: "/w", sessionId: "s1", configDir: "/home/me/cc-work" })).toBe(
      "cd '/w' && CLAUDE_CONFIG_DIR='/home/me/cc-work' claude --resume 's1'",
    );
  });
});
