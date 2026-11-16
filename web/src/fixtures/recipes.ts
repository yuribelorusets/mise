import type { Catalog, Recipe } from "../api/types";
import { stockCatalog } from "./items";

export const recipes: Recipe[] = [
  {
    id: "syrniki",
    name: "Syrniki",
    makes: "syrniki",
    yield: { qty: 20, unit: "order" },
    components: [
      { item: "syrniki-batter", qty: 2400, unit: "g" },
      { item: "sour-cream", qty: 600, unit: "g" },
      { item: "jam", qty: 400, unit: "g" },
      { item: "oil", qty: 200, unit: "ml" },
    ],
  },
  {
    id: "syrniki-batter",
    name: "Syrniki batter",
    makes: "syrniki-batter",
    yield: { qty: 2400, unit: "g" },
    components: [
      { item: "farmers-cheese", qty: 2, unit: "kg" },
      { item: "eggs", qty: 4, unit: "each" },
      { item: "flour", qty: 250, unit: "g" },
      { item: "sugar", qty: 150, unit: "g" },
      { item: "salt", qty: 10, unit: "g" },
    ],
  },
  {
    id: "nalysnyky",
    name: "Nalysnyky",
    makes: "nalysnyky",
    yield: { qty: 10, unit: "order" },
    components: [
      { item: "nalysnyky-batter", qty: 1000, unit: "ml" },
      { item: "cheese-filling", qty: 1200, unit: "g" },
      { item: "butter", qty: 60, unit: "g" },
      { item: "sour-cream", qty: 300, unit: "g" },
    ],
  },
  {
    id: "nalysnyky-batter",
    name: "Nalysnyky batter",
    makes: "nalysnyky-batter",
    yield: { qty: 1000, unit: "ml" },
    components: [
      { item: "milk", qty: 500, unit: "ml" },
      { item: "eggs", qty: 3, unit: "each" },
      { item: "flour", qty: 250, unit: "g" },
      { item: "sugar", qty: 20, unit: "g" },
      { item: "butter", qty: 40, unit: "g" },
      { item: "salt", qty: 5, unit: "g" },
    ],
  },
  {
    id: "cheese-filling",
    name: "Cheese filling",
    makes: "cheese-filling",
    yield: { qty: 1200, unit: "g" },
    components: [
      { item: "farmers-cheese", qty: 1, unit: "kg" },
      { item: "sugar", qty: 120, unit: "g" },
      { item: "eggs", qty: 1, unit: "each" },
      { item: "vanilla", qty: 5, unit: "ml" },
    ],
  },
  {
    id: "cherry-compote",
    name: "Sour cherry compote",
    makes: "cherry-compote",
    yield: { qty: 1500, unit: "ml" },
    draft: true,
    components: [
      { item: "cherries-frozen", qty: 1000, unit: "g" },
      { item: "sugar", qty: 200, unit: "g" },
    ],
  },
];

export const recipeCatalog: Catalog = { ...stockCatalog, recipes };
