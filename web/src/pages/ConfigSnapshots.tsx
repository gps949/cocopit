import { useEffect, useState } from "react";
import { getJson } from "../api/usage";
import { InfoHint } from "../components/InfoHint";
import { localeOf, useI18n } from "../i18n";

interface SnapshotRow {
  name: string;
  createdAt: number;
  sourcePath: string;
  keys: number;
  diff: { changed: string[]; added: string[]; removed: string[] };
}

/**
 * Named copies of settings.json.
 *
 * Settings and the signed-in account both live under a config directory, but
 * they are not tied to each other — wanting stricter permissions for an
 * afternoon is not a reason to keep a second login. This is that separate axis;
 * applying goes through the same backup-and-CAS write as any other config edit.
 */
export function ConfigSnapshots() {
  const { t, lang } = useI18n();
  const [snapshots, setSnapshots] = useState<SnapshotRow[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    getJson<{ snapshots: SnapshotRow[] }>("/api/snapshots").then((r) => setSnapshots(r.snapshots));

  useEffect(() => {
    void load();
  }, []);

  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/snapshots", { method: "POST", body: JSON.stringify(body) });
      const result = (await res.json()) as { error?: string; backupId?: string };
      if (!res.ok) {
        setError(result.error ?? `HTTP ${res.status}`);
        return;
      }
      setNotice(result.backupId ? `${ok}(${t("已备份")} ${result.backupId}）` : ok);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!snapshots) return null;

  return (
    <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
      <h2 className="inline-flex items-center gap-1.5 text-[15px] font-medium">
        {t("配置方案")}
        <InfoHint
          text={t("快照与账号无关——同一个账号可以有多套设置,同一套设置也可以用在不同账号上;套用前会列出将改动的键。")}
        />
      </h2>
      <p className="mt-1 text-sm text-muted">{t("把当前设置存成一份命名快照,之后一键套用。")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("方案名称,如 严格权限")}
          className="w-52 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void post({ name: name.trim() }, t("已保存当前设置")).then(() => setName(""))}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-40"
        >
          {t("存为方案")}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {notice && <p className="mt-2 text-sm text-muted">{notice}</p>}

      {snapshots.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("还没有方案。")}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {snapshots.map((snapshot) => {
            const total =
              snapshot.diff.changed.length + snapshot.diff.added.length + snapshot.diff.removed.length;
            return (
              <div key={snapshot.name} className="rounded-lg border border-line px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{snapshot.name}</span>
                  <span className="text-xs text-muted">
                    {t("{n} 项设置", { n: snapshot.keys })} ·{" "}
                    {new Date(snapshot.createdAt).toLocaleString(localeOf(lang))}
                  </span>
                  <div className="ml-auto flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy || total === 0}
                      onClick={() => void post({ name: snapshot.name, action: "apply" }, t("已套用"))}
                      className="rounded-lg bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-strong disabled:opacity-40 dark:text-ink"
                    >
                      {total === 0 ? t("与当前一致") : t("套用")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void post({ name: snapshot.name, action: "delete" }, t("已删除"))}
                      className="rounded-lg border border-line px-2.5 py-1 text-xs text-danger hover:bg-hover disabled:opacity-40"
                    >
                      {t("删除")}
                    </button>
                  </div>
                </div>
                {/* say what applying would do before it is done, not after */}
                {total > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
                    {snapshot.diff.changed.length > 0 && (
                      <span>
                        {t("将改动")}: <span className="font-mono">{snapshot.diff.changed.join(", ")}</span>
                      </span>
                    )}
                    {snapshot.diff.added.length > 0 && (
                      <span>
                        {t("将新增")}: <span className="font-mono">{snapshot.diff.added.join(", ")}</span>
                      </span>
                    )}
                    {snapshot.diff.removed.length > 0 && (
                      <span className="text-danger">
                        {t("将移除")}: <span className="font-mono">{snapshot.diff.removed.join(", ")}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
