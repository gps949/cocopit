import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useIndexStatus } from "../hooks/useIndexStatus";
import { applyTheme, loadTheme, nextTheme, themeLabel, watchSystemTheme, type Theme } from "../theme";
import {
  ChatIcon,
  FolderIcon,
  GaugeIcon,
  MonitorIcon,
  MoonIcon,
  PulseIcon,
  ServerIcon,
  SlidersIcon,
  SunIcon,
  UserIcon,
} from "./icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const NAV: Array<{ to: string; label: string; icon: IconType }> = [
  { to: "/dashboard", label: "仪表盘", icon: GaugeIcon },
  { to: "/profiles", label: "账户", icon: UserIcon },
  { to: "/projects", label: "项目", icon: FolderIcon },
  { to: "/sessions", label: "会话", icon: ChatIcon },
  { to: "/live", label: "实时", icon: PulseIcon },
  { to: "/config", label: "配置", icon: SlidersIcon },
  { to: "/system", label: "系统", icon: ServerIcon },
];

const THEME_ICON: Record<Theme, IconType> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

export function Layout() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const status = useIndexStatus();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => watchSystemTheme(loadTheme), []);

  const ThemeIcon = THEME_ICON[theme];

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-side">
        <div className="px-6 pt-6 pb-5">
          <div className="font-brand text-[22px] font-medium tracking-tight">ccockpit</div>
          <div className="mt-0.5 text-xs text-muted">Claude Code 控制台</div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${
                  isActive ? "bg-hover font-medium text-ink" : "text-muted hover:bg-hover/60 hover:text-ink"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`size-[18px] ${isActive ? "text-accent" : "text-muted group-hover:text-ink"}`} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-line px-3 py-3">
          {status?.phase === "scanning" && (
            <div className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-muted">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-accent" />
              </span>
              索引中 {Math.round(status.pct * 100)}%
            </div>
          )}
          <button
            type="button"
            onClick={() => setTheme(nextTheme(theme))}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-hover/60 hover:text-ink"
          >
            <ThemeIcon className="size-[18px]" />
            {themeLabel(theme)}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="rise-in mx-auto max-w-5xl px-8 py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
