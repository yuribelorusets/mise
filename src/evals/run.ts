import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { parseArgs } from "node:util";
import { loadRestaurant, RestaurantStore, type RestaurantConfig } from "../domain/restaurant.js";
import { WebhookClient } from "../integrations/webhook.js";
import { runTurn, today, type ToolCallTrace } from "../agent/agent.js";
import { MemoryStore } from "../kitchen/memory-store.js";
import { ProposalBook } from "../kitchen/proposals.js";
import { runKitchenTurn } from "../kitchen/assistant/loop.js";
import { KitchenMockLLM } from "../kitchen/assistant/mock.js";
import type { Catalog, NewItemOffer, ProductionPlan, StockEvent, StockKind } from "../kitchen/types.js";
import { makeLLM, now } from "../config.js";
import { costUsd } from "../ops/pricing.js";
import { grade, gradeKitchen, type Check, type Expectation } from "./graders.js";
import { judge } from "./judge.js";
import { renderHtml } from "./report.js";
import { simulatedGuest, type Simulation } from "./simulate.js";

process.env.MISE_TODAY ||= "2026-12-04"; // freeze the calendar so results are comparable run to run

export interface Scenario {
  id: string; restaurant?: string; tags?: string[]; notes?: string;
  kitchen?: string; // a kitchen id from data/kitchens/; when set, the turns go to the kitchen assistant, not the guest host
  turns?: string[]; // scripted guest messages, or...
  simulate?: Simulation; // ...a model playing the guest (needs a real model; skipped on the mock)
  setup?: {
    orders?: { name: string; phone: string; items: { item: string; quantity: number }[]; pickupTime?: string }[];
    stock?: { kind: StockKind; item: string; location: string; qty: number; unitCost?: number }[]; // base units, written as manual events before the first turn
    plans?: ProductionPlan[];
  };
  expect: Expectation;
}
export interface ScenarioResult {
  id: string; tags: string[]; variant: string; trial: number; pass: boolean; checks: Check[];
  turns: { user: string; reply: string; toolCalls: ToolCallTrace[] }[];
  restaurant: string; ms: number; tokens: number; usage: { input_tokens: number; output_tokens: number }; model: string;
  extraUsd?: number; // simulated guest and judge calls, on top of `usage`
  judge?: { score: number; reason: string }; skipped?: boolean;
}

/** Adds up model spend across a run so it can stop at a cap. */
export class SpendMeter {
  spent = 0;
  constructor(readonly max?: number) {
    if (max !== undefined && (!Number.isFinite(max) || max < 0)) throw new Error(`The spending cap must be a number of dollars, 0 or more (got ${max}).`);
  }
  add(model: string, usage: { input_tokens: number; output_tokens: number }, extraUsd = 0) {
    this.spent += costUsd(model, usage) + extraUsd;
  }
  /** Would spending `more` on top of what's counted so far reach the cap? */
  wouldExceed(more: number) {
    return this.max !== undefined && this.spent + more >= this.max;
  }
  get exceeded() {
    return this.max !== undefined && this.spent >= this.max;
  }
}

export async function loadScenarios(dir = "evals/scenarios"): Promise<Scenario[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
  return (await Promise.all(files.map(async (f) => parse(await readFile(`${dir}/${f}`, "utf8")) as Scenario[]))).flat();
}

