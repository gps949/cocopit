import { useEffect, useMemo, useState } from "react";
import { getJson } from "../api/usage";
import { ConfigSettings } from "./ConfigSettings";
import { LiteLLMCompare } from "./LiteLLMCompare";
import { useI18n } from "../i18n";

interface PricingTier {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

interface PricingEntry {
  match: string;
  note?: string;
  tiers: { default: PricingTier; long?: PricingTier };
}

interface PricingResponse {
  version: number;
  table: { entries: PricingEntry[]; serverTools: { webSearchPer1k: number } };
  userEntries: PricingEntry[];
}

const TIER_KEYS: Array<{ key: keyof PricingTier; label: string }> = [
  { key: "input", label: "输入" },
  { key: "output", label: "输出" },
  { key: "cacheRead", label: "缓存读" },
  { key: "cacheWrite5m", label: "写 5m" },
  { key: "cacheWrite1h", label: "写 1h" },
];

function emptyTier(): PricingTier {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
}

export function Config() {
  const { t } = useI18n();
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [drafts, setDrafts] = useState<Map<string, PricingTier>>(new Map());
  const [newMatch, setNewMatch] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "recalculating" | "done" | "error">("idle");

  const load = () => getJson<PricingResponse>("/api/pricing").then(setPricing);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("pricing.recalculated", () => {
      setStatus("done");
      void load();
      setTimeout(() => setStatus("idle"), 4000);
    });
    return () => es.close();
  }, []);

  const userMatches = useMemo(() => new Set(pricing?.userEntries.map((e) => e.match)), [pricing]);

  function beginEdit(entry: PricingEntry) {
    setDrafts((prev) => new Map(prev).set(entry.match, { ...entry.tiers.default }));
  }

  function updateDraft(match: string, key: keyof PricingTier, value: number) {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(match, { ...next.get(match)!, [key]: value });
      return next;
    });
  }

  function cancelEdit(match: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(match);
      return next;
    });
  }

  async function save() {
    if (!pricing) return;
    setStatus("saving");
    // merge drafts into user entries (whole-entry override per match key)
    const byMatch = new Map(pricing.userEntries.map((e) => [e.match, e]));
    for (const [match, tier] of drafts) {
      byMatch.set(match, { match, tiers: { default: tier } });
    }
    try {
      const res = await fetch("/api/pricing", {
        method: "PUT",
        body: JSON.stringify({ entries: [...byMatch.values()] }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDrafts(new Map());
      setStatus("recalculating");
    } catch {
      setStatus("error");
    }
  }

  async function resetOverrides() {
    setStatus("saving");
    try {
      await fetch("/api/pricing", { method: "PUT", body: JSON.stringify({ entries: [] }) });
      setDrafts(new Map());
      setStatus("recalculating");
    } catch {
      setStatus("error");
    }
  }

  function addEntry() {
    const match = newMatch.trim();
    if (!match) return;
    setDrafts((prev) => new Map(prev).set(match, emptyTier()));
    setNewMatch("");
  }

  const entries = pricing?.table.entries ?? [];
  const extraDrafts = [...drafts.keys()].filter((m) => !entries.some((e) => e.match === m));

  return (
    <div className="max-w-4xl">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight">{t("配置")}</h1>
      </div>

      <div className="mt-6">
        <ConfigSettings />
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-medium">{t("价目表(USD / 百万 tokens)")}</h2>
            <p className="mt-1 text-xs text-muted">
              {t("版本 v{v} · 修改任意行即生成用户覆盖,保存后全量重算历史费用", { v: pricing?.version ?? "—" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status === "recalculating" && <span className="text-xs text-accent">{t("重算中…")}</span>}
            {status === "done" && <span className="text-xs text-ok">{t("已重算完成")}</span>}
            {status === "error" && <span className="text-xs text-danger">{t("保存失败")}</span>}
            {pricing && pricing.userEntries.length > 0 && (
              <button
                type="button"
                onClick={() => void resetOverrides()}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-hover"
              >
                {t("清除全部覆盖")}
              </button>
            )}
            <button
              type="button"
              disabled={drafts.size === 0 || status === "saving"}
              onClick={() => void save()}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white transition-colors hover:bg-accent-strong disabled:opacity-40 dark:text-ink"
            >
              {t("保存并重算")}
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="pb-2 pr-3 font-normal">{t("模型前缀")}</th>
                {TIER_KEYS.map((tier) => (
                  <th key={tier.key} className="pb-2 pr-3 text-right font-normal">
                    {t(tier.label)}
                  </th>
                ))}
                <th className="pb-2 pr-3 font-normal">{t("来源")}</th>
                <th className="pb-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const draft = drafts.get(entry.match);
                const isUser = userMatches.has(entry.match);
                return (
                  <tr key={entry.match} className="border-b border-line/60">
                    <td className="py-1.5 pr-3 font-mono text-xs">{entry.match}</td>
                    {TIER_KEYS.map((tier) => (
                      <td key={tier.key} className="py-1.5 pr-3 text-right tabular-nums">
                        {draft ? (
                          <input
                            type="number"
                            step="0.01"
                            value={draft[tier.key]}
                            onChange={(e) => updateDraft(entry.match, tier.key, Number(e.target.value))}
                            className="w-20 rounded border border-line bg-bg px-1.5 py-0.5 text-right text-xs"
                          />
                        ) : (
                          entry.tiers.default[tier.key]
                        )}
                      </td>
                    ))}
                    <td className="py-1.5 pr-3 text-xs text-muted">{isUser ? "用户覆盖" : t("默认")}</td>
                    <td className="py-1.5 text-right">
                      {draft ? (
                        <button type="button" onClick={() => cancelEdit(entry.match)} className="text-xs text-muted hover:text-ink">
                          {t("取消")}
                        </button>
                      ) : (
                        <button type="button" onClick={() => beginEdit(entry)} className="text-xs text-accent hover:text-accent-strong">
                          {t("编辑")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {extraDrafts.map((match) => {
                const draft = drafts.get(match)!;
                return (
                  <tr key={match} className="border-b border-line/60 bg-accent-soft/40">
                    <td className="py-1.5 pr-3 font-mono text-xs">{match}</td>
                    {TIER_KEYS.map((tier) => (
                      <td key={tier.key} className="py-1.5 pr-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={draft[tier.key]}
                          onChange={(e) => updateDraft(match, tier.key, Number(e.target.value))}
                          className="w-20 rounded border border-line bg-bg px-1.5 py-0.5 text-right text-xs"
                        />
                      </td>
                    ))}
                    <td className="py-1.5 pr-3 text-xs text-accent">{t("新增")}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => cancelEdit(match)} className="text-xs text-muted hover:text-ink">
                        {t("取消")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <LiteLLMCompare
          onAdopt={(model, tier) => {
            setDrafts((prev) => new Map(prev).set(model, tier));
          }}
        />

        <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
          <input
            type="text"
            placeholder={t("新增模型前缀,如 deepseek-v4")}
            value={newMatch}
            onChange={(e) => setNewMatch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEntry()}
            className="w-64 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm placeholder:text-muted"
          />
          <button
            type="button"
            onClick={addEntry}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover"
          >
            {t("添加条目")}
          </button>
          <span className="text-xs text-muted">{t("为未定价模型(如 deepseek)补价后,其用量将计入费用")}</span>
        </div>
      </section>
    </div>
  );
}
