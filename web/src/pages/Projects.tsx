import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listProfileOptions,
  listProjects,
  listSnapshotNames,
  openTerminal,
  type ProfileOption,
  type ProjectRow,
} from "../api/sessions";
import { fmtUsd } from "../lib/format";
import { InfoHint } from "../components/InfoHint";
import { TerminalPane } from "../components/Terminal";
import { localeOf, useI18n } from "../i18n";
import { productPath, useProduct } from "../product";

export function Projects() {
  const { t, lang } = useI18n();
  const product = useProduct();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [terminal, setTerminal] = useState<{ name: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [runAs, setRunAs] = useState("");
  const [preset, setPreset] = useState("");
  const [presets, setPresets] = useState<string[]>([]);
  const [newDir, setNewDir] = useState("");

  useEffect(() => {
    setProjects(null);
    setProfiles([]);
    setPresets([]);
    void listProjects(product).then((res) => setProjects(res.projects));
    void listProfileOptions(product).then(setProfiles);
    // settings presets are a Claude concept (codex has config profiles of its own)
    if (product === "claude") {
      void listSnapshotNames().then(setPresets);
    }
  }, [product]);

  async function startInDir(createDir: boolean) {
    setError(null);
    try {
      const term = await openTerminal({
        cwd: newDir.trim(),
        createDir,
        product,
        profileId: runAs || undefined,
        settingsPreset: (product === "claude" && preset) || undefined,
      });
      setTerminal({ name: term.name, title: term.title });
      setNewDir("");
    } catch (err) {
      const e = err as Error & { canCreate?: boolean };
      if (e.canCreate && window.confirm(t("目录不存在,创建它并在其中开始?"))) {
        await startInDir(true);
        return;
      }
      setError(e.message);
    }
  }

  async function startNewSession(project: ProjectRow) {
    setError(null);
    try {
      const term = await openTerminal({
        projectId: project.id,
        profileId: runAs || undefined,
        settingsPreset: (product === "claude" && preset) || undefined,
      });
      setTerminal({ name: term.name, title: term.title });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-tight">{t("项目")}</h1>
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted">
        {t("每个项目对应一个工作目录,可直接在此新建会话。")}
        <InfoHint text={t("会话命令由服务端构造并运行在 tmux 中,浏览器只发送项目 ID;关闭页面不会中断会话。")} />
      </p>
      <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="text-[15px] font-medium">{t("在新目录中开始")}</h2>
        <p className="mt-1 text-xs text-muted">
          {t("Claude Code 没跑过的目录还不是项目——在这里开一个会话,它就会出现在下面的列表里。")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            placeholder="/Users/you/WorkSpace/new-thing"
            className="w-full rounded-lg border border-line bg-bg px-3 py-1.5 font-mono text-xs sm:w-96"
          />
          <button
            type="button"
            disabled={!newDir.trim()}
            onClick={() => void startInDir(false)}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-strong disabled:opacity-40 dark:text-ink"
          >
            {t("新建会话")}
          </button>
        </div>
      </div>

      {profiles.length > 1 && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted">{t("新会话使用账号")}</span>
          <select
            value={runAs}
            onChange={(e) => setRunAs(e.target.value)}
            className="rounded-lg border border-line bg-bg px-3 py-1.5 text-sm"
          >
            <option value="">{t("项目默认")}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      {presets.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-muted">{t("新会话使用配置")}</span>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="rounded-lg border border-line bg-bg px-3 py-1.5 text-sm"
          >
            <option value="">{t("当前设置")}</option>
            {presets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">{t("以 --settings 叠加,不改动 settings.json")}</span>
        </label>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {terminal && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm">{terminal.title}</span>
            <button
              type="button"
              onClick={() => setTerminal(null)}
              className="text-xs text-muted hover:text-ink"
            >
              {t("收起终端(会话继续运行)")}
            </button>
          </div>
          <TerminalPane name={terminal.name} />
        </div>
      )}

      {/* same trade as the sessions list: a table cannot fit a 390px screen
          without sideways scrolling, so below sm each project is a card */}
      <div className="mt-5 space-y-2 sm:hidden">
        {!projects && <p className="rounded-2xl border border-line bg-panel px-4 py-8 text-center text-sm text-muted">{t("加载中…")}</p>}
        {projects?.map((p) => (
          <div key={p.id} className="min-w-0 rounded-2xl border border-line bg-panel px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => navigate(productPath(product, `/sessions?project=${p.id}`))}
                className="min-w-0 truncate text-left text-sm hover:text-accent"
              >
                {p.cwd?.split("/").at(-1) ?? p.dirName}
              </button>
              <button
                type="button"
                disabled={!p.cwd}
                onClick={() => void startNewSession(p)}
                className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                {t("新建会话")}
              </button>
            </div>
            <div className="mt-0.5 truncate font-mono text-xs text-muted">{p.cwd ?? p.dirName}</div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted">
              <span className="min-w-0 truncate">{p.profileId}</span>
              <span className="tabular-nums">{p.sessionCount} {t("会话")}</span>
              <span className="tabular-nums">{fmtUsd(p.costUsd)}</span>
              <span className="ml-auto shrink-0">
                {p.lastSessionTs ? new Date(p.lastSessionTs).toLocaleDateString(localeOf(lang)) : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 hidden overflow-x-auto rounded-2xl border border-line bg-panel sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">{t("目录")}</th>
              <th className="hidden px-4 py-2.5 font-normal sm:table-cell">{t("所属账号")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{t("会话")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{t("费用")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{t("最近")}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {!projects && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  {t("加载中…")}
                </td>
              </tr>
            )}
            {projects?.map((p) => (
              <tr key={p.id} className="border-b border-line/60 last:border-0 hover:bg-hover/40">
                <td className="max-w-md px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate(productPath(product, `/sessions?project=${p.id}`))}
                    className="block max-w-full truncate text-left hover:text-accent"
                  >
                    {p.cwd?.split("/").at(-1) ?? p.dirName}
                  </button>
                  <div className="truncate font-mono text-xs text-muted">{p.cwd ?? p.dirName}</div>
                </td>
                <td className="hidden px-4 py-2.5 text-muted sm:table-cell">{p.profileId}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">{p.sessionCount}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtUsd(p.costUsd)}</td>
                <td className="px-4 py-2.5 text-right text-muted">
                  {p.lastSessionTs ? new Date(p.lastSessionTs).toLocaleDateString(localeOf(lang)) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    disabled={!p.cwd}
                    onClick={() => void startNewSession(p)}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
                  >
                    {t("新建会话")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
