import { createHmac, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";

export type MiseEventType = "order.placed" | "handoff.requested";

export interface MiseEvent {
  id: string; // idempotency key: receivers should dedupe on this
  type: MiseEventType;
  occurredAt: string;
  sessionId: string;
  channel: "chat" | "eval";
  data: Record<string, unknown>;
}

export const sign = (body: string, secret: string) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface WebhookOptions {
  url?: string;
  secret?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: Fetch;
  fallbackFile?: string | null;
  timeoutMs?: number; // per attempt; a hung endpoint can't hold a delivery forever
}

/**
 * Delivers events to a CRM (Zapier, Make, HubSpot workflow, n8n...).
 * Signed with HMAC-SHA256, retried with exponential backoff on 5xx/network errors,
 * and written to a local JSONL file when no URL is configured.
 */
export class WebhookClient {
  readonly delivered: MiseEvent[] = [];
  private url?: string;
  private secret: string;
  private maxAttempts: number;
  private baseDelayMs: number;
  private fetchImpl: Fetch;
  private fallbackFile: string | null;
  private timeoutMs: number;

  constructor(o: WebhookOptions = {}) {
    this.url = o.url ?? process.env.CRM_WEBHOOK_URL ?? undefined;
    this.secret = o.secret ?? process.env.CRM_WEBHOOK_SECRET ?? "dev-secret";
    this.maxAttempts = o.maxAttempts ?? 3;
    this.baseDelayMs = o.baseDelayMs ?? 300;
    this.fetchImpl = o.fetchImpl ?? (fetch as unknown as Fetch);
    this.fallbackFile = o.fallbackFile === undefined ? "events.jsonl" : o.fallbackFile;
    this.timeoutMs = o.timeoutMs ?? 5000;
  }

  build(type: MiseEventType, sessionId: string, channel: MiseEvent["channel"], data: Record<string, unknown>): MiseEvent {
    return { id: randomUUID(), type, occurredAt: new Date().toISOString(), sessionId, channel, data };
  }

  async send(event: MiseEvent): Promise<{ delivered: boolean; attempts: number; status?: number }> {
    this.delivered.push(event);
    if (this.delivered.length > 500) this.delivered.splice(0, this.delivered.length - 500); // recent events only; don't grow forever
    const body = JSON.stringify(event);
    if (!this.url) {
      if (this.fallbackFile) await appendFile(this.fallbackFile, body + "\n");
      return { delivered: true, attempts: 0 };
    }
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-mise-event": event.type,
            "x-mise-delivery": event.id,
            "x-mise-signature": sign(body, this.secret),
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        lastStatus = res.status;
        if (res.ok) return { delivered: true, attempts: attempt, status: res.status };
        if (res.status < 500 && res.status !== 429) return { delivered: false, attempts: attempt, status: res.status };
      } catch {
        lastStatus = undefined;
      }
      if (attempt < this.maxAttempts) await new Promise((r) => setTimeout(r, this.baseDelayMs * 2 ** (attempt - 1)));
    }
    return { delivered: false, attempts: this.maxAttempts, status: lastStatus };
  }
}
