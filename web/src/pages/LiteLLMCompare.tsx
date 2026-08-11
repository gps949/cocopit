import { useState } from "react";
import { useI18n } from "../i18n";

interface Tier {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

interface DiffRow {
  model: string;
  ours: Tier | null;
  theirs: Tier;
  differs: boolean;
  changed: string[];
}

const RATE_LABELS: Record<string, string> = {
  input: "输入",
  output: "输出",
  cacheRead: "缓存读",
  cacheWrite5m: "写 5m",
  cacheWrite1h: "写 1h",
};

/** Rates span 0.0028 to 75, so a fixed precision either lies or adds noise. */
function fmtRate(value: number | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "0";
  return value < 0.01 ? value.toPrecision(2) : String(Math.round(value * 1000) / 1000);
}

/**
 * LiteLLM's community catalog as a second opinion on prices. Rows are limited
 * to models we price or that appear in your own usage, and adopting one just
 * stages a normal user override — nothing is written until you save.
 */
export function LiteLLMCompare({ onAdopt }: { onAdopt: (model: string, tier: Tier) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(refresh: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pricing/litellm${refresh ? "?refresh=1" : ""}`);
      const body = (await res.json()) as { rows?: DiffRow[]; fetchedAt?: number; error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setRows(body.rows ?? []);
      setFetchedAt(body.fetchedAt ?? null);
    } catch {
      setError(t("连接失败"));
    } finally {
      setBusy(false);
    }
  }

  const differing = rows?.filter((row) => row.differs) ?? [];

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium">{t("对照 LiteLLM 社区价格库")}</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(rows !== null)}
          className="rounded-lg border border-line px-3 py-1 text-xs text-muted hover:bg-hover disabled:opacity-40"
        >
          {busy ? t("加载中…") : rows === null ? t("对比") : t("刷新")}
        </button>
        {fetchedAt && (
          <span className="text-xs text-muted">
            {t("数据更新于 {when}", { when: new Date(fetchedAt).toLocaleString() })}
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {rows !== null && (
        <p className="mt-2 text-xs text-muted">
          {t("已对比 {n} 个相关模型,{d} 处差异", { n: rows.length, d: differing.length })}
        </p>
      )}

      {differing.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="pb-1.5 pr-3 font-normal">{t("模型")}</th>
              <th className="pb-1.5 pr-3 text-right font-normal">{t("我方")}</th>
              <th className="pb-1.5 pr-3 text-right font-normal">LiteLLM</th>
              <th className="pb-1.5 font-normal" />
            </tr>
          </thead>
          <tbody>
            {differing.map((row) => (
              <tr key={row.model} className="border-b border-line/60 align-top">
                <td className="py-1.5 pr-3">
                  <div className="font-mono text-xs">{row.model}</div>
                  {/* the input/output columns often match while a cache rate is
                      what differs — spell out every changed field, or the row
                      reads as flagged-but-identical */}
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                    {row.changed.map((field) => (
                      <span key={field}>
                        {t(RATE_LABELS[field] ?? field)}{" "}
                        <span className="tabular-nums">
                          {row.ours ? fmtRate(row.ours[field as keyof Tier]) : t("未定价")}
                        </span>
                        {" → "}
                        <span className="tabular-nums text-ink">{fmtRate(row.theirs[field as keyof Tier])}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-1.5 pr-3 text-right text-xs tabular-nums">
                  {row.ours ? `${row.ours.input} / ${row.ours.output}` : t("未定价")}
                </td>
                <td className="py-1.5 pr-3 text-right text-xs tabular-nums">
                  {row.theirs.input} / {row.theirs.output}
                </td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onAdopt(row.model, row.theirs)}
                    className="text-xs text-accent hover:underline"
                  >
                    {t("采用")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
