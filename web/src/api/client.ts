export class ApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

async function errorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
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
