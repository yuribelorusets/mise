export class ApiError extends Error {
  /** The parsed JSON body of the error answer, for `problems` and `errors` lists. */
  constructor(public status: number, message?: string, public body?: Record<string, unknown>) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

async function errorBody(res: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await res.json();
    return body && typeof body === "object" ? body : undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const body = await errorBody(res);
    throw new ApiError(res.status, typeof body?.error === "string" ? body.error : undefined, body);
  }
  const text = res.status === 204 ? "" : await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE", headers: { "Content-Type": "application/json" } });
}
