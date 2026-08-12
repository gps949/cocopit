import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

type Status = "connecting" | "ready" | "closed" | "error";

/** Theme-aware xterm palette drawn from the same CSS variables as the charts. */
function xtermTheme() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: v("--panel"),
    foreground: v("--ink"),
    cursor: v("--accent"),
    selectionBackground: v("--accent-soft"),
    black: v("--bg-side"),
    red: v("--danger"),
    green: v("--ok"),
    yellow: v("--accent-strong"),
    blue: "#5b7fa6",
    magenta: "#9a6b8f",
    cyan: "#5f8f8a",
    white: v("--ink"),
    brightBlack: v("--muted"),
  };
}

/**
 * Keys a touch keyboard cannot produce, but the Claude Code TUI depends on:
 * Esc interrupts, Tab completes, arrows drive its menus, ^C kills. Sequences
 * are what a real terminal would send.
 */
const TOUCH_KEYS: Array<{ label: string; seq: string }> = [
  { label: "Esc", seq: "\x1b" },
  { label: "Tab", seq: "\t" },
  { label: "^C", seq: "\x03" },
  { label: "↑", seq: "\x1b[A" },
  { label: "↓", seq: "\x1b[B" },
  { label: "←", seq: "\x1b[D" },
  { label: "→", seq: "\x1b[C" },
];

export function TerminalPane({ name, onClosed }: { name: string; onClosed?: () => void }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [message, setMessage] = useState<string>("");
  // bumping this remounts the connection — tmux holds the session, so
  // reconnecting after a phone lock/screen sleep is cheap and safe
  const [attempt, setAttempt] = useState(0);
  const sendRef = useRef<(data: string) => void>(() => {});
  // touch keyboards cannot send the keys the TUI needs; pointer:coarse is the
  // media feature that actually asks "is the primary input a finger"
  const [touch] = useState(() => window.matchMedia("(pointer: coarse)").matches);

  useEffect(() => {
    if (!hostRef.current) return;
    setStatus("connecting");
    setMessage("");

    const term = new XTerm({
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      theme: xtermTheme(),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/terminal/${encodeURIComponent(name)}/attach`);

    const send = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    };
    sendRef.current = send;

    const sendResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as {
        type: string;
        data?: string;
        reason?: string;
        message?: string;
      };
      switch (msg.type) {
        case "snapshot":
          term.write(msg.data ?? "");
          break;
        case "output":
          term.write(msg.data ?? "");
          break;
        case "ready":
          setStatus("ready");
          sendResize();
          break;
        case "closed":
          setStatus("closed");
          setMessage(msg.reason ?? t("会话已结束"));
          onClosed?.();
          break;
        case "error":
          setStatus("error");
          setMessage(msg.message ?? t("连接失败"));
          break;
      }
    };
    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus((prev) => (prev === "error" ? prev : "closed"));

    const inputDisposable = term.onData(send);

    const observer = new ResizeObserver(() => sendResize());
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      inputDisposable.dispose();
      ws.close();
      term.dispose();
    };
  }, [name, onClosed, attempt]);

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) sendRef.current(text);
    } catch {
      // clipboard permission denied — nothing sensible to do
    }
  }

  const disconnected = status === "closed" || status === "error";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-xs text-muted">{name}</span>
        <div className="flex shrink-0 items-center gap-2">
          {/* phones kill background sockets on screen lock; tmux keeps the
              session, so offer the reattach right where the loss is noticed */}
          {disconnected && (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-ink"
            >
              {t("重新连接")}
            </button>
          )}
          <span
            className={`text-xs ${
              status === "ready" ? "text-ok" : status === "connecting" ? "text-muted" : "text-danger"
            }`}
          >
            {status === "ready"
              ? t("已连接")
              : status === "connecting"
                ? t("连接中…")
                : status === "closed"
                  ? `${t("已断开")}${message ? ` · ${message}` : ""}`
                  : `${t("错误")}${message ? ` · ${message}` : ""}`}
          </span>
        </div>
      </div>
      <div ref={hostRef} className="h-[60vh] max-h-[520px] min-h-[280px] w-full px-2 py-1" />
      {touch && status === "ready" && (
        <div className="flex items-center gap-1 overflow-x-auto border-t border-line px-2 py-1.5">
          {TOUCH_KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              onClick={() => sendRef.current(key.seq)}
              className="min-w-9 shrink-0 rounded-md border border-line px-2 py-1 font-mono text-xs text-muted active:bg-hover"
            >
              {key.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void pasteFromClipboard()}
            className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted active:bg-hover"
          >
            {t("粘贴")}
          </button>
        </div>
      )}
    </div>
  );
}
