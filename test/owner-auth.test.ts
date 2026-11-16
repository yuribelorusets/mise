import { describe, it, expect } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { MockLLM } from "../src/llm/mock.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import { FailedSignIns, Passcode } from "../src/ops/owner-auth.js";

async function start(opts: Parameters<typeof createApp>[0] = {}) {
  const app = createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 1000 }, ownerPasscode: "syrniki-2026", ...opts });
  const s = await new Promise<Server>((r) => { const x = app.listen(0, () => r(x)); });
  const a = s.address();
  return { url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, close: () => s.close() };
}
const json = { "content-type": "application/json" };
const signIn = (url: string, passcode: string, ip = "1.1.1.1") =>
  fetch(`${url}/api/owner/sign-in`, { method: "POST", headers: { ...json, "x-forwarded-for": ip }, body: JSON.stringify({ passcode }) });
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

describe("owner sign-in", () => {
  it("compares passcodes without keeping the plain one", () => {
    const p = new Passcode("syrniki-2026");
    expect(p.matches("syrniki-2026")).toBe(true);
    expect(p.matches("syrniki-2027")).toBe(false);
    expect(p.matches(42)).toBe(false);
    expect(JSON.stringify(p)).not.toContain("syrniki");
    expect(() => new Passcode("short")).toThrow(/8/);
  });

  it("sets an HttpOnly, SameSite=Strict cookie, Secure in production", async () => {
    const dev = await start();
    const res = await signIn(dev.url, "syrniki-2026");
    expect(res.status).toBe(204);
    const c = res.headers.get("set-cookie") ?? "";
    expect(c).toMatch(/^mise_owner=[A-Za-z0-9_-]{43};/);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).not.toMatch(/Secure/i);
    dev.close();
    const prod = await start({ secureCookies: true });
    expect((await signIn(prod.url, "syrniki-2026")).headers.get("set-cookie")).toMatch(/Secure/i);
    prod.close();
  });

  it("answers 401 on kitchen routes without a session, and lets the owner in with one", async () => {
    const s = await start();
    expect((await fetch(`${s.url}/api/kitchen/catalog`)).status).toBe(401);
    expect((await fetch(`${s.url}/api/kitchen/catalog`, { headers: { cookie: "mise_owner=made-up" } })).status).toBe(401);
    const cookie = cookieOf(await signIn(s.url, "syrniki-2026"));
    expect((await fetch(`${s.url}/api/kitchen/catalog`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${s.url}/api/owner/me`, { headers: { cookie } })).status).toBe(200);
    await fetch(`${s.url}/api/owner/sign-out`, { method: "POST", headers: { ...json, cookie }, body: "{}" });
    expect((await fetch(`${s.url}/api/kitchen/catalog`, { headers: { cookie } })).status).toBe(401);
    s.close();
  });

  it("keeps the guest routes public", async () => {
    const s = await start();
    expect((await fetch(`${s.url}/api/config`)).status).toBe(200);
    expect((await fetch(`${s.url}/api/health`)).status).toBe(200);
    const res = await fetch(`${s.url}/api/chat`, { method: "POST", headers: json, body: JSON.stringify({ sessionId: "g", message: "hi" }) });
    expect(res.status).toBe(200);
    s.close();
  });

  it("slows down guessing after 5 wrong passcodes from one IP", async () => {
    const s = await start();
    for (let i = 0; i < 5; i++) expect((await signIn(s.url, `guess-${i}-xxxx`)).status).toBe(401);
    const blocked = await signIn(s.url, "syrniki-2026");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await signIn(s.url, "syrniki-2026", "2.2.2.2")).status).toBe(204);
    s.close();
  });

  it("forgets failures after the window, and caps them overall", () => {
    const f = new FailedSignIns({ perIp: 5, overall: 50, windowMs: 15 * 60_000 });
    for (let i = 0; i < 5; i++) f.fail("a", 0);
    expect(f.retryAfter("a", 1000)).toBeGreaterThan(0);
    expect(f.retryAfter("a", 15 * 60_000 + 1)).toBe(0);
    for (let i = 0; i < 50; i++) f.fail(`ip-${i}`, 0);
    expect(f.retryAfter("fresh", 1000)).toBeGreaterThan(0);
  });

  it("answers 503 when no passcode is set", async () => {
    const s = await start({ ownerPasscode: "" });
    expect((await signIn(s.url, "anything-at-all")).status).toBe(503);
    expect((await fetch(`${s.url}/api/kitchen/catalog`)).status).toBe(401);
    s.close();
  });
});
