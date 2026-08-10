export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "ccockpit-theme";

export function loadTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function nextTheme(theme: Theme): Theme {
  return theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
}

export function themeLabel(theme: Theme): string {
  return theme === "system" ? "跟随系统" : theme === "dark" ? "暗色" : "亮色";
}

/** Re-applies on OS scheme changes while in system mode. */
export function watchSystemTheme(getTheme: () => Theme): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
