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
              <tr key={row.model} className="border-b border-line/60">
                <td className="py-1.5 pr-3 font-mono text-xs">{row.model}</td>
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
