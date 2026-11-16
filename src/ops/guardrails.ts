/** Fixed-window rate limiter keyed by visitor (IP). In memory: fine for one instance. */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  constructor(private limit: number, private windowMs = 60_000) {}

  allow(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      if (this.hits.size > 10_000) this.prune(now);
      return true;
    }
    h.count++;
    return h.count <= this.limit;
  }

  private prune(now: number) {
    for (const [k, h] of this.hits) if (now - h.start >= this.windowMs) this.hits.delete(k);
  }
}

export interface Limits {
  perMinute: number; // messages per visitor per minute
  turnsPerSession: number; // a real guest finishes an order in well under this
  dailyBudgetUsd: number; // once spent, the agent stops calling the model and hands off
}

/** A positive number from an environment variable, otherwise the default and a warning. */
function envNumber(name: string, fallback: number, whole = false): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = raw.trim() === "" ? Number.NaN : Number(raw);
  if (Number.isFinite(n) && n > 0 && (!whole || Number.isInteger(n))) return n;
  console.warn(`${name}="${raw}" isn't a ${whole ? "whole " : ""}number above 0; using ${fallback}.`);
  return fallback;
}

export const limitsFromEnv = (): Limits => ({
  perMinute: envNumber("MISE_RATE_PER_MIN", 10, true),
  turnsPerSession: envNumber("MISE_MAX_TURNS", 30, true),
  dailyBudgetUsd: envNumber("MISE_DAILY_BUDGET_USD", 2),
});
