import { useEffect, useState } from "react";
import { getJson } from "../api/usage";
import { useI18n } from "../i18n";

interface DiskCategory {
  id: string;
  label: string;
  path: string;
  description: string;
  sizeBytes: number;
  fileCount: number;
}

interface DiskReport {
  categories: DiskCategory[];
  protected: Array<{ id: string; label: string; sizeBytes: number; fileCount: number }>;
  totalBytes: number;
  retentionDays: number;
  activeSessionIds: string[];
}

interface CleanupResult {
  dryRun: boolean;
  deleted: number;
  freedBytes: number;
  plan: { items: Array<{ category: string; path: string; sizeBytes: number }>; totalBytes: number };
  errors: Array<{ path: string; error: string }>;
}

interface BackupEntry {
  id: string;
  slug: string;
  originPath: string;
  createdAt: number;
  sizeBytes: number;
}

function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}

function AccessTokenPanel() {
  const { t } = useI18n();
  const [required, setRequired] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getJson<{ required: boolean }>("/api/auth/status").then((res) => setRequired(res.required));
  }, []);

  async function save(value: string | null) {
    setError(null);
    const res = await fetch("/api/auth/token", { method: "POST", body: JSON.stringify({ token: value }) });
    const body = (await res.json()) as { required?: boolean; error?: string };
    if (!res.ok) return setError(body.error ?? `HTTP ${res.status}`);
    setRequired(Boolean(body.required));
    setToken("");
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
      <h2 className="text-[15px] font-medium">{t("远程访问")}</h2>
      <p className="mt-1 text-sm text-muted">
        {required
          ? t("已启用访问令牌。远程访问需要先登录。")
          : t("未设置访问令牌。ccockpit 绑定 127.0.0.1,本机使用无需登录;若通过反代对外暴露,请设置令牌。")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("新令牌(至少 8 位)")}
          className="w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm sm:w-64"
        />
        <button
          type="button"
          disabled={token.length < 8}
          onClick={() => void save(token)}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-strong disabled:opacity-40 dark:text-ink"
        >
          {t("设置令牌")}
        </button>
        {required && (
          <button
            type="button"
            onClick={() => void save(null)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-danger hover:bg-hover"
          >
            {t("清除令牌")}
          </button>
        )}
        <span className="text-xs text-muted">{t("仅可在服务器本机设置")}</span>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

export function SystemDisk() {
  const { t } = useI18n();
  const [report, setReport] = useState<DiskReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [retention, setRetention] = useState<number | null>(null);
  const [preview, setPreview] = useState<CleanupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    void getJson<DiskReport>("/api/system/disk").then((res) => {
      setReport(res);
      setRetention((current) => current ?? res.retentionDays);
    });
    void getJson<{ backups: BackupEntry[] }>("/api/backups").then((res) => setBackups(res.backups));
  };

  useEffect(load, []);

  async function runCleanup(dryRun: boolean) {
    if (selected.size === 0) return;
    if (!dryRun && !window.confirm(`确认删除 ${preview?.plan.items.length ?? 0} 项?此操作不可撤销。`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/system/cleanup", {
        method: "POST",
        body: JSON.stringify({ categories: [...selected], retentionDays: retention, dryRun }),
      });
      const body = (await res.json()) as CleanupResult;
      setPreview(body);
      if (!dryRun) {
        setMessage(`已删除 ${body.deleted} 项,释放 ${fmtBytes(body.freedBytes)}`);
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string) {
    if (!window.confirm(t("恢复该备份?当前内容会先被备份,可再回滚。"))) return;
    const res = await fetch(`/api/backups/${encodeURIComponent(id)}/restore`, { method: "POST" });
    setMessage(res.ok ? "已恢复" : t("恢复失败"));
    load();
  }

  return (
    <>
      <AccessTokenPanel />

      <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium">{t("磁盘治理")}</h2>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-muted">{t("保留天数")}</label>
            <input
              type="number"
              min={0}
              value={retention ?? 30}
              onChange={(e) => setRetention(Number(e.target.value))}
              className="w-20 rounded-lg border border-line bg-bg px-2 py-1 text-right text-sm"
            />
            <button
              type="button"
              disabled={selected.size === 0 || busy}
              onClick={() => void runCleanup(true)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-40"
            >
              {t("预览")}
            </button>
            <button
              type="button"
              disabled={!preview || preview.plan.items.length === 0 || busy}
              onClick={() => void runCleanup(false)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-danger hover:bg-hover disabled:opacity-40"
            >
              {t("执行删除")}
            </button>
          </div>
        </div>

        {report && report.activeSessionIds.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {report.activeSessionIds.length} 个会话正在运行,其文件版本备份不会被清理。
          </p>
        )}

        <div className="mt-3 space-y-1.5">
          {report?.categories.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover/50"
            >
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setSelected(next);
                  setPreview(null);
                }}
              />
              <span className="w-24 shrink-0 text-sm sm:w-28">{t(c.label)}</span>
              <span className="w-24 text-right text-sm tabular-nums">{fmtBytes(c.sizeBytes)}</span>
              <span className="w-20 text-right text-xs tabular-nums text-muted">{c.fileCount} 文件</span>
              <span className="hidden truncate text-xs text-muted sm:block">{c.description}</span>
            </label>
          ))}
        </div>

        {report && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
            受保护(永不清理):
            {report.protected.map((p) => ` ${p.label} ${fmtBytes(p.sizeBytes)}`).join(" ·")}
          </p>
        )}

        {preview && (
          <div className="mt-3 rounded-xl border border-line bg-bg p-3 text-sm">
            <div className={preview.dryRun ? "text-muted" : "text-ok"}>
              {preview.dryRun
                ? `预览:将删除 ${preview.plan.items.length} 项,释放 ${fmtBytes(preview.plan.totalBytes)}`
                : `已删除 ${preview.deleted} 项,释放 ${fmtBytes(preview.freedBytes)}`}
            </div>
            {preview.plan.items.length > 0 && (
              <div className="mt-2 max-h-40 overflow-auto font-mono text-xs text-muted">
                {preview.plan.items.slice(0, 50).map((item) => (
                  <div key={item.path} className="truncate">
                    {item.path.split("/.claude/").at(-1)} · {fmtBytes(item.sizeBytes)}
                  </div>
                ))}
                {preview.plan.items.length > 50 && <div>…还有 {preview.plan.items.length - 50} 项</div>}
              </div>
            )}
          </div>
        )}
        {message && <p className="mt-2 text-sm text-ok">{message}</p>}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="text-[15px] font-medium">配置备份({backups.length})</h2>
        {backups.length === 0 && <p className="mt-2 text-sm text-muted">{t("还没有备份。修改配置时会自动创建。")}</p>}
        <div className="mt-3 space-y-1">
          {backups.slice(0, 20).map((b) => (
            <div key={b.id} className="flex items-center gap-3 border-b border-line/60 py-1.5 text-sm last:border-0">
              <span className="w-40 text-xs text-muted">{new Date(b.createdAt).toLocaleString("zh-CN")}</span>
              <span className="w-32 text-xs">{b.slug}</span>
              <span className="flex-1 truncate font-mono text-xs text-muted">{b.originPath}</span>
              <button
                type="button"
                onClick={() => void restore(b.id)}
                className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-ink"
              >
                {t("恢复")}
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
