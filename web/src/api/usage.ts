export interface UsageSummary {
  events: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  unpricedEvents: number;
  webSearchRequests: number;
}

export interface DailyUsage {
  days: Array<{ day: string; costUsd: number; tokens: number; events: number }>;
}

export interface ModelUsage {
  models: Array<{
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    events: number;
    unpriced: boolean;
  }>;
}

export interface ProjectUsage {
  projects: Array<{
    projectId: number;
    dirName: string;
    cwd: string | null;
    costUsd: number;
    tokens: number;
    events: number;
  }>;
}

export interface HeatmapUsage {
  cells: Array<{ weekday: number; hour: number; costUsd: number; events: number }>;
}

export interface CacheEfficiency {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  hitRate: number;
  savedUsd: number;
}

export interface CalibrationRow {
  cwd: string;
  model: string;
  officialUsd: number;
  oursLowUsd: number;
  oursHighUsd: number;
  status: "ok" | "mismatch" | "unpriced";
  deviation: number;
}

export interface UnpricedModels {
  models: Array<{ model: string; events: number; totalTokens: number; firstTs: number; lastTs: number }>;
}

export type RangeKey = "7d" | "30d" | "90d" | "all";

export function rangeToQuery(range: RangeKey, product: "claude" | "codex" = "claude"): string {
  // tzOffset: minutes east of UTC, so the server buckets days/hours in the
  // viewer's timezone rather than its own (they differ on remote deployments)
  const parts = [`tzOffset=${-new Date().getTimezoneOffset()}`];
  if (product !== "claude") parts.push(`product=${product}`);
  if (range !== "all") {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    parts.unshift(`from=${Date.now() - days * 86_400_000}`);
  }
  return `?${parts.join("&")}`;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
