/**
 * session_meta's originator names the surface that drove a Codex session. One
 * machine's rollouts mix CLI runs, Desktop imports, and ChatGPT-driven remote
 * tasks — the raw identifiers are cryptic, so map the known ones to plain
 * words and fall back to showing the identifier itself.
 */
export function originLabel(origin: string, t: (key: string) => string): string {
  const raw = origin.toLowerCase();
  if (raw === "codex_cli_rs" || raw === "codex-tui") return "CLI";
  if (raw === "codex desktop" || raw === "codex_work_desktop") return t("桌面版");
  if (raw === "codex_vscode") return "VS Code";
  if (raw.includes("chatgpt")) return t("ChatGPT 远程");
  if (raw === "codex_exec") return "exec";
  if (raw.includes("sdk")) return "SDK";
  if (raw.includes("chrome-extension")) return t("Chrome 扩展");
  return origin;
}

/** CLI is the default, unremarkable case — only other surfaces earn a badge. */
export function isNotableOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  const raw = origin.toLowerCase();
  return raw !== "codex_cli_rs" && raw !== "codex-tui";
}
