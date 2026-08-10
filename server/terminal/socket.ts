import type { ServerWebSocket, WebSocketHandler } from "bun";
import { hasSession, TmuxAttachment } from "./tmux";

export interface TerminalSocketData {
  name: string;
  attachment: TmuxAttachment | null;
}

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

/**
 * Bridges one browser socket to one tmux control-mode client. The tmux session
 * outlives the socket, so a dropped connection (laptop asleep, network blip)
 * loses nothing — reattaching replays the current screen and carries on.
 */
export function terminalWebSocketHandlers(): WebSocketHandler<TerminalSocketData> {
  return {
    open(ws: ServerWebSocket<TerminalSocketData>) {
      const { name } = ws.data;
      if (!hasSession(name)) {
        ws.send(JSON.stringify({ type: "error", message: `终端会话 ${name} 不存在或已结束` }));
        ws.close();
        return;
      }

      const attachment = new TmuxAttachment(name);
      ws.data.attachment = attachment;

      attachment.onOutput((chunk) => {
        ws.send(JSON.stringify({ type: "output", data: chunk }));
      });
      attachment.onClose((reason) => {
        ws.send(JSON.stringify({ type: "closed", reason }));
        try {
          ws.close();
        } catch {
          // socket already gone
        }
      });

      void attachment.ready().then(() => {
        // seed the viewport with what is already on screen
        const snapshot = attachment.snapshot();
        if (snapshot) {
          ws.send(JSON.stringify({ type: "snapshot", data: snapshot }));
        }
        ws.send(JSON.stringify({ type: "ready", name }));
      });
    },

    message(ws: ServerWebSocket<TerminalSocketData>, raw: string | Buffer) {
      const attachment = ws.data.attachment;
      if (!attachment) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === "input" && typeof msg.data === "string") {
        attachment.write(msg.data);
      } else if (msg.type === "resize") {
        attachment.resize(Number(msg.cols), Number(msg.rows));
      }
    },

    close(ws: ServerWebSocket<TerminalSocketData>) {
      // detach only — the tmux session keeps running
      ws.data.attachment?.close();
      ws.data.attachment = null;
    },
  };
}
