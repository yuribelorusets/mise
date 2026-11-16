import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCatalog, useCost, useSaveRecord } from "../api/hooks";
import type { Item, Recipe } from "../api/types";
import { QtyInput } from "../components/QtyInput";
import { showMoney } from "../lib/format";
import "./Recipes.css";

const stepFor = (unit: string) => (unit === "g" || unit === "ml" ? 50 : unit === "kg" || unit === "L" ? 0.5 : 1);

/** The unit a recipe's cost is quoted per: a kg or L of a prep item, or a plate (one of the item's own unit) of a dish. */
function perUnit(item: Item | undefined): { qty: number; unit: string; label: string } {
  if (item?.baseUnit === "g") return { qty: 1, unit: "kg", label: "kg" };
  if (item?.baseUnit === "ml") return { qty: 1, unit: "L", label: "L" };
  return { qty: 1, unit: Object.keys(item?.units ?? {})[0] ?? "each", label: "plate" };
}

const nameOf = (items: readonly Item[], id: string) => items.find((i) => i.id === id)?.name ?? id;
const dollars = (n: number | undefined) => (n === undefined ? "–" : showMoney(n));

function RecipeRow({ recipe, items }: { recipe: Recipe; items: Item[] }) {
  const per = perUnit(items.find((i) => i.id === recipe.makes));
  const cost = useCost(recipe.makes, per.qty, per.unit);
  return (
    <li className="recipes__row">
      <Link to={`?r=${recipe.id}`} className="recipes__link">
        <span className="recipes__what">
          <span className="recipes__name">
            {recipe.name} {recipe.draft && <span className="tag tag--warn">Draft</span>}
          </span>
          <span className="recipes__meta tnum">
            makes {recipe.yield.qty} {recipe.yield.unit} · {recipe.components.length} ingredients
          </span>
        </span>
        <span className="recipes__cost tnum">{dollars(cost.data?.cost)}</span>
        <span className="recipes__per">/ {per.label}</span>
      </Link>
    </li>
  );
}

function RecipeList({ recipes, items }: { recipes: Recipe[]; items: Item[] }) {
  return (
    <section className="sheet-section" aria-labelledby="recipes-h">
      <div className="sheet-head">
        <h2 id="recipes-h">All recipes</h2>
        <p className="sheet-head__note tnum">{recipes.length} recipes</p>
      </div>
      <ul className="sheet-list">
        {recipes.map((r) => <RecipeRow key={r.id} recipe={r} items={items} />)}
      </ul>
      <div className="recipes__actions">
        <button type="button" className="btn">New recipe</button>
      </div>
    </section>
  );
}

function ComponentRow({ recipe, index, recipes, items, onChange }: { recipe: Recipe; index: number; recipes: Recipe[]; items: Item[]; onChange: (next: Recipe) => void }) {
  const c = recipe.components[index];
  const sub = recipes.find((r) => r.makes === c.item);
  const cost = useCost(c.item, c.qty, c.unit);
  const noPrice = !sub && (cost.data?.missing.length ?? 0) > 0;
  const name = nameOf(items, c.item);
  return (
    <li className="recipes__comp" aria-label={name}>
      <span className="recipes__what">
        {sub ? (
          <span className="recipes__name">
            <Link to={`?r=${sub.id}`} className="recipes__sub">{name}</Link>{" "}
            <span className="tag">Recipe</span>
          </span>
        ) : (
          <span className="recipes__name">{name}</span>
        )}
        <span className={noPrice ? "recipes__meta recipes__meta--none" : "recipes__meta tnum"}>
          {noPrice ? "no price" : dollars(cost.data?.cost)}
        </span>
      </span>
      <QtyInput
        label={name}
        unit={c.unit}
        step={stepFor(c.unit)}
        value={c.qty}
        onChange={(qty) => onChange({ ...recipe, components: recipe.components.map((x, j) => (j === index ? { ...x, qty } : x)) })}
      />
    </li>
  );
}

interface EditorProps {
  recipe: Recipe;
  /** The recipe as the server has it: costs are worked out from this, not from unsaved edits. */
  saved: Recipe;
  recipes: Recipe[];
  items: Item[];
  onChange: (next: Recipe) => void;
  onSaved: () => void;
}

