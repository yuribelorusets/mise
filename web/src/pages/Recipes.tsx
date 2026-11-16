import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { QtyInput } from "../components/QtyInput";
import { componentCost, recipeCost, unitCost } from "../lib/cost";
import { showMoney } from "../lib/format";
import { itemName } from "../fixtures/items";
import { prices, recipes as saved } from "../fixtures/recipes";
import type { Recipe } from "../fixtures/types";
import "./Recipes.css";

const stepFor = (unit: string) => (unit === "g" || unit === "ml" ? 50 : unit === "kg" || unit === "L" ? 0.5 : 1);

function RecipeList({ recipes }: { recipes: Recipe[] }) {
  return (
    <section className="sheet-section" aria-labelledby="recipes-h">
      <div className="sheet-head">
        <h2 id="recipes-h">All recipes</h2>
        <p className="sheet-head__note tnum">{recipes.length} recipes</p>
      </div>
      <ul className="sheet-list">
        {recipes.map((r) => {
          const cost = recipeCost(r, recipes, prices);
          const per = unitCost(r, cost.total);
          return (
            <li key={r.id} className="recipes__row">
              <Link to={`?r=${r.id}`} className="recipes__link">
                <span className="recipes__what">
                  <span className="recipes__name">
                    {r.name} {r.draft && <span className="tag tag--warn">Draft</span>}
                  </span>
                  <span className="recipes__meta tnum">
                    makes {r.yield.qty} {r.yield.unit} · {r.components.length} ingredients
                  </span>
                </span>
                <span className="recipes__cost tnum">{showMoney(per.value)}</span>
                <span className="recipes__per">/ {per.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="recipes__actions">
        <button type="button" className="btn">New recipe</button>
      </div>
    </section>
  );
}

interface EditorProps {
  recipe: Recipe;
  recipes: Recipe[];
  onChange: (next: Recipe) => void;
}

function RecipeEditor({ recipe, recipes, onChange }: EditorProps) {
  const cost = recipeCost(recipe, recipes, prices);
  const per = unitCost(recipe, cost.total);

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
          <input className="field" type="text" value={recipe.name} onChange={(e) => onChange({ ...recipe, name: e.target.value })} />
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
            onChange={(qty) => onChange({ ...recipe, yield: { ...recipe.yield, qty } })}
          />
        </div>
      </div>

      <h3 className="sheet-label recipes__label">Components</h3>
      <ul className="sheet-list">
        {recipe.components.map((c, i) => {
          const sub = recipes.find((r) => r.makes === c.item);
          const line = componentCost(c, recipes, prices, [recipe.id]);
          const noPrice = !sub && line.unpriced.length > 0;
          return (
            <li key={c.item} className="recipes__comp" aria-label={itemName(c.item)}>
              <span className="recipes__what">
                {sub ? (
                  <span className="recipes__name">
                    <Link to={`?r=${sub.id}`} className="recipes__sub">{itemName(c.item)}</Link>{" "}
                    <span className="tag">Recipe</span>
                  </span>
                ) : (
                  <span className="recipes__name">{itemName(c.item)}</span>
                )}
                <span className={noPrice ? "recipes__meta recipes__meta--none" : "recipes__meta tnum"}>
                  {noPrice ? "no price" : showMoney(line.total)}
                </span>
              </span>
              <QtyInput
                label={itemName(c.item)}
                unit={c.unit}
                step={stepFor(c.unit)}
                value={c.qty}
                onChange={(qty) =>
                  onChange({ ...recipe, components: recipe.components.map((x, j) => (j === i ? { ...x, qty } : x)) })
                }
              />
            </li>
          );
        })}
      </ul>
      <div className="recipes__actions">
        <button type="button" className="btn">Add component</button>
      </div>

      <h3 className="sheet-label recipes__label">Cost</h3>
      <dl className="recipes__costs">
        <div className="recipes__cost-row">
          <dt>Per batch</dt>
          <dd className="tnum">{showMoney(cost.total)}</dd>
        </div>
        <div className="recipes__cost-row recipes__cost-row--main">
          <dt>Per {per.label}</dt>
          <dd className="tnum">{showMoney(per.value)}</dd>
        </div>
      </dl>
      {cost.unpriced.length > 0 && (
        <div className="recipes__unpriced" role="note" aria-label="Ingredients with no price">
          <p className="recipes__unpriced-head">
            No price for {cost.unpriced.map(itemName).join(", ")}
          </p>
          <p className="recipes__meta">
            Left out of the cost, so the real figure is higher. A price is picked up when a delivery is logged with one.
          </p>
        </div>
      )}

      <div className="recipes__save">
        <button type="button" className="btn btn--primary recipes__save-btn">
          {recipe.draft ? "Save and publish" : "Save recipe"}
        </button>
      </div>
    </section>
  );
}

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[]>(saved);
  const [params] = useSearchParams();
  const selected = recipes.find((r) => r.id === params.get("r"));

  return (
    <>
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Recipes</h1>
        <p className="page-head__sub">Costs use the price from the latest delivery of each ingredient.</p>
      </header>
      {selected ? (
        <RecipeEditor
          recipe={selected}
          recipes={recipes}
          onChange={(next) => setRecipes((all) => all.map((r) => (r.id === next.id ? next : r)))}
        />
      ) : (
        <RecipeList recipes={recipes} />
      )}
    </>
  );
}
