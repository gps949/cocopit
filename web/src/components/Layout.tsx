import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useIndexStatus } from "../hooks/useIndexStatus";
import { ScrollNav } from "./ScrollNav";
import { applyTheme, loadTheme, nextTheme, themeLabel, watchSystemTheme, type Theme } from "../theme";
import { useI18n } from "../i18n";
import {
  ChatIcon,
  FolderIcon,
  GaugeIcon,
  HistoryIcon,
  MonitorIcon,
  MoonIcon,
  PulseIcon,
  ServerIcon,
  PuzzleIcon,
  SlidersIcon,
  GlobeIcon,
  MenuIcon,
  SunIcon,
  UserIcon,
} from "./icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const NAV: Array<{ to: string; label: string; icon: IconType }> = [
  { to: "/dashboard", label: "仪表盘", icon: GaugeIcon },
  { to: "/profiles", label: "账号", icon: UserIcon },
  { to: "/projects", label: "项目", icon: FolderIcon },
  { to: "/sessions", label: "会话", icon: ChatIcon },
  { to: "/history", label: "历史", icon: HistoryIcon },
  { to: "/live", label: "实时", icon: PulseIcon },
  { to: "/config", label: "配置", icon: SlidersIcon },
  { to: "/extensions", label: "扩展", icon: PuzzleIcon },
  { to: "/system", label: "系统", icon: ServerIcon },
];

const THEME_ICON: Record<Theme, IconType> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const status = useIndexStatus();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => watchSystemTheme(loadTheme), []);

  // a route change means the drawer has done its job
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const ThemeIcon = THEME_ICON[theme];

  return (
    <div className="flex min-h-screen">
      {/* below lg the sidebar slides over the content instead of taking half the screen */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="close menu"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
        />
      )}
      {/* on wide screens it rejoins the flow, so it must be pinned itself —
          otherwise a long page scrolls the navigation off the top */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-side transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-6 pt-6 pb-5">
          <div className="font-brand text-[22px] font-medium tracking-tight">cocopit</div>
          <div className="mt-0.5 text-xs text-muted">{t("Claude Code 控制台")}</div>
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
                  {t(label)}
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
              {t("索引中 {pct}%", { pct: Math.round(status.pct * 100) })}
            </div>
          )}
          <button
            type="button"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-hover/60 hover:text-ink"
          >
            <GlobeIcon className="size-[18px]" />
            {lang === "zh" ? "English" : "中文"}
          </button>
          <button
            type="button"
            onClick={() => setTheme(nextTheme(theme))}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-hover/60 hover:text-ink"
          >
            <ThemeIcon className="size-[18px]" />
            {t(themeLabel(theme))}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="menu"
            className="flex size-9 items-center justify-center rounded-lg border border-line"
          >
            <MenuIcon className="size-[18px]" />
          </button>
          <span className="font-brand text-lg">cocopit</span>
        </header>
        <div className="rise-in mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
          <Outlet />
        </div>
        <ScrollNav />
      </main>
    </div>
  );
}
