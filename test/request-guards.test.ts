import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { MockLLM } from "../src/llm/mock.js";
import { WebhookClient } from "../src/integrations/webhook.js";

let server: Server;
let base = "";
beforeAll(async () => {
  process.env.MISE_TODAY = "2026-12-04";
  const app = createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 1000 } });
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => server.close());

const chat = (headers: Record<string, string>, body = JSON.stringify({ sessionId: "g", message: "hi" })) =>
  fetch(`${base}/api/chat`, { method: "POST", headers, body });

describe("request guards", () => {
  it("refuses a form-encoded POST with 415", async () => {
    const res = await chat({ "content-type": "application/x-www-form-urlencoded" }, "sessionId=g&message=hi");
    expect(res.status).toBe(415);
  });
  it("refuses a POST with no content type", async () => {
    expect((await chat({})).status).toBe(415);
  });
  it("takes JSON with a charset", async () => {
    expect((await chat({ "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  });
  it("refuses a write from another site", async () => {
    expect((await chat({ "content-type": "application/json", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await chat({ "content-type": "application/json", origin: "https://evil.example" })).status).toBe(403);
  });
  it("takes a write from the same origin", async () => {
    expect((await chat({ "content-type": "application/json", "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await chat({ "content-type": "application/json", origin: base })).status).toBe(200);
  });
  it("leaves clients that send neither header alone", async () => {
    // curl, the load test and server-to-server calls aren't browsers, so they can't be tricked into a forged request.
    expect((await chat({ "content-type": "application/json" })).status).toBe(200);
  });
  it("doesn't guard reads", async () => {
    expect((await fetch(`${base}/api/config`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(200);
  });
});