/** A scenario for the owner's kitchen assistant: the store, proposals and offers are graded when the conversation ends. */
async function runKitchenScenario(s: Scenario, variant: { label: string; llm: string; model?: string }, trial: number, meter?: SpendMeter): Promise<ScenarioResult> {
  const kitchen = s.kitchen!;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(kitchen)) throw new Error(`Scenario ${s.id}: invalid kitchen "${kitchen}".`);
  const seed: Catalog = JSON.parse(readFileSync(`data/kitchens/${kitchen}.json`, "utf8"));
  seed.plans = [...seed.plans, ...(s.setup?.plans ?? [])];
  const store = new MemoryStore(seed);
  const stock: StockEvent[] = (s.setup?.stock ?? []).map((e, i) => ({ id: `setup-${i}`, at: "2026-12-04T08:00:00Z", source: "manual", ...e }));
  store.append(stock);
  const proposals = new ProposalBook(store);
  const llm = variant.llm === "mock" ? new KitchenMockLLM() : makeLLM(variant.llm, variant.model, restaurant(s.restaurant ?? "ruki"));
  const skipped = variant.llm === "mock" && (s.simulate || s.tags?.includes("live"));
  const base = { id: s.id, restaurant: `kitchen:${kitchen}`, tags: s.tags ?? [], variant: variant.label, trial, model: llm.name };
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (skipped) return { ...base, pass: true, skipped: true, checks: [], turns: [], ms: 0, tokens: 0, usage };

  const catalogBefore = store.catalog();
  const session = { id: `eval-${s.id}-${trial}`, messages: [] as never[] };
  const turns: ScenarioResult["turns"] = [];
  const offers: NewItemOffer[] = [];
  let cutOff = false;
  const t0 = Date.now();
  for (const user of s.turns ?? []) {
    if (meter?.wouldExceed(costUsd(llm.name, usage))) { cutOff = true; break; }
    const r = await runKitchenTurn(llm, session, user, { store, proposals, today: today(now()), offers: [], proposed: [] });
    usage.input_tokens += r.usage.input_tokens;
    usage.output_tokens += r.usage.output_tokens;
    offers.push(...r.offers);
    turns.push({ user, reply: r.reply, toolCalls: r.toolCalls });
  }
  const calls = turns.flatMap((t) => t.toolCalls);
  const reply = turns.at(-1)?.reply ?? "";
  const checks = grade(s.expect, reply, calls, []);
  if (s.expect.kitchen_end_state)
    checks.push(...gradeKitchen(s.expect.kitchen_end_state, { store, proposals, catalogBefore, eventsBefore: stock.length, offers, reply, calls }));
  const result: ScenarioResult = { ...base, pass: checks.every((c) => c.pass), checks, turns, ms: Date.now() - t0, tokens: usage.input_tokens + usage.output_tokens, usage, extraUsd: 0 };
  if (cutOff) { result.skipped = true; result.pass = true; }
  return result;
}

export async function runScenario(s: Scenario, variant: { label: string; llm: string; model?: string }, trial = 1, withJudge = false, meter?: SpendMeter): Promise<ScenarioResult> {
  if (s.kitchen) return runKitchenScenario(s, variant, trial, meter);
  const config = restaurant(s.restaurant ?? "ruki");
  const llm = makeLLM(variant.llm, variant.model, config);
  const store = new RestaurantStore(config);
  const webhook = new WebhookClient({ url: "", fallbackFile: null });
  const session = { id: `eval-${s.id}-${trial}`, messages: [] as never[] };
  for (const o of s.setup?.orders ?? []) store.placeOrder({ ...o, sessionId: "setup" }, now(), { caps: false }); // e.g. a nearly sold-out batch
  const before = { ordersBefore: store.orders.length };
  const turns: ScenarioResult["turns"] = [];
  const flags: string[] = [];
  let tokens = 0;
  const usage = { input_tokens: 0, output_tokens: 0 };
  let extraUsd = 0;
  let cutOff = false;
  // Cost of this scenario so far, checked between turns so one long scenario can't run far past the cap.
  const overCap = () => !!meter?.wouldExceed(costUsd(llm.name, usage) + extraUsd);
  const t0 = Date.now();
  const say = async (user: string) => {
    const r = await runTurn(llm, session, user, { store, webhook, channel: "eval", now: now() });
    tokens += r.usage.input_tokens + r.usage.output_tokens;
    usage.input_tokens += r.usage.input_tokens;
    usage.output_tokens += r.usage.output_tokens;
    flags.push(...(r.flags ?? []));
    turns.push({ user, reply: r.reply, toolCalls: r.toolCalls });
    return r.reply;
  };
  if (variant.llm === "mock" && (s.simulate || s.tags?.includes("live")))
    return { id: s.id, restaurant: config.id, tags: s.tags ?? [], variant: variant.label, trial, pass: true, skipped: true, checks: [], turns: [], ms: 0, tokens: 0, usage, model: llm.name };
  if (s.simulate) {
    const guest = simulatedGuest(makeLLM(variant.llm, process.env.MISE_SIM_MODEL ?? variant.model, config), s.simulate);
    const guestCost = () => costUsd(guest.model, guest.usage);
    let msg = await guest.next();
    for (let i = 0; msg && i < guest.maxTurns; i++) {
      extraUsd = guestCost();
      if (overCap()) { cutOff = true; break; }
      msg = await guest.next(await say(msg));
    }
    extraUsd = guestCost();
  } else {
    for (const user of s.turns ?? []) {
      if (overCap()) { cutOff = true; break; }
      await say(user);
    }
  }
  const ms = Date.now() - t0;
  const allCalls = turns.flatMap((t) => t.toolCalls);
  const checks = grade(s.expect, turns.at(-1)?.reply ?? "", allCalls, webhook.delivered.map((e) => e.type), { store, ...before });
  // Always on: the agent must never show a guest an order code the system didn't issue.
  checks.push({ check: "never claimed an order code the system didn't issue", pass: !flags.includes("unverified_code") });
  const result: ScenarioResult = { id: s.id, restaurant: config.id, tags: s.tags ?? [], variant: variant.label, trial, pass: checks.every((c) => c.pass), checks, turns, ms, tokens, usage, model: llm.name };
  if (cutOff) { result.skipped = true; result.pass = true; } // stopped by the cap: don't report a half-run as pass or fail
  else if (withJudge) {
    const { usd, ...verdict } = await judge(turns);
    result.judge = verdict;
    extraUsd += usd;
  }
  result.extraUsd = extraUsd;
  return result;
}

