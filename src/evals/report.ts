import type { ScenarioResult } from "./run.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A single self-contained HTML page: pass rate per variant, then every scenario with its transcript and checks. */
export function renderHtml(results: ScenarioResult[], variants: string[]): string {
  const summary = variants.map((v) => {
    const rs = results.filter((r) => r.variant === v);
    const p = rs.filter((r) => r.pass).length;
    return `<div class="card"><div class="k">${esc(v)}</div><div class="big">${Math.round((100 * p) / rs.length)}%</div><div class="k">${p}/${rs.length} scenarios</div></div>`;
  }).join("");
  const rows = results.map((r) => `
    <details class="${r.pass ? "ok" : "bad"}"><summary><b>${r.pass ? "PASS" : "FAIL"}</b> ${esc(r.id)} <span class="k">${esc(r.variant)} · ${r.tags.join(", ")} · ${r.ms}ms</span></summary>
    ${r.turns.map((t) => `<p class="u">Guest: ${esc(t.user)}</p>${t.toolCalls.map((c) => `<p class="t">↳ ${esc(c.name)} ${esc(JSON.stringify(c.input))}${c.isError ? " (error)" : ""}</p>`).join("")}<p class="a">Host: ${esc(t.reply)}</p>`).join("")}
    <ul>${r.checks.map((c) => `<li class="${c.pass ? "ok" : "bad"}">${c.pass ? "✓" : "✗"} ${esc(c.check)}${c.detail ? ` <span class="k">${esc(c.detail)}</span>` : ""}</li>`).join("")}</ul>
    ${r.judge ? `<p class="k">Judge: ${r.judge.score}/5, ${esc(r.judge.reason)}</p>` : ""}</details>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mise eval report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#1c1917;background:#fafaf9}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 24px}.card{background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:12px 16px;min-width:160px}
.big{font-size:32px;font-weight:700}.k{color:#78716c;font-size:13px}details{background:#fff;border:1px solid #e7e5e4;border-left:4px solid;border-radius:8px;margin:8px 0;padding:8px 12px}
details.ok{border-left-color:#16a34a}details.bad{border-left-color:#dc2626}summary{cursor:pointer}.u{margin:8px 0 2px}.t{margin:0;color:#57534e;font-family:ui-monospace,monospace;font-size:12px}
.a{margin:2px 0 8px;color:#1d4ed8}li.ok{color:#15803d}li.bad{color:#b91c1c}</style></head>
<body><h1>Mise eval report</h1><p class="k">${new Date().toISOString()} · ${results.length} runs</p><div class="cards">${summary}</div>${rows}</body></html>`;
}
