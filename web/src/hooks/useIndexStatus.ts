import { useEffect, useState } from "react";
import type { IndexStatus } from "../../../shared/types";

/**
 * Live index status: seeded via GET /api/index/status, then streamed over the
 * shared SSE channel (index.progress events).
 */
export function useIndexStatus(): IndexStatus | null {
  const [status, setStatus] = useState<IndexStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/index/status")
      .then((res) => (res.ok ? (res.json() as Promise<IndexStatus>) : null))
      .then((s) => {
        if (s && !cancelled) setStatus(s);
      })
      .catch(() => {});

    const es = new EventSource("/api/events");
    es.addEventListener("index.progress", (event) => {
      setStatus(JSON.parse((event as MessageEvent<string>).data) as IndexStatus);
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  return status;
}
