import { useState } from "react";
import { useCatalog, useSaveCount, useStock } from "../api/hooks";
import { ApiError } from "../api/client";
import type { BaseUnit, Item } from "../api/types";
import { QtyInput } from "../components/QtyInput";
import "./Count.css";

/** Counted in kg and L rather than g and ml, so a row reads "2.268 kg" and steps by half a kilo. */
const COUNT_UNIT: Record<BaseUnit, { unit: string; per: number; step: number }> = {
  g: { unit: "kg", per: 1000, step: 0.5 },
  ml: { unit: "L", per: 1000, step: 0.5 },
  each: { unit: "each", per: 1, step: 1 },
};
const shown = (base: number, item: Item) => Math.round((base / COUNT_UNIT[item.baseUnit].per) * 1000) / 1000;

export default function Count() {
  const catalog = useCatalog();
  const stock = useStock();
  const save = useSaveCount();
  const [locId, setLocId] = useState<string>();
  // What the owner has changed, by "location/item". Anything not here is still at its last count.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);
  // Rows the owner has marked counted at their current value, so a deliberate zero (or an unchanged count) is sent too.
  const [marks, setMarks] = useState<Set<string>>(new Set());

  const head = (
    <header className="page-head">
      <p className="page-head__kicker">Ruki pop-up</p>
      <h1>Count</h1>
      <p className="page-head__sub">Walk the shelves top to bottom. Change only what's different.</p>
    </header>
  );
  const failed = catalog.error ?? stock.error;
  if (failed) return <>{head}<p className="page-head__sub" role="alert">{failed.message}</p></>;
  if (!catalog.data || !stock.data) return <>{head}<p className="page-head__sub" role="status">Loading…</p></>;

  const { locations, items } = catalog.data;
  const loc = locations.find((l) => l.id === locId) ?? locations[0];
  if (!loc) return <>{head}<p className="page-head__sub">No locations yet.</p></>;

  const rows = loc.shelfOrder
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is Item => !!i)
    .map((item) => {
      const last = shown(stock.data.lastCount[item.id]?.[loc.id]?.qty ?? 0, item);
      const value = edits[`${loc.id}/${item.id}`] ?? last;
      const marked = marks.has(`${loc.id}/${item.id}`);
      return { item, last, value, marked, counted: stock.data.lastCount[item.id]?.[loc.id] !== undefined, changed: value !== last || marked };
    });
  const changedRows = rows.filter((r) => r.changed);

  const edit = (key: string, v: number) => {
    save.reset();
    setSaved(false);
    setEdits((e) => ({ ...e, [key]: v }));
  };

  const submit = () => {
    const sent = changedRows;
    save.mutate(
      { location: loc.id, lines: sent.map((r) => ({ item: r.item.id, qty: r.value, unit: COUNT_UNIT[r.item.baseUnit].unit })) },
      {
        onSuccess: () => {
          setSaved(true);
          setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`${loc.id}/`))));
          setMarks((m) => new Set([...m].filter((k) => !k.startsWith(`${loc.id}/`))));
        },
      },
    );
  };

  // A 422 lists one problem per line sent, in the order sent.
  const body = save.error instanceof ApiError ? save.error.body : undefined;
  const problems = Array.isArray(body?.problems) ? (body.problems as (string | null)[]) : undefined;
  const problemFor = (itemId: string) => problems?.[changedRows.findIndex((r) => r.item.id === itemId)] ?? null;

  return (
    <>
      {head}

      <div className="count__switch" role="group" aria-label="Location">
        {locations.map((l) => (
          <button key={l.id} type="button" className="count__loc" aria-pressed={l.id === loc.id} onClick={() => { setLocId(l.id); setSaved(false); save.reset(); }}>
            {l.name}
          </button>
        ))}
      </div>

      <section className="sheet-section count__shelf" aria-label={loc.name}>
        <ul className="count__list">
          {rows.map((r) => {
            const { unit, step } = COUNT_UNIT[r.item.baseUnit];
            const problem = problemFor(r.item.id);
            return (
              <li key={r.item.id} className={r.changed ? "count__row count__row--changed" : "count__row"}>
                <div className="count__what">
                  <span className="count__name">{r.item.name}</span>
                  <span className="count__last tnum">{r.counted ? `last ${r.last} ${unit}` : "not counted yet"}</span>
                  {problem && <span className="count__problem">{problem}</span>}
                  {r.value === r.last && (
                    <button
                      type="button"
                      className="count__mark"
                      aria-pressed={r.marked}
                      aria-label={`Mark ${r.item.name} counted`}
                      onClick={() => {
                        save.reset();
                        setSaved(false);
                        setMarks((m) => {
                          const next = new Set(m);
                          const key = `${loc.id}/${r.item.id}`;
                          if (!next.delete(key)) next.add(key);
                          return next;
                        });
                      }}
                    >
                      {r.marked ? `Counted at ${r.value} ${unit}` : `Count as ${r.value} ${unit}`}
                    </button>
                  )}
                </div>
                <QtyInput
                  label={r.item.name}
                  unit={unit}
                  step={step}
                  value={r.value}
                  onChange={(v) => edit(`${loc.id}/${r.item.id}`, v)}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <div className="count__save">
        {save.error && !problems && <p className="count__error" role="alert">{save.error.message}</p>}
        {saved && <p className="count__saved" role="status">Saved.</p>}
        <button type="button" className="count__save-btn" disabled={!changedRows.length || save.isPending} onClick={submit}>
          Save count{changedRows.length > 0 ? ` (${changedRows.length} changed)` : ""}
        </button>
      </div>
    </>
  );
}
