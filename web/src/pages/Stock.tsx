import { useState } from "react";
import { useCatalog, useItemHistory, useStock } from "../api/hooks";
import type { BaseUnit, Catalog, StockEvent } from "../api/types";
import { showQty, showSigned, showWhen, daysBetween } from "../lib/format";
import { eventSign, stockRows, type Flag, type StockRow } from "../lib/stock";
import "./Stock.css";

const itemName = (c: Catalog, id: string) => c.items.find((i) => i.id === id)?.name ?? id;
const locationName = (c: Catalog, id: string) => c.locations.find((l) => l.id === id)?.name ?? id;
const baseOf = (c: Catalog, id: string): BaseUnit => c.items.find((i) => i.id === id)?.baseUnit ?? "each";

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

function History({ row, catalog }: { row: StockRow; catalog: Catalog }) {
  const history = useItemHistory(row.item);
  const base = baseOf(catalog, row.item);
  // Only the events that touched this location, newest first (the server sends them that way).
  const events = (history.data ?? []).filter((e) => e.location === row.location || e.to === row.location);
  if (history.error) return <div className="stock__history"><p className="stock__why" role="alert">{history.error.message}</p></div>;
  if (!history.data) return <div className="stock__history"><p className="stock__why" role="status">Loading…</p></div>;
  return (
    <div className="stock__history">
      {row.flags.includes("negative") && (
        <p className="stock__why">More was used than was ever received here. A delivery was probably never logged.</p>
      )}
      <table className="stock__events" aria-label={`${itemName(catalog, row.item)} history`}>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col" className="stock__ev-qty">Amount</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const shown = showQty(e.qty, base);
            const moved =
              e.kind === "move" ? (e.to === row.location ? ` from ${locationName(catalog, e.location)}` : ` to ${locationName(catalog, e.to ?? "")}`) : "";
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
  const catalog = useCatalog();
  const stock = useStock();

  const head = (sub: string) => (
    <header className="page-head">
      <p className="page-head__kicker">Ruki pop-up</p>
      <h1>Stock</h1>
      <p className="page-head__sub tnum">{sub}</p>
    </header>
  );
  const failed = catalog.error ?? stock.error;
  if (failed) return <>{head("")}<p className="page-head__sub" role="alert">{failed.message}</p></>;
  if (!catalog.data || !stock.data) return <>{head("")}<p className="page-head__sub" role="status">Loading…</p></>;

  const cat = catalog.data;
  const rows = stockRows(stock.data, cat.items, new Date().toISOString());
  const places = [...cat.locations.map((l) => l.id), ...new Set(rows.map((r) => r.location).filter((l) => !cat.locations.some((x) => x.id === l)))];
  const flagged = rows.filter((r) => r.flags.length > 0).length;

  return (
    <>
      {head(`On hand by location. ${flagged} of ${rows.length} need a look. Tap an item for its history.`)}

      {places.map((place) => {
        const here = rows.filter((r) => r.location === place);
        return (
          <section key={place} className="sheet-section" aria-labelledby={`stock-${place}`}>
            <div className="sheet-head">
              <h2 id={`stock-${place}`}>{locationName(cat, place)}</h2>
              <p className="sheet-head__note tnum">{here.length} items</p>
            </div>
            <ul className="sheet-list">
              {here.map((r) => {
                const key = `${r.location}/${r.item}`;
                const isOpen = open === key;
                const shown = showSigned(r.qty, baseOf(cat, r.item));
                return (
                  <li key={key} className={r.flags.includes("negative") ? "stock__row stock__row--negative" : "stock__row"}>
                    <button
                      type="button"
                      className="stock__item"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : key)}
                    >
                      <span className="stock__what">
                        <span className="stock__name">{itemName(cat, r.item)}</span>
                        {r.arrivedAt && (
                          <span className="stock__age tnum">
                            received {days(daysBetween(r.arrivedAt, new Date().toISOString()))}
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
                    {isOpen && <History row={r} catalog={cat} />}
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
