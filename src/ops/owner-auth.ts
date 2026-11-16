import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import express, { type RequestHandler } from "express";

export const OWNER_COOKIE = "mise_owner";
const SESSION_MS = 30 * 24 * 60 * 60_000;
const MAX_SESSIONS = 50;

export class Passcode {
  readonly #salt = randomBytes(16);
  readonly #want: Buffer;
  constructor(passcode: string) {
    if (passcode.length < 8) throw new Error("MISE_OWNER_PASSCODE needs at least 8 characters.");
    this.#want = scryptSync(passcode, this.#salt, 32);
  }
  matches(given: unknown): boolean {
    if (typeof given !== "string" || given.length > 200) return false;
    return timingSafeEqual(scryptSync(given, this.#salt, 32), this.#want);
  }
}

export class FailedSignIns {
  private byIp = new Map<string, number[]>();
  private all: number[] = [];
  constructor(private o = { perIp: 5, overall: 50, windowMs: 15 * 60_000 }) {}
  private recent(list: number[], now: number) {
    return list.filter((t) => now - t < this.o.windowMs);
  }
  /** Seconds until this IP may try again, or 0. */
  retryAfter(ip: string, now = Date.now()): number {
    const mine = this.recent(this.byIp.get(ip) ?? [], now);
    this.all = this.recent(this.all, now);
    const until = [mine.length >= this.o.perIp ? mine[0] : undefined, this.all.length >= this.o.overall ? this.all[0] : undefined]
      .filter((t): t is number => t !== undefined)
      .map((t) => t + this.o.windowMs);
    return until.length ? Math.ceil((Math.max(...until) - now) / 1000) : 0;
  }
  fail(ip: string, now = Date.now()) {
    this.byIp.set(ip, [...this.recent(this.byIp.get(ip) ?? [], now), now]);
    this.all.push(now);
    if (this.byIp.size > 10_000) this.byIp.clear();
  }
  clear(ip: string) {
    this.byIp.delete(ip);
  }
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const readCookie = (header: string | undefined) =>
  header?.split(/;\s*/).find((s) => s.startsWith(`${OWNER_COOKIE}=`))?.slice(OWNER_COOKIE.length + 1);

export function ownerAuth(opts: { passcode?: string; secure: boolean; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let passcode: Passcode | undefined;
  let setupError = "Set MISE_OWNER_PASSCODE to turn on owner sign-in.";
  if (opts.passcode) {
    try { passcode = new Passcode(opts.passcode); } catch (e) { setupError = (e as Error).message; }
  }
  const sessions = new Map<string, number>(); // sha256(token) -> expires at
  const failed = new FailedSignIns();
  const attrs = `HttpOnly; SameSite=Strict; Path=/${opts.secure ? "; Secure" : ""}`;

  const signedIn = (cookie: string | undefined) => {
    const token = readCookie(cookie);
    const exp = token ? sessions.get(digest(token)) : undefined;
    return exp !== undefined && exp > now();
  };

  const requireOwner: RequestHandler = (req, res, next) =>
    signedIn(req.headers.cookie) ? next() : void res.status(401).json({ error: "Sign in first." });

  const router = express.Router();
  router.post("/api/owner/sign-in", (req, res) => {
    if (!passcode) return res.status(503).json({ error: setupError });
    const ip = req.ip ?? "unknown";
    const wait = failed.retryAfter(ip, now());
    if (wait) return res.status(429).set("Retry-After", String(wait)).json({ error: "Too many wrong passcodes. Try again later." });
    if (!passcode.matches(req.body?.passcode)) {
      failed.fail(ip, now());
      return res.status(401).json({ error: "That passcode isn't right." });
    }
    failed.clear(ip);
    const token = randomBytes(32).toString("base64url");
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    sessions.set(digest(token), now() + SESSION_MS);
    res.setHeader("Set-Cookie", `${OWNER_COOKIE}=${token}; ${attrs}; Max-Age=${SESSION_MS / 1000}`);
    res.status(204).end();
  });
  router.post("/api/owner/sign-out", (req, res) => {
    const token = readCookie(req.headers.cookie);
    if (token) sessions.delete(digest(token));
    res.setHeader("Set-Cookie", `${OWNER_COOKIE}=; ${attrs}; Max-Age=0`);
    res.status(204).end();
  });
  router.get("/api/owner/me", requireOwner, (_req, res) => res.json({ owner: true }));
  return { router, requireOwner };
}
