/**
 * A fake of the server's /api for tests: `vi.stubGlobal("fetch", fakeApi(routes))`.
 * Routes are keyed "METHOD /path" (`:name` matches one path segment). A handler gets the parsed
 * JSON body and the request details, and returns the JSON to send, or `{ status, error?, ...rest }`
 * to send that status. Like the real server, a write without a JSON content type gets a 415.
 */
export interface FakeRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  headers: Headers;
}
export type FakeReply = unknown;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeRoutes = Record<string, (body: any, req: FakeRequest) => FakeReply | Promise<FakeReply>>;

const isStatus = (v: unknown): v is { status: number } =>
  typeof v === "object" && v !== null && typeof (v as { status?: unknown }).status === "number";

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/"), b = path.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** `calls` collects "METHOD /path?query" for each request, so a test can say what was fetched. */
export function fakeApi(routes: FakeRoutes, calls: string[] = []) {
  return async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url.pathname}${url.search}`);
    const headers = new Headers(init.headers);
    if (method !== "GET" && !(headers.get("Content-Type") ?? "").includes("application/json"))
      return json(415, { error: "Send JSON." });
    for (const [key, handler] of Object.entries(routes)) {
      const [m, pattern] = key.split(" ");
      const params = m === method ? match(pattern, url.pathname) : null;
      if (!params) continue;
      const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : {};
      const out = await handler(body, { params, query: url.searchParams, headers });
      if (isStatus(out)) {
        const { status, ...rest } = out as { status: number; [k: string]: unknown };
        return json(status, rest);
      }
      return json(200, out);
    }
    return json(404, { error: `No fake route for ${method} ${url.pathname}.` });
  };
}
