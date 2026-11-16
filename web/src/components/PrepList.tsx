import { useState } from "react";
import { showQty } from "../lib/format";
import type { BaseUnit, PrepTask } from "../fixtures/ruki";
import "./PrepList.css";

interface Props {
  tasks: PrepTask[];
  info: Record<string, { name: string; base: BaseUnit }>;
}

export function PrepList({ tasks, info }: Props) {
  const [done, setDone] = useState<Set<string>>(new Set());

  const toggle = (item: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (!next.delete(item)) next.add(item);
      return next;
    });

  return (
    <section className="prep" aria-labelledby="prep-h">
      <div className="sheet-head">
        <h2 id="prep-h">Prep list</h2>
        <p className="sheet-head__note tnum">{done.size} of {tasks.length} done</p>
      </div>
      <ul className="prep__list">
        {tasks.map((t) => {
          const meta = info[t.item];
          const shown = showQty(t.qty, meta?.base ?? "each");
          const checked = done.has(t.item);
          return (
            <li key={t.item} className={checked ? "prep__row prep__row--done" : "prep__row"}>
              <label className="prep__label">
                <input type="checkbox" className="prep__check" checked={checked} onChange={() => toggle(t.item)} />
                <span className="prep__box" aria-hidden="true" />
                <span className="prep__name">
                  <span className="prep__recipe">{t.recipe}</span>
                  <span className="prep__batches tnum">{t.batches} {t.batches === 1 ? "batch" : "batches"}</span>
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
