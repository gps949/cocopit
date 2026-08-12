import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listProfileOptions, listProjects, openTerminal, type ProfileOption, type ProjectRow } from "../api/sessions";
import { fmtUsd } from "../components/EChart";
import { TerminalPane } from "../components/Terminal";
import { useI18n } from "../i18n";

export function Projects() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [terminal, setTerminal] = useState<{ name: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [runAs, setRunAs] = useState("");

  useEffect(() => {
    void listProjects().then((res) => setProjects(res.projects));
    void listProfileOptions().then(setProfiles);
  }, []);

  async function startNewSession(project: ProjectRow) {
    setError(null);
    try {
      const term = await openTerminal({ projectId: project.id, profileId: runAs || undefined });
      setTerminal({ name: term.name, title: term.title });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-tight">{t("项目")}</h1>
      <p className="mt-2 text-sm text-muted">
        {t("每个项目对应一个工作目录。可直接在此新建会话——命令由服务端构造并运行在 tmux 中,浏览器只发送项目 ID。")}
      </p>
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

      <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-normal">{t("目录")}</th>
              <th className="hidden px-4 py-2.5 font-normal sm:table-cell">{t("账号")}</th>
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
                    onClick={() => navigate(`/sessions?project=${p.id}`)}
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
                  {p.lastSessionTs ? new Date(p.lastSessionTs).toLocaleDateString("zh-CN") : "—"}
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
