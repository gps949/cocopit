export interface HealthResponse {
  ok: boolean;
  version: string;
}

export interface IndexStatus {
  phase: "idle" | "scanning";
  pct: number;
}
