import { useEffect, useState } from "react";
import { localeOf, useI18n, type Lang } from "../i18n";

export interface QuotaWindow {
  utilization: number;
  resetsAt: string | null;
}

export interface QuotaResult {
  status: "ok" | "unsupported" | "no_credentials" | "token_expired" | "rate_limited" | "error" | "no_data";
  quota?: {
    fiveHour: QuotaWindow | null;
    sevenDay: QuotaWindow | null;
    sevenDayOpus: QuotaWindow | null;
    sevenDaySonnet: QuotaWindow | null;
    extraUsage: { enabled: boolean; utilization: number | null } | null;
  };
  stale?: boolean;
  /** Codex: the snapshot is only as fresh as the last indexed session. */
  asOf?: number;
}

export function fmtReset(iso: string, lang: Lang): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString(localeOf(lang), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function QuotaBar({ label, window: w }: { label: string; window: QuotaWindow }) {
  const { t, lang } = useI18n();
  const pct = Math.max(0, Math.min(100, w.utilization));
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className={pct >= 100 ? "font-medium text-danger" : undefined}>
          {pct.toFixed(0)}%
          {w.resetsAt && (
            <span className="ml-1.5 font-normal text-muted">
              {t("重置于 {time}", { time: fmtReset(w.resetsAt, lang) })}
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? "var(--danger)" : "var(--accent)" }}
        />
      </div>
    </div>
  );
}

/**
 * Compact per-profile quota rows for the dashboard: the numbers people check
 * before starting work. Renders nothing when no logged-in subscription
 * profile answers — the accounts page explains failures, this strip does not.
 */
export function QuotaStrip({ product = "claude" }: { product?: "claude" | "codex" }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Array<{ id: string; name: string; result: QuotaResult }>>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (product === "codex") {
          // Codex embeds its rate-limit state in every transcript; the server
          // hands back the freshest snapshot the index has seen, per account
          const res = await fetch("/api/profiles?product=codex");
          const { profiles } = (await res.json()) as {
            profiles: Array<{ id: string; name: string; detection: { loggedIn: boolean } }>;
          };
          const results = await Promise.all(
            profiles
              .filter((p) => p.detection.loggedIn)
              .map(async (p) => ({
                id: p.id,
                name: p.name,
                result: (await (
                  await fetch(`/api/codex/quota?profileId=${encodeURIComponent(p.id)}`)
                ).json()) as QuotaResult,
              })),
          );
          if (!cancelled) setRows(results.filter((r) => r.result.status === "ok"));
          return;
        }
        const res = await fetch("/api/profiles");
        const { profiles } = (await res.json()) as {
          profiles: Array<{ id: string; name: string; kind: string; detection: { loggedIn: boolean } }>;
        };
        const candidates = profiles.filter((p) => p.kind === "subscription" && p.detection.loggedIn);
        const results = await Promise.all(
          candidates.map(async (p) => ({
            id: p.id,
            name: p.name,
            result: (await (await fetch(`/api/profiles/${p.id}/quota`)).json()) as QuotaResult,
          })),
        );
        if (!cancelled) setRows(results.filter((r) => r.result.status === "ok"));
      } catch {
        if (!cancelled) setRows([]);
      }
    };
    void load();
    const timer = setInterval(load, 180_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [product]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(({ id, name, result }) => (
          <div key={id} className="min-w-0">
            {rows.length > 1 && <div className="mb-1.5 truncate text-xs font-medium">{t(name)}</div>}
            <div className="space-y-2">
              {result.quota?.fiveHour && <QuotaBar label={t("5 小时窗口")} window={result.quota.fiveHour} />}
              {result.quota?.sevenDay && <QuotaBar label={t("每周(全部模型)")} window={result.quota.sevenDay} />}
            </div>
            {result.asOf && (
              <div className="mt-1.5 text-[11px] text-muted">
                {t("数据截至 {when}", { when: fmtReset(new Date(result.asOf).toISOString(), lang) })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
