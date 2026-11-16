import { useState } from "react";
import { QtyInput } from "../components/QtyInput";
import { countItems, locations, type Location } from "../fixtures/ruki";
import "./Count.css";

export default function Count() {
  const [loc, setLoc] = useState<Location>("Walk-in");
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.values(countItems).flat().map((i) => [i.id, i.last])),
  );

  const items = countItems[loc];
  const shelves = [...new Set(items.map((i) => i.shelf))];
  const changed = Object.values(countItems).flat().filter((i) => counts[i.id] !== i.last).length;

  return (
    <>
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Count</h1>
        <p className="page-head__sub">Walk the shelves top to bottom. Change only what's different.</p>
      </header>

      <div className="count__switch" role="group" aria-label="Location">
        {locations.map((l) => (
          <button key={l} type="button" className="count__loc" aria-pressed={l === loc} onClick={() => setLoc(l)}>
            {l}
          </button>
        ))}
      </div>

      {shelves.map((shelf) => (
        <section key={shelf} className="sheet-section count__shelf" aria-label={shelf}>
          <h2 className="count__shelf-name">{shelf}</h2>
          <ul className="count__list">
            {items
              .filter((i) => i.shelf === shelf)
              .map((i) => (
                <li key={i.id} className={counts[i.id] !== i.last ? "count__row count__row--changed" : "count__row"}>
                  <div className="count__what">
                    <span className="count__name">{i.name}</span>
                    <span className="count__last tnum">last {i.last} {i.unit}</span>
                  </div>
                  <QtyInput
                    label={i.name}
                    unit={i.unit}
                    step={i.step}
                    value={counts[i.id]}
                    onChange={(v) => setCounts((c) => ({ ...c, [i.id]: v }))}
                  />
                </li>
              ))}
          </ul>
        </section>
      ))}

      <div className="count__save">
        <button type="button" className="count__save-btn">
          Save count{changed > 0 ? ` (${changed} changed)` : ""}
        </button>
      </div>
    </>
  );
}
