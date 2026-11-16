import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Order, Recorder } from "../domain/restaurant.js";

export interface TurnLog {
  at: string;
  sessionId: string;
  channel: string;
  user: string;
  reply: string;
  tools: { name: string; isError: boolean }[];
  handoff: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  degraded?: boolean;
  flags?: string[];
}

type Entry =
  | { kind: "order"; at: string; value: Order }
  | { kind: "turn"; at: string; value: TurnLog };

/**
 * Append-only JSONL log of everything that happened: orders and every
 * conversation turn with its cost. Replayed on startup so a restart doesn't lose
 * orders or oversell a sold-out batch. With no directory it keeps everything in memory.
 */
export class Ledger implements Recorder {
  readonly orders: Order[] = [];
  readonly turns: TurnLog[] = [];
  private file?: string;
  private entries: Entry[] = [];

  constructor(dir: string | undefined, restaurantId: string) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${restaurantId}.jsonl`);
    if (!existsSync(this.file)) return;
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as Entry;
        // Lines of any other kind (old table-booking entries) are skipped.
        if (e.kind === "order" || e.kind === "turn") this.entries.push(e);
      } catch {
        // a torn last line after a crash: skip it rather than refuse to start
      }
    }
    this.load();
  }

  private load() {
    this.orders.length = 0;
    this.turns.length = 0;
    for (const e of this.entries) {
      if (e.kind === "order") this.orders.push(e.value);
      else this.turns.push(e.value);
    }
  }

  /** Drop chats older than `retainDays` and strip name and phone from older orders (kept for totals). */
  compact(now: Date, retainDays: number) {
    if (!this.file) return;
    const cutoff = now.getTime() - retainDays * 86_400_000;
    const old = (e: Entry) => Date.parse(e.at) < cutoff;
    this.entries = this.entries
      .filter((e) => !(e.kind === "turn" && old(e)))
      .map((e) => (e.kind === "order" && old(e) ? { ...e, value: { ...e.value, name: "[removed]", phone: "" } } : e));
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.entries.map((e) => JSON.stringify(e) + "\n").join(""));
    renameSync(tmp, this.file);
    this.load();
  }

  get persistent() {
    return !!this.file;
  }

  private write(e: Entry) {
    if (!this.file) return;
    this.entries.push(e);
    appendFileSync(this.file, JSON.stringify(e) + "\n");
  }

  /** Called by RestaurantStore. The store keeps its own copy, so only persist here. */
  record(kind: "order", value: Order) {
    this.write({ kind, at: new Date().toISOString(), value } as Entry);
  }

  logTurn(t: TurnLog) {
    this.turns.push(t);
    this.write({ kind: "turn", at: t.at, value: t });
  }

  /** Model spend since local midnight (UTC is close enough for a budget cap). */
  spentToday(now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    return this.turns.filter((t) => t.at.startsWith(day)).reduce((s, t) => s + t.costUsd, 0);
  }
}
