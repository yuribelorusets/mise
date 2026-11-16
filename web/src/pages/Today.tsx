import { PrepList } from "../components/PrepList";
import { showQty } from "../lib/format";
import { itemInfo, pickupDate, prepTasks, preorders, shortfalls, targets } from "../fixtures/ruki";
import "./Today.css";

const windows = [...new Set(preorders.map((p) => p.window))];

export default function Today() {
  return (
    <>
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Today</h1>
        <p className="page-head__sub tnum">
          Next production, {pickupDate}: {targets.map((t) => `${t.qty} ${t.name.toLowerCase()}`).join(", ")}
        </p>
      </header>

      <div className="sheet-section">
        <PrepList tasks={prepTasks} info={itemInfo} />
      </div>

      <section className="sheet-section short" aria-labelledby="short-h">
        <div className="sheet-head">
          <h2 id="short-h">Short</h2>
          <p className="sheet-head__note tnum">{shortfalls.length} items to buy</p>
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
            {shortfalls.map((s) => {
              const meta = itemInfo[s.item] ?? { name: s.item, base: "each" as const };
              const cell = (n: number) => {
                const q = showQty(n, meta.base);
                return (
                  <>
                    <span className="tnum">{q.value}</span> <span className="short__unit">{q.unit}</span>
                  </>
                );
              };
              return (
                <tr key={s.item}>
                  <th scope="row" className="short__item">
                    {meta.name}
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
                .filter((p) => p.window === w)
                .map((p) => (
                  <li key={p.id} className="orders__row" aria-label={`Preorder from ${p.name}`}>
                    <span className="orders__name">{p.name}</span>
                    <span className="orders__items tnum">
                      {p.items.map((i) => `${i.qty} ${i.item.toLowerCase()}`).join(", ")}
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
