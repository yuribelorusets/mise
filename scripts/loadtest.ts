/**
 * Pop-up morning in fast-forward: hundreds of guests order at once against a
 * limited batch, through the real HTTP server, with model latency simulated.
 * Pass = no server errors, no overselling, no overfilled windows, and every
 * order code a guest was shown exists in the store.
 *
 *   npm run loadtest                 # 300 guests
 *   npm run loadtest -- 1000 40      # 1000 guests, 40 at a time
 */
import { createApp } from "../src/server.js";
import { loadRestaurant } from "../src/domain/restaurant.js";
import { MockLLM } from "../src/llm/mock.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import type { LLM } from "../src/llm/types.js";

process.env.MISE_TODAY ||= "2026-12-04";
const GUESTS = Number(process.argv[2] ?? 300);
const CONCURRENCY = Number(process.argv[3] ?? 50);
const config = loadRestaurant("ruki");

// The offline model plus 150-600 ms of latency per call, roughly what a hosted model adds.
const mock = new MockLLM(config);
const llm: LLM = { name: "mock", complete: async (req) => { await new Promise((r) => setTimeout(r, 150 + Math.random() * 450)); return mock.complete(req); } };

const app = createApp({ config, llm, webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 1e9, dailyBudgetUsd: 1e9 } });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const items = ["syrniki", "nalysnyky", "bagel", "dill bagel", "black tea"];
const windows = config.popup!.pickupWindows;
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const latencies: number[] = [];
const statuses = new Map<number, number>();
const shownCodes = new Set<string>();

async function say(sessionId: string, message: string) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, message }) });
  latencies.push(performance.now() - t0);
  statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
  const body = await res.json().catch(() => ({}));
  for (const c of String(body.reply ?? "").match(/\bRK-[A-Z0-9]{6}\b/g) ?? []) shownCodes.add(c);
  return body;
}

async function guest(i: number) {
  const id = `load-${i}`;
  await say(id, `Can I preorder ${1 + Math.floor(Math.random() * 4)} ${pick(items)} for ${pick(windows)}?`);
  await say(id, `Guest${i}, 510-555-${String(i).padStart(4, "0")}`);
  if (Math.random() < 0.2) await say(id, "Yes, please confirm that order!"); // repeaters must not double-order
}

const mem0 = process.memoryUsage().heapUsed;
const t0 = performance.now();
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (next < GUESTS) await guest(next++); }));
const secs = (performance.now() - t0) / 1000;

// Check invariants through the owner's own API.
process.env.ADMIN_TOKEN ||= "load";
const sum = await (await fetch(`${base}/admin/api/summary`, { headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } })).json();
server.close();

const sorted = [...latencies].sort((a, b) => a - b);
const q = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
const orderIds = new Set<string>(sum.orders.map((o: { id: string }) => o.id));
const problems: string[] = [];
for (const p of sum.prep) if (p.batch !== null && p.sold > p.batch) problems.push(`oversold ${p.name}: ${p.sold}/${p.batch}`);
for (const w of sum.windows) if (w.orders.length > config.popup!.ordersPerWindow) problems.push(`window ${w.time} has ${w.orders.length} orders`);
for (const c of shownCodes) if (!orderIds.has(c)) problems.push(`guest was shown ${c}, which doesn't exist`);
const errors = [...statuses].filter(([s]) => s >= 500).reduce((n, [, c]) => n + c, 0);
if (errors) problems.push(`${errors} server errors`);

console.log(`${GUESTS} guests, ${CONCURRENCY} at a time, ${latencies.length} messages in ${secs.toFixed(1)}s (${Math.round(latencies.length / secs)} msg/s)`);
console.log(`latency p50 ${q(0.5)}ms · p95 ${q(0.95)}ms · p99 ${q(0.99)}ms · statuses ${JSON.stringify(Object.fromEntries(statuses))}`);
console.log(`orders ${sum.kpis.orders} · revenue $${sum.kpis.revenue} · sold ${sum.prep.map((p: { id: string; sold: number; batch: number }) => `${p.id} ${p.sold}/${p.batch}`).join(", ")}`);
console.log(`windows ${sum.windows.map((w: { time: string; orders: unknown[] }) => `${w.time}:${w.orders.length}`).join(" ")} · heap +${Math.round((process.memoryUsage().heapUsed - mem0) / 1e6)} MB`);
console.log(problems.length ? `\n\x1b[31mFAIL\x1b[0m\n  ${problems.join("\n  ")}` : "\n\x1b[32mPASS\x1b[0m no oversells, no overfilled windows, no phantom order codes, no server errors");
process.exit(problems.length ? 1 : 0);

