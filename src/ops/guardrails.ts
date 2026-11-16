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

export const limitsFromEnv = (): Limits => ({
  perMinute: Number(process.env.MISE_RATE_PER_MIN ?? 10),
  turnsPerSession: Number(process.env.MISE_MAX_TURNS ?? 30),
  dailyBudgetUsd: Number(process.env.MISE_DAILY_BUDGET_USD ?? 2),
});
