import { useEffect, useMemo, useState } from "react";
import {
  getJson,
  rangeToQuery,
  type CacheEfficiency,
  type CalibrationRow,
  type DailyUsage,
  type HeatmapUsage,
  type ModelUsage,
  type ProjectUsage,
  type RangeKey,
  type UnpricedModels,
  type UsageSummary,
} from "../api/usage";
import { chartTokens, EChart, fmtTokens, fmtUsd, type EChartsOption } from "../components/EChart";

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "90d", label: "90 天" },
  { key: "all", label: "全部" },
];

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="text-[15px] font-medium">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Dashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [themeTick, setThemeTick] = useState(0);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyUsage | null>(null);
  const [byModel, setByModel] = useState<ModelUsage | null>(null);
  const [byProject, setByProject] = useState<ProjectUsage | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapUsage | null>(null);
  const [cache, setCache] = useState<CacheEfficiency | null>(null);
  const [calibration, setCalibration] = useState<CalibrationRow[] | null>(null);
  const [unpriced, setUnpriced] = useState<UnpricedModels | null>(null);

  useEffect(() => {
    const q = rangeToQuery(range);
    void getJson<UsageSummary>(`/api/usage/summary${q}`).then(setSummary);
    void getJson<DailyUsage>(`/api/usage/daily${q}`).then(setDaily);
    void getJson<ModelUsage>(`/api/usage/by-model${q}`).then(setByModel);
    void getJson<ProjectUsage>(`/api/usage/by-project${q}`).then(setByProject);
    void getJson<HeatmapUsage>(`/api/usage/heatmap${q}`).then(setHeatmap);
    void getJson<CacheEfficiency>(`/api/usage/cache-efficiency${q}`).then(setCache);
  }, [range]);

  useEffect(() => {
    void getJson<{ rows: CalibrationRow[] }>("/api/usage/calibration").then((c) => setCalibration(c.rows));
    void getJson<UnpricedModels>("/api/usage/unpriced").then(setUnpriced);
  }, []);

  // re-render charts when the theme class flips
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const tokens = useMemo(() => chartTokens(), [themeTick]);

  const axisBase = useMemo(
    () => ({
      axisLine: { lineStyle: { color: tokens.line } },
      axisTick: { show: false },
      axisLabel: { color: tokens.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: tokens.line, opacity: 0.6 } },
    }),
    [tokens],
  );

  const dailyOption = useMemo<EChartsOption | null>(() => {
    if (!daily) return null;
    return {
      grid: { left: 56, right: 16, top: 16, bottom: 28 },
      tooltip: {
        trigger: "axis",
        backgroundColor: tokens.panel,
        borderColor: tokens.line,
        textStyle: { color: tokens.ink, fontSize: 12 },
        valueFormatter: (v: unknown) => fmtUsd(Number(v)),
      },
      xAxis: { type: "category", data: daily.days.map((d) => d.day.slice(5)), ...axisBase, splitLine: { show: false } },
      yAxis: { type: "value", ...axisBase, axisLine: { show: false }, axisLabel: { ...axisBase.axisLabel, formatter: (v: number) => fmtUsd(v) } },
      series: [
        {
          name: "费用",
          type: "bar",
          data: daily.days.map((d) => Number(d.costUsd.toFixed(4))),
          itemStyle: { color: tokens.accent, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 26,
        },
      ],
    };
  }, [daily, tokens, axisBase]);

  const modelOption = useMemo<EChartsOption | null>(() => {
    if (!byModel) return null;
    const rows = byModel.models.filter((m) => !m.unpriced).slice(0, 8).reverse();
    return {
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "item",
        backgroundColor: tokens.panel,
        borderColor: tokens.line,
        textStyle: { color: tokens.ink, fontSize: 12 },
        formatter: (p: any) => `${p.name}<br/>${fmtUsd(p.value)}`,
      },
      xAxis: { type: "value", ...axisBase, axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: { type: "category", data: rows.map((m) => m.model.replace(/^claude-/, "")), ...axisBase, splitLine: { show: false }, axisLine: { show: false } },
      series: [
        {
          type: "bar",
          data: rows.map((m) => Number(m.costUsd.toFixed(2))),
          itemStyle: { color: tokens.accent, borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 18,
          label: { show: true, position: "right", color: tokens.muted, fontSize: 11, formatter: (p: any) => fmtUsd(p.value) },
        },
      ],
    };
  }, [byModel, tokens, axisBase]);

  const projectOption = useMemo<EChartsOption | null>(() => {
    if (!byProject) return null;
    const rows = byProject.projects.slice(0, 10).reverse();
    const name = (cwd: string | null, dirName: string) => (cwd ? cwd.split("/").at(-1)! : dirName);
    return {
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "item",
        backgroundColor: tokens.panel,
        borderColor: tokens.line,
        textStyle: { color: tokens.ink, fontSize: 12 },
        formatter: (p: any) => `${p.name}<br/>${fmtUsd(p.value)}`,
      },
      xAxis: { type: "value", ...axisBase, axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: { type: "category", data: rows.map((p) => name(p.cwd, p.dirName)), ...axisBase, splitLine: { show: false }, axisLine: { show: false } },
      series: [
        {
          type: "bar",
          data: rows.map((p) => Number(p.costUsd.toFixed(2))),
          itemStyle: { color: tokens.accent, borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 18,
          label: { show: true, position: "right", color: tokens.muted, fontSize: 11, formatter: (p: any) => fmtUsd(p.value) },
        },
      ],
    };
  }, [byProject, tokens, axisBase]);

  const heatmapOption = useMemo<EChartsOption | null>(() => {
    if (!heatmap) return null;
    const max = Math.max(...heatmap.cells.map((c) => c.costUsd), 0.001);
    return {
      grid: { left: 40, right: 16, top: 8, bottom: 44 },
      tooltip: {
        backgroundColor: tokens.panel,
        borderColor: tokens.line,
        textStyle: { color: tokens.ink, fontSize: 12 },
        formatter: (p: any) => `周${WEEKDAYS[p.value[1]]} ${String(p.value[0]).padStart(2, "0")}:00<br/>${fmtUsd(p.value[2])}`,
      },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, h) => h), ...axisBase, splitLine: { show: false }, axisLabel: { ...axisBase.axisLabel, interval: 3 } },
      yAxis: { type: "category", data: WEEKDAYS, ...axisBase, splitLine: { show: false }, axisLine: { show: false } },
      visualMap: {
        min: 0,
        max,
        show: false,
        inRange: { color: [tokens.hover, tokens.accent, tokens.accentStrong] },
      },
      series: [
        {
          type: "heatmap",
          data: heatmap.cells.map((c) => [c.hour, c.weekday, Number(c.costUsd.toFixed(3))]),
          itemStyle: { borderColor: tokens.panel, borderWidth: 2, borderRadius: 3 },
        },
      ],
    };
  }, [heatmap, tokens, axisBase]);

  const mismatches = calibration?.filter((r) => r.status === "mismatch") ?? [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[26px] font-semibold tracking-tight">仪表盘</h1>
        <div className="flex rounded-lg border border-line p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                range === r.key ? "bg-hover font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {unpriced && unpriced.models.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-accent-soft px-4 py-2.5 text-sm">
          {unpriced.models.length} 个模型未定价(
          {unpriced.models.map((m) => m.model).join("、")}),其用量未计入费用。可在配置页添加价目。
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="API 等价费用" value={summary ? fmtUsd(summary.costUsd) : "—"} hint={summary ? `${summary.events.toLocaleString()} 次调用` : undefined} />
        <Stat label="输出 tokens" value={summary ? fmtTokens(summary.outputTokens) : "—"} hint={summary ? `输入 ${fmtTokens(summary.inputTokens)}` : undefined} />
        <Stat label="缓存读取" value={summary ? fmtTokens(summary.cacheReadTokens) : "—"} hint={cache ? `命中率 ${(cache.hitRate * 100).toFixed(1)}%` : undefined} />
        <Stat label="缓存节省" value={cache ? fmtUsd(cache.savedUsd) : "—"} hint="相对无缓存输入价" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Card title="每日费用">{dailyOption ? <EChart option={dailyOption} height={240} /> : <ChartSkeleton />}</Card>
        </div>
        <Card title="按模型">{modelOption ? <EChart option={modelOption} height={260} /> : <ChartSkeleton />}</Card>
        <Card title="按项目 TOP 10">{projectOption ? <EChart option={projectOption} height={260} /> : <ChartSkeleton />}</Card>
        <div className="lg:col-span-2">
          <Card title="活跃时段(周 × 小时)">{heatmapOption ? <EChart option={heatmapOption} height={240} /> : <ChartSkeleton />}</Card>
        </div>
      </div>

      <div className="mt-4">
        <Card title="价目校准(对照 Claude Code 官方 costUSD)">
          {!calibration ? (
            <ChartSkeleton />
          ) : (
            <div>
              <p className="text-sm text-muted">
                {calibration.filter((r) => r.status === "ok").length}/{calibration.length} 项目·模型在容差内
                {mismatches.length > 0 && `,${mismatches.length} 项偏差`}
              </p>
              {mismatches.length > 0 && (
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="pb-2 font-normal">项目</th>
                      <th className="pb-2 font-normal">模型</th>
                      <th className="pb-2 text-right font-normal">官方</th>
                      <th className="pb-2 text-right font-normal">我方区间</th>
                      <th className="pb-2 text-right font-normal">偏差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.map((r) => (
                      <tr key={`${r.cwd}-${r.model}`} className="border-b border-line/60">
                        <td className="py-2">{r.cwd.split("/").at(-1)}</td>
                        <td className="py-2 font-mono text-xs">{r.model}</td>
                        <td className="py-2 text-right tabular-nums">{fmtUsd(r.officialUsd)}</td>
                        <td className="py-2 text-right tabular-nums">
                          {fmtUsd(r.oursLowUsd)} – {fmtUsd(r.oursHighUsd)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-danger">{(r.deviation * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-40 animate-pulse rounded-lg bg-hover/50" />;
}