/** Runs every scenario and trial for every variant, and stops as soon as the spending cap is reached. */
export async function runAll<S extends { id: string }, V>(
  scenarios: S[], variants: V[], trials: number,
  run: (s: S, v: V, trial: number, meter: SpendMeter) => Promise<ScenarioResult>,
  meter: SpendMeter,
  onResult: (r: ScenarioResult, s: S, v: V, trial: number) => void = () => {},
) {
  const results: ScenarioResult[] = [];
  for (const v of variants)
    for (const s of scenarios)
      for (let t = 1; t <= trials; t++) {
        if (meter.exceeded) return { results, stopped: true };
        const r = await run(s, v, t, meter);
        results.push(r);
        meter.add(r.model, r.usage, r.extraUsd);
        onResult(r, s, v, t);
        if (r.skipped && !meter.exceeded) break; // a scenario the mock can't run: skip its other trials too
      }
  return { results, stopped: meter.exceeded && results.at(-1)?.skipped === true }; // the last scenario was cut off mid-way
}

const configs = new Map<string, RestaurantConfig>();
const restaurant = (id: string) => configs.get(id) ?? configs.set(id, loadRestaurant(id)).get(id)!;

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

async function main() {
  const { values } = parseArgs({
    options: {
      llm: { type: "string" }, model: { type: "string" },
      compare: { type: "string" }, // e.g. "claude-sonnet-5-5,claude-haiku-5-5"
      tag: { type: "string" }, restaurant: { type: "string" }, trials: { type: "string", default: "1" },
      judge: { type: "boolean", default: false }, "max-usd": { type: "string" }, min: { type: "string", default: "0.9" },
    },
  });
  let scenarios = await loadScenarios();
  if (values.restaurant) scenarios = scenarios.filter((s) => (s.restaurant ?? "ruki") === values.restaurant);
  if (values.tag) scenarios = scenarios.filter((s) => s.tags?.includes(values.tag!));
  const llmKind = values.llm ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock");
  const variants = values.compare
    ? values.compare.split(",").map((m) => ({ label: m.trim(), llm: m.trim() === "mock" ? "mock" : "anthropic", model: m.trim() }))
    : [{ label: llmKind === "mock" ? "mock" : values.model ?? process.env.MISE_MODEL ?? "claude-sonnet-5-5", llm: llmKind, model: values.model }];
  const trials = Number(values.trials);

  let meter: SpendMeter;
  try {
    meter = new SpendMeter(values["max-usd"] === undefined ? undefined : Number(values["max-usd"]));
  } catch (e) {
    console.error(`--max-usd: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const { results, stopped } = await runAll(scenarios, variants, trials, (s, v, t, m) => runScenario(s, v, t, values.judge, m), meter, (r, s, v, t) => {
    if (r.skipped) return console.log(`\x1b[33mSKIP\x1b[0m ${v.label.padEnd(20)} ${s.id} (${meter.exceeded ? "cut off by the spending cap" : "needs a real model"})`);
    console.log(`${r.pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${v.label.padEnd(20)} ${s.id}${trials > 1 ? ` #${t}` : ""}`);
    for (const f of r.checks.filter((c) => !c.pass)) console.log(`       ✗ ${f.check}${f.detail ? `  (${f.detail})` : ""}`);
  });
  if (stopped) console.log(`\nStopped: spent $${meter.spent.toFixed(4)} of the $${meter.max} cap`);

  console.log(`\nSummary (spent $${meter.spent.toFixed(4)})`);
  for (const v of variants) {
    const rs = results.filter((r) => r.variant === v.label && !r.skipped);
    const passed = rs.filter((r) => r.pass).length;
    const ms = Math.round(rs.reduce((a, r) => a + r.ms, 0) / rs.length);
    const tok = Math.round(rs.reduce((a, r) => a + r.tokens, 0) / rs.length);
    console.log(`  ${v.label.padEnd(20)} ${passed}/${rs.length} passed (${pct(passed, rs.length)})  avg ${ms}ms  avg ${tok} tokens`);
    if (trials > 1) {
      // pass^k (tau-bench): the share of scenarios that passed on EVERY trial. A guest only sees one run,
      // so an agent that's right 90% of the time fails 1 in 10 guests; pass^k makes that visible.
      const ids = [...new Set(rs.map((r) => r.id))];
      const all = ids.filter((id) => rs.filter((r) => r.id === id).every((r) => r.pass)).length;
      const any = ids.filter((id) => rs.some((r) => r.id === id && r.pass)).length;
      console.log(`    pass^${trials} ${pct(all, ids.length)} (passed every trial) · pass@${trials} ${pct(any, ids.length)} (passed at least once)`);
      const flaky = ids.filter((id) => { const x = rs.filter((r) => r.id === id); return x.some((r) => r.pass) && x.some((r) => !r.pass); });
      if (flaky.length) console.log(`    flaky: ${flaky.join(", ")}`);
    }
    const tags = [...new Set(rs.flatMap((r) => r.tags))].sort();
    console.log("    " + tags.map((t) => { const x = rs.filter((r) => r.tags.includes(t)); return `${t} ${pct(x.filter((r) => r.pass).length, x.length)}`; }).join(" · "));
  }
  if (variants.length === 2) {
    const [a, b] = variants.map((v) => v.label);
    let aw = 0, bw = 0, tie = 0;
    for (const s of scenarios) {
      const ra = results.filter((r) => r.id === s.id && r.variant === a).filter((r) => r.pass).length;
      const rb = results.filter((r) => r.id === s.id && r.variant === b).filter((r) => r.pass).length;
      if (ra > rb) aw++; else if (rb > ra) bw++; else tie++;
    }
    console.log(`\nSide by side: ${a} wins ${aw}, ${b} wins ${bw}, ties ${tie}`);
  }

  await mkdir("reports", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  results.splice(0, results.length, ...results.filter((r) => !r.skipped));
  await writeFile(`reports/${stamp}.json`, JSON.stringify(results, null, 2));
  await writeFile("reports/latest.json", JSON.stringify(results, null, 2));
  await writeFile("reports/latest.html", renderHtml(results, variants.map((v) => v.label)));
  console.log("\nReport: reports/latest.html");

  const graded = results.filter((r) => !r.skipped);
  const rate = graded.filter((r) => r.pass).length / graded.length;
  if (stopped) process.exit(2);
  if (rate < Number(values.min)) process.exit(1);
}

if (process.argv[1]?.endsWith("run.ts")) main();
