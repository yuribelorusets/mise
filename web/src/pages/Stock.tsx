import { useState } from "react";
import { showQty, showSigned, showWhen, daysBetween } from "../lib/format";
import { eventSign, onHand, type Flag, type StockRow } from "../lib/stock";
import { NOW, findItem, itemName, items, locationName, stockLocations } from "../fixtures/items";
import { stockEvents } from "../fixtures/stock";
import type { StockEvent } from "../fixtures/types";
import "./Stock.css";

const rows = onHand(stockEvents, items, NOW);

const days = (n: number) => (n === 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`);

function flagText(flag: Flag, row: StockRow): string {
  if (flag === "negative") return "Negative";
  if (flag === "expired") return "Expired";
  if (flag === "below-par") return "Below par";
  if (row.daysLeft === 0) return "Expires today";
  return row.daysLeft === 1 ? "Expires in 1 day" : `Expires in ${row.daysLeft} days`;
}

const flagClass: Record<Flag, string> = {
  negative: "tag tag--alert",
  expired: "tag tag--alert",
  "near-expiry": "tag tag--warn",
  "below-par": "tag",
};

const kindName: Record<StockEvent["kind"], string> = {
  receive: "Receive",
  use: "Use",
  waste: "Waste",
  count: "Count",
  move: "Move",
};

function History({ row }: { row: StockRow }) {
  const base = findItem(row.item)?.baseUnit ?? "each";
  return (
    <div className="stock__history">
      {row.flags.includes("negative") && (
        <p className="stock__why">More was used than was ever received here. A delivery was probably never logged.</p>
      )}
      <table className="stock__events" aria-label={`${itemName(row.item)} history`}>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col" className="stock__ev-qty">Amount</th>
          </tr>
        </thead>
        <tbody>
          {row.history.map((e) => {
            const shown = showQty(e.qty, base);
            const moved =
              e.kind === "move" ? (e.to === row.location ? ` from ${locationName(e.location)}` : ` to ${locationName(e.to ?? "")}`) : "";
            return (
              <tr key={e.id}>
                <th scope="row">
                  <span className="stock__ev-kind">{kindName[e.kind]}{moved}</span>
                  <span className="stock__ev-meta tnum">
                    {showWhen(e.at)} · {e.source}
                    {e.note ? ` · ${e.note}` : ""}
                  </span>
                </th>
                <td className="stock__ev-qty">
                  <span className="tnum">{eventSign(e, row.location)}{shown.value}</span>{" "}
                  <span className="stock__unit">{shown.unit}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Stock() {
  const [open, setOpen] = useState<string | null>(null);
  const flagged = rows.filter((r) => r.flags.length > 0).length;

  return (
    <>
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Stock</h1>
        <p className="page-head__sub tnum">
          On hand by location. {flagged} of {rows.length} need a look. Tap an item for its history.
        </p>
      </header>

      {stockLocations.map((loc) => {
        const here = rows.filter((r) => r.location === loc.id);
        return (
          <section key={loc.id} className="sheet-section" aria-labelledby={`stock-${loc.id}`}>
            <div className="sheet-head">
              <h2 id={`stock-${loc.id}`}>{loc.name}</h2>
              <p className="sheet-head__note tnum">{here.length} items</p>
            </div>
            <ul className="sheet-list">
              {here.map((r) => {
                const key = `${r.location}/${r.item}`;
                const isOpen = open === key;
                const shown = showSigned(r.qty, findItem(r.item)?.baseUnit ?? "each");
                return (
                  <li key={key} className={r.flags.includes("negative") ? "stock__row stock__row--negative" : "stock__row"}>
                    <button
                      type="button"
                      className="stock__item"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : key)}
                    >
                      <span className="stock__what">
                        <span className="stock__name">{itemName(r.item)}</span>
                        {r.arrivedAt && (
                          <span className="stock__age tnum">
                            {r.arrivedBy} {days(daysBetween(r.arrivedAt, NOW))}
                          </span>
                        )}
                        {r.flags.length > 0 && (
                          <span className="stock__flags">
                            {r.flags.map((f) => (
                              <span key={f} className={flagClass[f]}>{flagText(f, r)}</span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="stock__qty tnum">{shown.value}</span>
                      <span className="stock__unit">{shown.unit}</span>
                      <span className="stock__chev" aria-hidden="true" />
                    </button>
                    {isOpen && <History row={r} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
