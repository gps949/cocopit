type Client = ReadableStreamDefaultController<Uint8Array>;

export interface SseHubOptions {
  heartbeatMs?: number;
}

const encoder = new TextEncoder();

/** Server-sent-events fan-out: one hub, many subscribers, named events. */
export class SseHub {
  #clients = new Set<Client>();
  #heartbeatMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SseHubOptions = {}) {
    this.#heartbeatMs = opts.heartbeatMs ?? 15_000;
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  handler = (req: Request): Response => {
    const clients = this.#clients;
    let client: Client;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        client = controller;
        clients.add(controller);
        controller.enqueue(encoder.encode(": connected\n\n"));
        this.#ensureTimer();
        req.signal.addEventListener("abort", () => this.#drop(client));
      },
      cancel: () => {
        this.#drop(client);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  };

  broadcast(event: string, data: unknown): void {
    this.#send(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  }

  #send(payload: Uint8Array): void {
    for (const client of [...this.#clients]) {
      try {
        client.enqueue(payload);
      } catch {
        this.#drop(client);
      }
    }
  }

  #drop(client: Client): void {
    if (!this.#clients.delete(client)) return;
    try {
      client.close();
    } catch {
      // already closed by the consumer
    }
    if (this.#clients.size === 0 && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  #ensureTimer(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.#send(encoder.encode(": ping\n\n")), this.#heartbeatMs);
  }
}
