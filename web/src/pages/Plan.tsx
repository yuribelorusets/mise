import { useState } from "react";
import { useCatalog, usePlanResult, usePlans, useSaveRecord } from "../api/hooks";
import type { BaseUnit, PlanLine, ProductionPlan } from "../api/types";
import { QtyInput } from "../components/QtyInput";
import { showDay, showQty } from "../lib/format";
import "./Plan.css";

const sourceName = { manual: "Manual", preorder: "Preorders" } as const;

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Qty({ base, unit }: { base: number; unit: BaseUnit }) {
  const shown = showQty(base, unit);
  return (
    <>
      <span className="tnum">{shown.value}</span> <span className="plan__unit">{shown.unit}</span>
    </>
  );
}

export default function Plan() {
  const plansQ = usePlans();
  const catalog = useCatalog();
  const [picked, setPicked] = useState<string>();
  // Unsaved lines by plan id, over what the server has.
  const [edits, setEdits] = useState<Record<string, PlanLine[]>>({});
  const [done, setDone] = useState(false);
  const save = useSaveRecord("plans");

  const plans = plansQ.data;
  const stored = plans?.find((p) => p.id === picked) ?? plans?.find((p) => p.date >= localDate()) ?? plans?.[plans.length - 1];
  const result = usePlanResult(stored?.id);

  const head = (
    <header className="page-head">
      <p className="page-head__kicker">Ruki pop-up</p>
      <h1>Plan</h1>
      <p className="page-head__sub">What to make on each date. Preorders are added on their own as guests order.</p>
    </header>
  );
  const failed = plansQ.error ?? catalog.error;
  if (failed) return <>{head}<p className="page-head__sub" role="alert">{failed.message}</p></>;
  if (!plans || !catalog.data) return <>{head}<p className="page-head__sub" role="status">Loading…</p></>;
  if (!stored) return <>{head}<p className="page-head__sub">No plans yet.</p></>;

  const items = new Map(catalog.data.items.map((i) => [i.id, i]));
  const itemName = (id: string) => items.get(id)?.name ?? id;
  const baseOf = (id: string): BaseUnit => items.get(id)?.baseUnit ?? "each";

  const lines = edits[stored.id] ?? stored.lines;
  const changed = JSON.stringify(lines) !== JSON.stringify(stored.lines);
  const itemIds = [...new Set(lines.map((l) => l.item))];
  const fromPreorders = lines.filter((l) => l.source === "preorder").reduce((n, l) => n + l.qty, 0);
  const prep = result.data?.prep ?? [];
  const shopping = result.data?.shopping ?? [];

  const setQty = (index: number, qty: number) => {
    setDone(false);
    save.reset();
    setEdits((e) => ({ ...e, [stored.id]: lines.map((l, i) => (i === index ? { ...l, qty } : l)) }));
  };
  const submit = () => {
    const next: ProductionPlan = { ...stored, lines };
    save.mutate(next, {
      onSuccess: () => {
        setDone(true);
        setEdits(({ [stored.id]: _gone, ...rest }) => rest);
      },
    });
  };

  return (
    <>
      {head}

      <div className="seg" role="group" aria-label="Production date">
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            className="seg__btn tnum"
            aria-pressed={p.id === stored.id}
            onClick={() => { setPicked(p.id); setDone(false); save.reset(); }}
          >
            {showDay(p.date)}
          </button>
        ))}
      </div>

      <section className="sheet-section" aria-labelledby="plan-lines-h">
        <div className="sheet-head">
          <h2 id="plan-lines-h">To make</h2>
          <p className="sheet-head__note tnum">
            {fromPreorders > 0 ? `${fromPreorders} from preorders` : "No preorders yet"}
          </p>
        </div>
        <div className="plan__items">
          {itemIds.map((id) => {
            const here = lines.map((l, index) => ({ l, index })).filter((x) => x.l.item === id);
            const total = here.reduce((n, x) => n + x.l.qty, 0);
            return (
              <div key={id} className="plan__item" role="group" aria-label={itemName(id)}>
                <div className="plan__total">
                  <span className="plan__name">{itemName(id)}</span>
                  <span className="plan__total-qty tnum">{total}</span>
                  <span className="plan__unit">{here[0].l.unit}</span>
                </div>
                <ul className="plan__lines">
                  {here.map(({ l, index }) => (
                    <li key={index} className={`plan__line plan__line--${l.source}`}>
                      {l.source === "preorder" ? (
                        <span>
                          <span className="tag plan__tag">Preorder</span>
                          <span className="plan__auto"> rolled in</span>
                        </span>
                      ) : (
                        <span className="plan__source">{sourceName[l.source]}</span>
                      )}
                      {l.source === "manual" ? (
                        <QtyInput label={`${itemName(id)} manual`} unit={l.unit} value={l.qty} onChange={(qty) => setQty(index, qty)} />
                      ) : (
                        <>
                          <span className="plan__line-qty tnum">{l.qty}</span>
                          <span className="plan__unit">{l.unit}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="plan__actions">
          {save.error && <p className="plan__error" role="alert">{save.error.message}</p>}
          {done && <p className="plan__saved" role="status">Saved.</p>}
          <button type="button" className="btn">Add a line</button>{" "}
          <button type="button" className="btn btn--primary" disabled={!changed || save.isPending} onClick={submit}>Save plan</button>
        </div>
      </section>

      <section className="sheet-section" aria-labelledby="plan-prep-h">
        <div className="sheet-head">
          <h2 id="plan-prep-h">Prep for {showDay(stored.date)}</h2>
          <p className="sheet-head__note tnum">{result.data ? `${prep.length} tasks` : ""}</p>
        </div>
        {result.error && <p role="alert">{result.error.message}</p>}
        <table className="plan__table">
          <thead>
            <tr>
              <th scope="col" className="plan__th-item">Recipe</th>
              <th scope="col">Batches</th>
              <th scope="col">Makes</th>
            </tr>
          </thead>
          <tbody>
            {prep.map((t) => (
              <tr key={t.recipe}>
                <th scope="row" className="plan__th-item">{t.recipeName}</th>
                <td className="tnum">{Number(t.batches.toFixed(2))}</td>
                <td><Qty base={t.qty} unit={baseOf(t.item)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sheet-section" aria-labelledby="plan-short-h">
        <div className="sheet-head">
          <h2 id="plan-short-h">Short</h2>
          <p className="sheet-head__note tnum">
            {!result.data ? "" : shopping.length === 1 ? "1 item to buy" : `${shopping.length} items to buy`}
          </p>
        </div>
        {result.data && shopping.length === 0 ? (
          <p className="plan__none">Nothing short. Stock on hand covers this plan.</p>
        ) : (
          <table className="plan__table">
            <thead>
              <tr>
                <th scope="col" className="plan__th-item">Item</th>
                <th scope="col">Need</th>
                <th scope="col">Have</th>
                <th scope="col">Buy</th>
              </tr>
            </thead>
            <tbody>
              {shopping.map((s) => (
                <tr key={s.item}>
                  <th scope="row" className="plan__th-item">
                    {s.name}
                    {s.buyQty !== undefined && (
                      <span className="plan__buy tnum">order {s.buyQty} {s.buyUnit}</span>
                    )}
                  </th>
                  <td><Qty base={s.need} unit={baseOf(s.item)} /></td>
                  <td><Qty base={s.have} unit={baseOf(s.item)} /></td>
                  <td className="plan__short"><Qty base={s.buy} unit={baseOf(s.item)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
