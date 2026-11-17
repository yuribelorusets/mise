import { useCatalog, useToday } from "../api/hooks";
import { PrepList } from "../components/PrepList";
import { showLongDay, showQty } from "../lib/format";
import type { BaseUnit, PlanLine } from "../api/types";
import "./Today.css";

interface DishTotal { item: string; unit: string; qty: number; preordered: number }

/** One line per dish: the plan's own amount and the preorders added together. */
function dishTotals(lines: PlanLine[]): DishTotal[] {
  const dishes: DishTotal[] = [];
  for (const l of lines) {
    let d = dishes.find((x) => x.item === l.item && x.unit === l.unit);
    if (!d) dishes.push((d = { item: l.item, unit: l.unit, qty: 0, preordered: 0 }));
    d.qty += l.qty;
    if (l.source === "preorder") d.preordered += l.qty;
  }
  return dishes;
}

const preordered = (d: DishTotal) => (d.preordered === 0 ? "" : d.preordered === d.qty ? " (all preordered)" : ` (${d.preordered} preordered)`);

export default function Today() {
  const today = useToday();
  const catalog = useCatalog();

  const failed = today.error ?? catalog.error;
  if (failed) {
    return (
      <>
        <header className="page-head"><p className="page-head__kicker">Ruki pop-up</p><h1>Today</h1></header>
        <p className="page-head__sub" role="alert">{failed.message}</p>
      </>
    );
  }
  if (!today.data || !catalog.data) {
    return (
      <>
        <header className="page-head"><p className="page-head__kicker">Ruki pop-up</p><h1>Today</h1></header>
        <p className="page-head__sub" role="status">Loading…</p>
      </>
    );
  }

  const { plan, prep, shopping, preorders, date } = today.data;
  const items = new Map(catalog.data.items.map((i) => [i.id, i]));
  const baseUnits = Object.fromEntries(catalog.data.items.map((i) => [i.id, i.baseUnit])) as Record<string, BaseUnit>;
  const windows = [...new Set(preorders.map((p) => p.pickupTime))];

  return (
    <>
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Today</h1>
        <p className="page-head__sub tnum">
          {plan
            ? `Next production, ${showLongDay(date)}: ${dishTotals(plan.lines).map((d) => `${d.qty} ${(items.get(d.item)?.name ?? d.item).toLowerCase()}${preordered(d)}`).join(", ")}`
            : `No plan yet. Add one under Plan.`}
        </p>
      </header>

      <div className="sheet-section">
        <PrepList key={plan?.id ?? "none"} tasks={prep} baseUnits={baseUnits} storageKey={plan ? `mise.prep.${plan.id}` : undefined} />
      </div>

      <section className="sheet-section short" aria-labelledby="short-h">
        <div className="sheet-head">
          <h2 id="short-h">Short</h2>
          <p className="sheet-head__note tnum">{shopping.length} items to buy</p>
        </div>
        <table className="short__table">
          <thead>
            <tr>
              <th scope="col" className="short__item">Item</th>
              <th scope="col">Need</th>
              <th scope="col">Have</th>
              <th scope="col">Buy</th>
            </tr>
          </thead>
          <tbody>
            {shopping.map((s) => {
              const base = baseUnits[s.item] ?? "each";
              const cell = (n: number) => {
                const q = showQty(n, base);
                return (
                  <>
                    <span className="tnum">{q.value}</span> <span className="short__unit">{q.unit}</span>
                  </>
                );
              };
              return (
                <tr key={s.item}>
                  <th scope="row" className="short__item">
                    {s.name}
                    {s.buyQty !== undefined && (
                      <span className="short__buy tnum">
                        order {s.buyQty} {s.buyUnit}
                      </span>
                    )}
                  </th>
                  <td>{cell(s.need)}</td>
                  <td>{cell(s.have)}</td>
                  <td className="short__short">{cell(s.buy)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="sheet-section orders" aria-labelledby="orders-h">
        <div className="sheet-head">
          <h2 id="orders-h">Preorders</h2>
          <p className="sheet-head__note tnum">{preorders.length} orders</p>
        </div>
        {windows.map((w) => (
          <div key={w} className="orders__window">
            <h3 className="orders__time tnum">{w}</h3>
            <ul className="orders__list">
              {preorders
                .filter((p) => p.pickupTime === w)
                .map((p, i) => (
                  <li key={i} className="orders__row" aria-label={`Preorder from ${p.firstName || "a guest"}`}>
                    <span className="orders__name">{p.firstName || "A guest"}</span>
                    <span className="orders__items tnum">
                      {p.items.map((l) => `${l.quantity} ${l.name.toLowerCase()}`).join(", ")}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}
