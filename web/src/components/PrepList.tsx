import { useState } from "react";
import { showQty } from "../lib/format";
import type { BaseUnit, TodayView } from "../api/types";
import "./PrepList.css";

interface Props {
  tasks: TodayView["prep"];
  /** Base unit of each item made, by item id. */
  baseUnits: Record<string, BaseUnit>;
  /** Where ticks are kept in this browser. Ticking off prep isn't stock, so it never goes to the server. */
  storageKey?: string;
}

function load(key: string | undefined): Set<string> {
  try {
    const raw = key ? localStorage.getItem(key) : null;
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function PrepList({ tasks, baseUnits, storageKey }: Props) {
  const [done, setDone] = useState<Set<string>>(() => load(storageKey));

  const toggle = (recipe: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (!next.delete(recipe)) next.add(recipe);
      try {
        if (storageKey) localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Private mode or a full disk: the ticks just last until the page is closed.
      }
      return next;
    });

  const shownDone = tasks.filter((t) => done.has(t.recipe)).length;

  return (
    <section className="prep" aria-labelledby="prep-h">
      <div className="sheet-head">
        <h2 id="prep-h">Prep list</h2>
        <p className="sheet-head__note tnum">{shownDone} of {tasks.length} done</p>
      </div>
      <ul className="prep__list">
        {tasks.map((t) => {
          const shown = showQty(t.qty, baseUnits[t.item] ?? "each");
          const checked = done.has(t.recipe);
          return (
            <li key={t.recipe} className={checked ? "prep__row prep__row--done" : "prep__row"}>
              <label className="prep__label">
                <input type="checkbox" className="prep__check" checked={checked} onChange={() => toggle(t.recipe)} />
                <span className="prep__box" aria-hidden="true" />
                <span className="prep__name">
                  <span className="prep__recipe">{t.recipeName}</span>
                  <span className="prep__batches tnum">{Number(t.batches.toFixed(2))} {t.batches === 1 ? "batch" : "batches"}</span>
                </span>
                <span className="prep__qty tnum">{shown.value}</span>
                <span className="prep__unit">{shown.unit}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
