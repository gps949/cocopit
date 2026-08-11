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

export function TerminalPane({ name, onClosed }: { name: string; onClosed?: () => void }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!hostRef.current) return;

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

    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });

    const observer = new ResizeObserver(() => sendResize());
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      inputDisposable.dispose();
      ws.close();
      term.dispose();
    };
  }, [name, onClosed]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-xs text-muted">{name}</span>
        <span
          className={`text-xs ${
            status === "ready" ? "text-ok" : status === "connecting" ? "text-muted" : "text-danger"
          }`}
        >
          {status === "ready"
            ? "已连接"
            : status === "connecting"
              ? "连接中…"
              : status === "closed"
                ? `已断开${message ? ` · ${message}` : ""}`
                : `错误${message ? ` · ${message}` : ""}`}
        </span>
      </div>
      <div ref={hostRef} className="h-[420px] w-full px-2 py-1" />
    </div>
  );
}