function RecipeEditor({ recipe, saved, recipes, items, onChange, onSaved }: EditorProps) {
  const save = useSaveRecord("recipes");
  const [done, setDone] = useState(false);
  const batch = useCost(saved.makes, saved.yield.qty, saved.yield.unit);
  const per = perUnit(items.find((i) => i.id === saved.makes));
  const one = useCost(saved.makes, per.qty, per.unit);
  const missing = batch.data?.missing ?? [];

  const edit = (next: Recipe) => {
    setDone(false);
    save.reset();
    onChange(next);
  };
  const submit = () => {
    const { draft, ...published } = recipe;
    void draft;
    save.mutate(published, { onSuccess: () => { setDone(true); onSaved(); } });
  };
  const errors = save.error instanceof ApiError && Array.isArray(save.error.body?.errors) ? (save.error.body.errors as string[]) : save.error ? [save.error.message] : [];

  return (
    <section className="sheet-section" aria-labelledby="recipe-h">
      <Link to="/recipes" className="recipes__back">All recipes</Link>
      <div className="sheet-head">
        <h2 id="recipe-h">{recipe.name}</h2>
        {recipe.draft && <span className="tag tag--warn">Draft</span>}
      </div>

      <div className="recipes__fields">
        <label className="recipes__field">
          <span className="field-label">Name</span>
          <input className="field" type="text" value={recipe.name} onChange={(e) => edit({ ...recipe, name: e.target.value })} />
        </label>
        <div className="recipes__yield">
          <span className="recipes__yield-label">
            <span className="recipes__name">Yield</span>
            <span className="recipes__meta">one batch makes</span>
          </span>
          <QtyInput
            label="Yield"
            unit={recipe.yield.unit}
            step={stepFor(recipe.yield.unit)}
            value={recipe.yield.qty}
            onChange={(qty) => edit({ ...recipe, yield: { ...recipe.yield, qty } })}
          />
        </div>
      </div>

      <h3 className="sheet-label recipes__label">Components</h3>
      <ul className="sheet-list">
        {recipe.components.map((c, i) => (
          <ComponentRow key={`${c.item}-${i}`} recipe={recipe} index={i} recipes={recipes} items={items} onChange={edit} />
        ))}
      </ul>
      <div className="recipes__actions">
        <button type="button" className="btn">Add component</button>
      </div>

      <h3 className="sheet-label recipes__label">Cost</h3>
      <dl className="recipes__costs">
        <div className="recipes__cost-row">
          <dt>Per batch</dt>
          <dd className="tnum">{dollars(batch.data?.cost)}</dd>
        </div>
        <div className="recipes__cost-row recipes__cost-row--main">
          <dt>Per {per.label}</dt>
          <dd className="tnum">{dollars(one.data?.cost)}</dd>
        </div>
      </dl>
      {missing.length > 0 && (
        <div className="recipes__unpriced" role="note" aria-label="Ingredients with no price">
          <p className="recipes__unpriced-head">No price for {missing.map((id) => nameOf(items, id)).join(", ")}</p>
          <p className="recipes__meta">
            Left out of the cost, so the real figure is higher. A price is picked up when a delivery is logged with one.
          </p>
        </div>
      )}

      <div className="recipes__save">
        {errors.length > 0 && (
          <div className="recipes__error" role="alert">
            {errors.map((e) => <p key={e}>{e}</p>)}
          </div>
        )}
        {done && <p className="recipes__saved" role="status">Saved.</p>}
        <button type="button" className="btn btn--primary recipes__save-btn" disabled={save.isPending} onClick={submit}>
          {recipe.draft ? "Save and publish" : "Save recipe"}
        </button>
      </div>
    </section>
  );
}

export default function Recipes() {
  const catalog = useCatalog();
  const [params] = useSearchParams();
  // Unsaved edits by recipe id, over what the server has.
  const [edits, setEdits] = useState<Record<string, Recipe>>({});

  const head = (
    <header className="page-head">
      <p className="page-head__kicker">Ruki pop-up</p>
      <h1>Recipes</h1>
      <p className="page-head__sub">Costs use the price from the latest delivery of each ingredient.</p>
    </header>
  );
  if (catalog.error) return <>{head}<p className="page-head__sub" role="alert">{catalog.error.message}</p></>;
  if (!catalog.data) return <>{head}<p className="page-head__sub" role="status">Loading…</p></>;

  const { recipes, items } = catalog.data;
  const selected = recipes.find((r) => r.id === params.get("r"));

  return (
    <>
      {head}
      {selected ? (
        <RecipeEditor
          key={selected.id}
          recipe={edits[selected.id] ?? selected}
          saved={selected}
          recipes={recipes}
          items={items}
          onChange={(next) => setEdits((e) => ({ ...e, [next.id]: next }))}
          onSaved={() => setEdits(({ [selected.id]: _gone, ...rest }) => rest)}
        />
      ) : (
        <RecipeList recipes={recipes} items={items} />
      )}
    </>
  );
}
