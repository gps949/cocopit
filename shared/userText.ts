/**
 * Who actually said a thing.
 *
 * Claude Code writes several kinds of machine-generated content into records
 * with role "user": hook output, background-task notifications, slash-command
 * plumbing, and tool results. Rendering those as the human talking makes a
 * transcript incoherent — and putting them in the conversation outline buries
 * the handful of real turns. Server (snippets, outline) and web (transcript)
 * must agree on the rule, so it lives here rather than in either one.
 */

/** Tags whose contents the harness injected, never the human. */
export const SYSTEM_WRAPPER_TAGS = [
  "system-reminder",
  "task-notification",
  "user-prompt-submit-hook",
  "local-command-caveat",
  "local-command-stdout",
  "command-name",
  "command-message",
  "command-args",
] as const;

// requires a real tag: `<tag>` or `<tag attr="...">`, not the tag name in prose
const wrapperPattern = (tag: string) => new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi");

export function stripSystemWrappers(text: string): string {
  let out = text;
  for (const tag of SYSTEM_WRAPPER_TAGS) out = out.replace(wrapperPattern(tag), "");
  return out.trim();
}

/**
 * The human-authored text in a user record's content, or null when the record
 * carries no speech at all (pure tool result, pure notification, empty).
 */
export function humanUserText(content: unknown): string | null {
  if (typeof content === "string") {
    const text = stripSystemWrappers(content);
    return text || null;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const typed = block as { type?: unknown; text?: unknown };
      if (typed.type !== "text" || typeof typed.text !== "string") continue;
      const text = stripSystemWrappers(typed.text);
      if (text) parts.push(text);
    }
    return parts.length > 0 ? parts.join("\n") : null;
  }

  return null;
}
