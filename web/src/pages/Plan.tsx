import { useState } from "react";
import { showDay, showQty } from "../lib/format";
import { findItem, itemName } from "../fixtures/items";
import { planSummaries, plans } from "../fixtures/plans";
import "./Plan.css";

const sourceName = { manual: "Manual", preorder: "Preorders" } as const;

function Qty({ base, item }: { base: number; item: string }) {
  const shown = showQty(base, findItem(item)?.baseUnit ?? "each");
  return (
    <>
      <span className="tnum">{shown.value}</span> <span className="plan__unit">{shown.unit}</span>
    </>
  );
}

export default function Plan() {
  const [planId, setPlanId] = useState(plans[0].id);
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const summary = planSummaries[plan.id] ?? { prep: [], shortfalls: [] };

  const itemIds = [...new Set(plan.lines.map((l) => l.item))];
  const fromPreorders = plan.lines.filter((l) => l.source === "preorder").reduce((n, l) => n + l.qty, 0);

  return (
    <>
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Plan</h1>
        <p className="page-head__sub">What to make on each date. Preorders are added on their own as guests order.</p>
      </header>

      <div className="seg" role="group" aria-label="Production date">
        {plans.map((p) => (
          <button key={p.id} type="button" className="seg__btn tnum" aria-pressed={p.id === plan.id} onClick={() => setPlanId(p.id)}>
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
            const lines = plan.lines.filter((l) => l.item === id);
            const total = lines.reduce((n, l) => n + l.qty, 0);
            return (
              <div key={id} className="plan__item" role="group" aria-label={itemName(id)}>
                <div className="plan__total">
                  <span className="plan__name">{itemName(id)}</span>
                  <span className="plan__total-qty tnum">{total}</span>
                  <span className="plan__unit">{lines[0].unit}</span>
                </div>
                <ul className="plan__lines">
                  {lines.map((l) => (
                    <li key={l.source} className={`plan__line plan__line--${l.source}`}>
                      {l.source === "preorder" ? (
                        <span>
                          <span className="tag plan__tag">Preorder</span>
                          <span className="plan__auto"> rolled in</span>
                        </span>
                      ) : (
                        <span className="plan__source">{sourceName[l.source]}</span>
                      )}
                      <span className="plan__line-qty tnum">{l.qty}</span>
                      <span className="plan__unit">{l.unit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="plan__actions">
          <button type="button" className="btn">Add a line</button>
        </div>
      </section>

      <section className="sheet-section" aria-labelledby="plan-prep-h">
        <div className="sheet-head">
          <h2 id="plan-prep-h">Prep for {showDay(plan.date)}</h2>
          <p className="sheet-head__note tnum">{summary.prep.length} tasks</p>
        </div>
        <table className="plan__table">
          <thead>
            <tr>
              <th scope="col" className="plan__th-item">Recipe</th>
              <th scope="col">Batches</th>
              <th scope="col">Makes</th>
            </tr>
          </thead>
          <tbody>
            {summary.prep.map((t) => (
              <tr key={t.item}>
                <th scope="row" className="plan__th-item">{t.recipe}</th>
                <td className="tnum">{t.batches}</td>
                <td><Qty base={t.qty} item={t.item} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sheet-section" aria-labelledby="plan-short-h">
        <div className="sheet-head">
          <h2 id="plan-short-h">Short</h2>
          <p className="sheet-head__note tnum">
            {summary.shortfalls.length === 1 ? "1 item to buy" : `${summary.shortfalls.length} items to buy`}
          </p>
        </div>
        {summary.shortfalls.length === 0 ? (
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
              {summary.shortfalls.map((s) => (
                <tr key={s.item}>
                  <th scope="row" className="plan__th-item">
                    {itemName(s.item)}
                    {s.buyQty !== undefined && (
                      <span className="plan__buy tnum">order {s.buyQty} {s.buyUnit}</span>
                    )}
                  </th>
                  <td><Qty base={s.need} item={s.item} /></td>
                  <td><Qty base={s.have} item={s.item} /></td>
                  <td className="plan__short"><Qty base={s.buy} item={s.item} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
