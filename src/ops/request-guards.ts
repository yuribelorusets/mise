import type { RequestHandler } from "express";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `/api` writes must be JSON. A browser only sends JSON cross-site after a CORS preflight, which we never answer,
 * so this alone stops a plain HTML form from posting here. `req.is()` returns null for a request with no body,
 * so read the header.
 */
export const jsonOnly: RequestHandler = (req, res, next) => {
  if (!WRITES.has(req.method) || !req.path.startsWith("/api/")) return next();
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return res.status(415).json({ error: "Send the request as JSON." });
  next();
};

/** Writes from a browser must come from our own pages. `Sec-Fetch-Site` first (every current browser sends it), then `Origin`. */
export function sameOrigin(allowed: string[] = []): RequestHandler {
  return (req, res, next) => {
    if (!WRITES.has(req.method)) return next();
    const site = req.get("sec-fetch-site");
    if (site) return site === "same-origin" || site === "none" ? next() : refuse(res);
    const origin = req.get("origin");
    if (!origin) return next();
    return origin === `${req.protocol}://${req.get("host")}` || allowed.includes(origin) ? next() : refuse(res);
  };
}

const refuse = (res: Parameters<RequestHandler>[1]) => res.status(403).json({ error: "That request came from another site." });
