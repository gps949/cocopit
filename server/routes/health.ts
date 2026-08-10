import type { HealthResponse } from "../../shared/types";
import type { Handler } from "../http/router";

let cachedVersion: string | undefined;

async function readVersion(): Promise<string> {
  if (cachedVersion === undefined) {
    const pkg = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
      version?: string;
    };
    cachedVersion = pkg.version ?? "0.0.0";
  }
  return cachedVersion;
}

export const healthHandler: Handler = async () => {
  const body: HealthResponse = { ok: true, version: await readVersion() };
  return Response.json(body);
};
