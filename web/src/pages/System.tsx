import { useState } from "react";
import { RefreshIcon } from "../components/icons";
import { useIndexStatus } from "../hooks/useIndexStatus";
import { SystemDisk } from "./SystemDisk";
import { localeOf, useI18n } from "../i18n";

function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-[15px] tabular-nums">{value}</dd>
    </div>
  );
}

export function System() {
  const { t, lang } = useI18n();
  const status = useIndexStatus();
  const [busy, setBusy] = useState(false);
  const scanning = status?.phase === "scanning";

  async function rescan(full: boolean) {
    if (full && !window.confirm(t("完全重建将清空索引后重扫全部数据,继续?"))) return;
    setBusy(true);
    try {
      await fetch("/api/index/rescan", { method: "POST", body: JSON.stringify({ full }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold tracking-tight">{t("系统")}</h1>

      <section className="mt-8 rounded-2xl border border-line bg-panel p-6 shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium">{t("索引状态")}</h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || scanning}
              onClick={() => rescan(false)}
              className="flex items-center gap-2 rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white transition-colors hover:bg-accent-strong disabled:opacity-40 dark:text-ink"
            >
              <RefreshIcon className={`size-4 ${scanning ? "animate-spin" : ""}`} />
              {t("增量扫描")}
            </button>
            <button
              type="button"
              disabled={busy || scanning}
              onClick={() => rescan(true)}
              className="rounded-lg border border-line px-3.5 py-1.5 text-sm text-danger transition-colors hover:bg-hover disabled:opacity-40"
            >
              {t("完全重建")}
            </button>
          </div>
        </div>

        {!status ? (
          <p className="mt-5 text-sm text-muted">{t("连接服务中…")}</p>
        ) : (
          <div className="mt-5 space-y-5">
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className={scanning ? "text-accent" : "text-ok"}>
                  {scanning ? "扫描中" : t("空闲")}
                </span>
                <span className="text-xs tabular-nums text-muted">{Math.round(status.pct * 100)}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${status.pct * 100}%` }}
                />
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              <Stat label={t("文件")} value={`${status.filesDone} / ${status.filesTotal}`} />
              <Stat label={t("字节")} value={`${fmtBytes(status.bytesDone)} / ${fmtBytes(status.bytesTotal)}`} />
              <Stat label={t("解析错误")} value={String(status.errors)} />
              <Stat
                label={t("上次完成")}
                value={status.finishedAt ? new Date(status.finishedAt).toLocaleTimeString(localeOf(lang)) : "—"}
              />
            </dl>

            {status.currentFiles.length > 0 && (
              <div className="space-y-1 border-t border-line pt-4 text-xs text-muted">
                {status.currentFiles.map((file) => (
                  <div key={file} className="truncate font-mono">
                    {file.split("/projects/").at(-1) ?? file}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <SystemDisk />
    </div>
  );
}
