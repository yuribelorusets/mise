import { useState } from "react";
import { ApiError } from "../api/client";
import { useConfirmProposal, useDiscardProposal, useRefreshProposal } from "../api/hooks";
import type { Catalog, Item, ProposalLine, ProposalView } from "../api/types";
import "./ProposalCard.css";

const kindName = { receive: "Receive", use: "Use", waste: "Waste", count: "Count", move: "Move" } as const;

/** Units an amount of this item can be given in: its base unit, kg or L, then its own. */
function unitsFor(item: Item | undefined): string[] {
  if (!item) return ["each"];
  const metric = item.baseUnit === "g" ? ["g", "kg"] : item.baseUnit === "ml" ? ["ml", "L"] : ["each"];
  return [...metric, ...Object.keys(item.units)];
}

interface Props {
  proposal: ProposalView;
  catalog: Catalog;
}

export default function ProposalCard({ proposal, catalog }: Props) {
  const confirm = useConfirmProposal();
  const discard = useDiscardProposal();
  const refresh = useRefreshProposal();
  const [lines, setLines] = useState<ProposalLine[]>(proposal.lines);
  // Problems the owner has dealt with by changing the line, or that a 422 just sent, over the ones the proposal came with.
  const [problemOverride, setProblemOverride] = useState<Record<number, string | null>>({});

  const open = proposal.status === "open";
  const done = proposal.status === "confirmed";
  const gone = proposal.status === "discarded";
  const stale = open && proposal.stale;
  const problemAt = (i: number) => (i in problemOverride ? problemOverride[i] : proposal.problems[i] ?? null);
  const hasProblem = lines.some((_, i) => problemAt(i));
  const busy = confirm.isPending || discard.isPending || refresh.isPending;

  const itemOf = (id: string) => catalog.items.find((it) => it.id === id);
  const nameOf = (id: string) => itemOf(id)?.name ?? id;
  const locationName = (id: string) => catalog.locations.find((l) => l.id === id)?.name ?? id;

  const edit = (i: number, patch: Partial<ProposalLine>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setProblemOverride((p) => ({ ...p, [i]: null }));
  };

  const submit = () =>
    confirm.mutate(
      { id: proposal.id, lines },
      {
        onError: (e) => {
          const sent = e instanceof ApiError && e.status === 422 ? e.body?.problems : undefined;
          if (Array.isArray(sent)) setProblemOverride(Object.fromEntries((sent as (string | null)[]).map((p, i) => [i, p])));
        },
      },
    );

  const shown = open ? lines : proposal.lines;
  const count = shown.length === 1 ? "1 line" : `${shown.length} lines`;

  const lockedLines = (
    <ul className="pcard__lines">
      {shown.map((l, i) => (
        <li key={i} className="pcard__line" aria-label={`${kindName[l.kind]} ${nameOf(l.item)}`}>
          <span className="pcard__what">
            <span className="pcard__kind">{kindName[l.kind]}</span>
            <span className="pcard__item">{nameOf(l.item)}</span>
            <span className="sheet-unit">{locationName(l.location)}</span>
          </span>
          <span className="pcard__qty tnum">{l.qty}</span>
          <span className="plan__unit">{l.unit}</span>
        </li>
      ))}
    </ul>
  );

  if (gone) {
    return (
      <section className="pcard pcard--gone" aria-label="Proposal">
        <details>
          <summary className="pcard__stub tnum">Discarded · {count}</summary>
          {lockedLines}
        </details>
      </section>
    );
  }

  return (
    <section className={`pcard${done ? " pcard--done" : ""}${stale ? " pcard--stale" : ""}`} aria-label="Proposal">
      <header className="pcard__head">
        <h3 className="pcard__title">{done ? "Booked" : "To book"}</h3>
        <span className="tnum pcard__count">{count}</span>
        {done && <span className="tag pcard__mark">&#10003; Done</span>}
        {stale && <span className="tag tag--alert">Stale</span>}
      </header>

      {stale && (
        <p className="pcard__stale" role="status">
          Stock changed since this was made. Refresh it before booking.
        </p>
      )}

      {!open ? lockedLines : (
        <ul className="pcard__lines">
          {lines.map((l, i) => {
            const name = nameOf(l.item);
            const problem = problemAt(i);
            return (
              <li key={i} className="pcard__line" aria-label={`${kindName[l.kind]} ${name}`}>
                <span className="pcard__kind pcard__kind--row">{kindName[l.kind]}</span>
                <label className="pcard__f pcard__f--item">
                  <span className="field-label">Item</span>
                  <select className="field" value={l.item} onChange={(e) => edit(i, { item: e.target.value, unit: unitsFor(itemOf(e.target.value))[0] })}>
                    {catalog.items.map((it) => (
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
                    {[...new Set([l.unit, ...unitsFor(itemOf(l.item))])].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </label>
                <label className="pcard__f pcard__f--loc">
                  <span className="field-label">Location</span>
                  <select className="field" value={l.location} onChange={(e) => edit(i, { location: e.target.value })}>
                    {catalog.locations.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
                {l.raw && <span className="pcard__raw">You said: {l.raw}</span>}
                {problem && <span className="pcard__problem">{problem}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {confirm.error && !hasProblem && <p className="pcard__error" role="alert">{confirm.error.message}</p>}
      {(discard.error || refresh.error) && <p className="pcard__error" role="alert">{(discard.error ?? refresh.error)!.message}</p>}

      {open && (
        <div className="pcard__actions">
          {stale && (
            <button type="button" className="btn pcard__refresh" disabled={busy} onClick={() => refresh.mutate({ id: proposal.id })}>Refresh</button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => discard.mutate({ id: proposal.id })}>Discard</button>
          <button type="button" className="btn btn--primary" disabled={stale || hasProblem || busy} onClick={submit}>
            Confirm
          </button>
        </div>
      )}
    </section>
  );
}
