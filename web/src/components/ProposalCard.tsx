import { useState } from "react";
import type { Proposal, ProposalLine } from "../fixtures/assistant";
import { items, locationName, stockLocations, unitsFor } from "../fixtures/items";
import "./ProposalCard.css";

const kindName = { receive: "Receive", use: "Use", waste: "Waste", count: "Count", move: "Move" } as const;

interface Props {
  proposal: Proposal;
  /** Stock events on record now, to tell whether the proposal is stale. */
  events: number;
  onConfirm?: (lines: ProposalLine[]) => void;
  onDiscard?: () => void;
  onRefresh?: () => void;
}

export default function ProposalCard({ proposal, events, onConfirm, onDiscard, onRefresh }: Props) {
  const [lines, setLines] = useState(proposal.lines);
  const stale = proposal.status === "open" && proposal.basedOn !== events;
  const done = proposal.status === "confirmed";
  const gone = proposal.status === "discarded";
  const locked = done || gone;

  const edit = (i: number, patch: Partial<ProposalLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <section className={`pcard${done ? " pcard--done" : ""}${stale ? " pcard--stale" : ""}`} aria-label="Proposal">
      <header className="pcard__head">
        <h3 className="pcard__title">{done ? "Booked" : gone ? "Discarded" : "To book"}</h3>
        <span className="tnum pcard__count">{lines.length === 1 ? "1 line" : `${lines.length} lines`}</span>
        {done && <span className="tag pcard__mark">&#10003; Done</span>}
        {stale && <span className="tag tag--alert">Stale</span>}
      </header>

      {stale && (
        <p className="pcard__stale" role="status">
          Stock changed since this was made. Refresh it before booking.
        </p>
      )}

      <ul className="pcard__lines">
        {lines.map((l, i) => {
          const name = items.find((it) => it.id === l.item)?.name ?? l.item;
          return (
            <li key={i} className="pcard__line" aria-label={`${kindName[l.kind]} ${name}`}>
              {locked ? (
                <>
                  <span className="pcard__what">
                    <span className="pcard__kind">{kindName[l.kind]}</span>
                    <span className="pcard__item">{name}</span>
                    <span className="sheet-unit">{locationName(l.location)}</span>
                  </span>
                  <span className="pcard__qty tnum">{l.qty}</span>
                  <span className="plan__unit">{l.unit}</span>
                </>
              ) : (
                <>
                  <span className="pcard__kind pcard__kind--row">{kindName[l.kind]}</span>
                  <label className="pcard__f pcard__f--item">
                    <span className="field-label">Item</span>
                    <select className="field" value={l.item} onChange={(e) => edit(i, { item: e.target.value, unit: unitsFor(e.target.value)[0] })}>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="pcard__f">
                    <span className="field-label">Amount</span>
                    <input
                      className="field field--num tnum"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={l.qty}
                      onChange={(e) => edit(i, { qty: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                  </label>
                  <label className="pcard__f">
                    <span className="field-label">Unit</span>
                    <select className="field" value={l.unit} onChange={(e) => edit(i, { unit: e.target.value })}>
                      {unitsFor(l.item).map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                  <label className="pcard__f pcard__f--loc">
                    <span className="field-label">Location</span>
                    <select className="field" value={l.location} onChange={(e) => edit(i, { location: e.target.value })}>
                      {stockLocations.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  {l.raw && <span className="pcard__raw">You said: {l.raw}</span>}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {!locked && (
        <div className="pcard__actions">
          {stale && (
            <button type="button" className="btn pcard__refresh" onClick={onRefresh}>Refresh</button>
          )}
          <button type="button" className="btn" onClick={onDiscard}>Discard</button>
          <button type="button" className="btn btn--primary" disabled={stale} onClick={() => onConfirm?.(lines)}>
            Confirm
          </button>
        </div>
      )}
    </section>
  );
}
