import { useEffect, useState } from "react";
import { getJson } from "../api/usage";
import { useI18n } from "../i18n";

interface FileStamp {
  exists: boolean;
  mtimeMs?: number;
  sha256?: string;
}

interface ConfigResponse {
  path: string;
  scope: string;
  content: Record<string, unknown>;
  stamp: FileStamp;
  activeSessions: Array<{ pid: number; sessionId: string; cwd: string }>;
}

interface ProjectRow {
  id: number;
  cwd: string | null;
  dirName: string;
}

type Kind = "settings" | "mcp";

function diffKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export function ConfigSettings() {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>("settings");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error" | "conflict"; message?: string }>({
    kind: "idle",
  });

  const effectiveScope = kind === "mcp" ? "project" : scope;

  useEffect(() => {
    void getJson<{ projects: ProjectRow[] }>("/api/projects").then((res) => {
      setProjects(res.projects.filter((p) => p.cwd));
      setProjectId((current) => current ?? res.projects.find((p) => p.cwd)?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (effectiveScope === "project" && projectId === null) return;
    const qs = new URLSearchParams({ scope: effectiveScope });
    if (effectiveScope === "project" && projectId !== null) qs.set("project", String(projectId));
    setStatus({ kind: "idle" });
    void fetch(`/api/config/${kind}?${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
        return res.json() as Promise<ConfigResponse>;
      })
      .then((res) => {
        setData(res);
        setDraft(JSON.stringify(res.content, null, 2));
      })
      .catch((err) => setStatus({ kind: "error", message: (err as Error).message }));
  }, [kind, effectiveScope, projectId]);

  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    const value = JSON.parse(draft || "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) parseError = t("内容必须是 JSON 对象");
    else parsed = value as Record<string, unknown>;
  } catch (err) {
    parseError = (err as Error).message;
  }

  const changed = data && parsed ? diffKeys(data.content, parsed) : [];

  async function save() {
    if (!data || !parsed) return;
    const qs = new URLSearchParams({ scope: effectiveScope });
    if (effectiveScope === "project" && projectId !== null) qs.set("project", String(projectId));
    const res = await fetch(`/api/config/${kind}?${qs}`, {
      method: "PUT",
      body: JSON.stringify({ content: parsed, stamp: data.stamp }),
    });
    const body = (await res.json()) as any;
    if (res.status === 409) {
      setStatus({ kind: "conflict", message: body.error });
      return;
    }
    if (!res.ok) {
      setStatus({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
      return;
    }
    setData({ ...data, content: parsed, stamp: body.stamp });
    setStatus({ kind: "saved", message: body.backupId ? t("已备份 {id}", { id: body.backupId }) : t("已保存") });
  }

  async function reload() {
    const qs = new URLSearchParams({ scope: effectiveScope });
    if (effectiveScope === "project" && projectId !== null) qs.set("project", String(projectId));
    const res = await getJson<ConfigResponse>(`/api/config/${kind}?${qs}`);
    setData(res);
    setDraft(JSON.stringify(res.content, null, 2));
    setStatus({ kind: "idle" });
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-medium">{t("配置文件")}</h2>
        <div className="flex rounded-lg border border-line p-0.5">
          {(["settings", "mcp"] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1 text-sm ${kind === k ? "bg-hover font-medium" : "text-muted"}`}
            >
              {k === "settings" ? "settings" : ".mcp.json"}
            </button>
          ))}
        </div>
        {kind === "settings" && (
          <div className="flex rounded-lg border border-line p-0.5">
            {(["user", "project"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1 text-sm ${scope === s ? "bg-hover font-medium" : "text-muted"}`}
              >
                {s === "user" ? t("用户级") : t("项目级")}
              </button>
            ))}
          </div>
        )}
        {effectiveScope === "project" && (
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(Number(e.target.value))}
            className="max-w-xs rounded-lg border border-line bg-bg px-2 py-1 text-sm"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.cwd?.split("/").at(-1)}
              </option>
            ))}
          </select>
        )}
      </div>

      {data && (
        <p className="mt-2 truncate font-mono text-xs text-muted">
          {data.path}
          {!data.stamp.exists && ` ${t("(尚不存在,保存后创建)")}`}
        </p>
      )}

      {data && data.activeSessions.length > 0 && (
        <div className="mt-3 rounded-xl border border-line bg-accent-soft px-4 py-2.5 text-sm">
          {t("检测到 {n} 个运行中的 Claude Code 会话。它们退出时可能回写该文件覆盖你的修改;修改前建议先退出,或保存后用备份恢复。", { n: data.activeSessions.length })}
        </div>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="mt-3 h-72 w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs leading-relaxed"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!parsed || changed.length === 0}
          onClick={() => void save()}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-strong disabled:opacity-40 dark:text-ink"
        >
          {t("保存")}
        </button>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-hover"
        >
          {t("重新加载")}
        </button>
        {parseError && <span className="text-sm text-danger">{t("JSON 错误")}:{parseError}</span>}
        {!parseError && changed.length > 0 && (
          <span className="text-sm text-muted">
            {t("将修改 {n} 个键:", { n: changed.length })}<span className="font-mono">{changed.join(", ")}</span>
          </span>
        )}
        {status.kind === "saved" && <span className="text-sm text-ok">{status.message}</span>}
        {status.kind === "error" && <span className="text-sm text-danger">{status.message}</span>}
        {status.kind === "conflict" && (
          <span className="text-sm text-danger">
            {status.message} ·{" "}
            <button type="button" onClick={() => void reload()} className="underline">
              {t("加载最新")}
            </button>
          </span>
        )}
      </div>
    </section>
  );
}
