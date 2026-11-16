# Send orders to a Google Sheet

Most small food businesses already run on a spreadsheet. This sends every order, booking and handoff to one, live, in about five minutes. No Zapier account needed.

1. Create a Google Sheet. Open **Extensions → Apps Script**.
2. Replace the code with the script below. Change `KEY` to a long random string.
3. **Deploy → New deployment → Web app**. Execute as: *Me*. Who has access: *Anyone*. Copy the URL.
4. Set `CRM_WEBHOOK_URL=<that URL>?key=<your KEY>` on the server.

Apps Script can't read request headers, so it can't check Mise's `x-mise-signature`. The `key` in the URL does that job instead. Treat the URL like a password.

```js
const KEY = "change-me-to-a-long-random-string";

function doPost(e) {
  if (e.parameter.key !== KEY) return ContentService.createTextOutput("forbidden");
  const ev = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActive();
  const tab = ev.type === "order.placed" ? "Orders" : ev.type === "reservation.created" ? "Reservations" : "Handoffs";
  const sheet = ss.getSheetByName(tab) || ss.insertSheet(tab);
  if (sheet.getLastRow() === 0) sheet.appendRow(["event id", "time", "channel", "code", "name", "phone", "pickup / when", "items / party", "total", "notes"]);

  // Mise retries failed deliveries: skip events we've already written.
  const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat() : [];
  if (ids.includes(ev.id)) return ContentService.createTextOutput("duplicate");

  const d = ev.data;
  const items = d.items ? d.items.map((l) => `${l.quantity}x ${l.name}`).join(", ") : d.partySize ? `party of ${d.partySize}` : "";
  const when = d.pickupTime ? `${d.pickupDate || ""} ${d.pickupTime}`.trim() : d.date ? `${d.date} ${d.time}` : "";
  // Guests type their own names and notes. A name like =IMPORTXML(...) would run as a formula, so neutralize those.
  const safe = (v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v);
  sheet.appendRow([ev.id, ev.occurredAt, ev.channel, d.id || d.code || "", d.name || "", d.phone || "", when, items, d.total || "", d.notes || d.summary || ""].map(safe));
  return ContentService.createTextOutput("ok");
}
```

The owner dashboard at `/admin` shows the same data, plus the prep list and per-window pickup sheet. The Sheet is for owners who want the orders where they already work.
