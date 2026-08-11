export interface HealthResponse {
  ok: boolean;
  version: string;
}

export interface IndexStatus {
  phase: "idle" | "scanning";
  pct: number;
  bytesTotal: number;
  bytesDone: number;
  filesTotal: number;
  filesDone: number;
  currentFiles: string[];
  errors: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface CcockpitConfig {
  port: number;
  /** Listener bind address. Anything but loopback requires an access token. */
  host: string;
  claudeDir: string;
  /** Extra browser origins allowed to make write requests (reverse proxy / tunnel). */
  allowedOrigins: string[];
}
