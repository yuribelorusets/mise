import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validates Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, fullUrl + sorted(key+value)...)).
 * Rejecting unsigned requests stops anyone from driving the agent by POSTing to the voice webhook.
 */
export function validTwilioSignature(authToken: string, signature: string | undefined, url: string, params: Record<string, string>): boolean {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const VOICES: Record<string, string> = { en: "en-US", es: "es-US", ru: "ru-RU", fr: "fr-FR" };

/** Say something, then listen for the caller's next sentence. */
export function sayAndGather(text: string, action: string, lang = "en"): string {
  const l = VOICES[lang] ?? "en-US";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${esc(action)}" method="POST" speechTimeout="auto" language="${l}"><Say language="${l}">${esc(text)}</Say></Gather><Redirect method="POST">${esc(action)}</Redirect></Response>`;
}

/** Say something, then transfer the call to a person. */
export function sayAndDial(text: string, phone: string, lang = "en"): string {
  const l = VOICES[lang] ?? "en-US";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${l}">${esc(text)}</Say><Dial>${esc(phone)}</Dial></Response>`;
}
