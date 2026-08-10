export type Params = Record<string, string>;

export type Handler = (req: Request, params: Params) => Response | Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export interface Match {
  handler: Handler;
  params: Params;
}

/** Minimal router: register (method, pattern, handler), match(req) finds it. */
export class Router {
  private routes: Route[] = [];

  register(method: string, pattern: string, handler: Handler): void {
    const segments = pattern.split("/").filter((segment) => segment.length > 0);
    this.routes.push({ method: method.toUpperCase(), segments, handler });
  }

  match(req: Request): Match | null {
    const method = req.method.toUpperCase();
    const pathname = new URL(req.url).pathname;
    const pathSegments = pathname.split("/").filter((segment) => segment.length > 0);

    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;

      const params: Params = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const routeSegment = route.segments[i]!;
        const pathSegment = pathSegments[i]!;
        if (routeSegment.startsWith(":")) {
          params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
        } else if (routeSegment !== pathSegment) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { handler: route.handler, params };
      }
    }

    return null;
  }
}
