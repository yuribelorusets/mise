// Shared kitchen types. Wave 1 builds against these; change them only through the orchestrator.

export type BaseUnit = "g" | "ml" | "each";

export interface Item {
  id: string; // kebab-case, stable
  name: string;
  aliases: string[]; // other names, including ones learned from receipts
  baseUnit: BaseUnit;
  /** Item-specific units, in base units: { case: 180, dozen: 12 } for eggs, { order: 3 } for syrniki. */
  units: Record<string, number>;
  category?: string;
  allergens: string[];
  /** Par level in base units. */
  par?: number;
  shelfLifeDays?: number;
}

export interface Location {
  id: string;
  name: string;
  /** Item ids in shelf order, for the count screen. */
  shelfOrder: string[];
}

export interface Component {
  item: string;
  qty: number;
  unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  /** The item this recipe makes. Every recipe makes exactly one item. */
  makes: string;
  yield: { qty: number; unit: string };
  components: Component[];
  draft?: boolean;
}

export interface PlanLine {
  item: string;
  qty: number;
  unit: string;
  source: "manual" | "preorder";
}

export interface ProductionPlan {
  id: string;
  date: string; // YYYY-MM-DD
  lines: PlanLine[];
}

export interface Catalog {
  items: Item[];
  locations: Location[];
  recipes: Recipe[];
  plans: ProductionPlan[];
}

export type StockKind = "receive" | "use" | "waste" | "count" | "move";
export type StockSource = "manual" | "chat" | "receipt" | "preorder" | "production";

export interface StockEvent {
  id: string;
  at: string; // ISO time
  kind: StockKind;
  item: string;
  location: string;
  /** Base units. Always >= 0: the kind says which way it goes. For a count, the amount found. */
  qty: number;
  /** Destination location, for a move. */
  to?: string;
  source: StockSource;
  /** Price paid per base unit, for a receive. */
  unitCost?: number;
  note?: string;
  proposal?: string;
}

export interface ProposalLine {
  kind: StockKind;
  item: string;
  location: string;
  qty: number;
  unit: string;
  to?: string;
  unitCost?: number;
  /** The text this line came from ("two cases eggs"). */
  raw?: string;
}

export interface Proposal {
  id: string;
  createdAt: string;
  source: StockSource;
  lines: ProposalLine[];
  status: "open" | "confirmed" | "discarded";
  /** Number of stock events when the proposal was made, so a confirm can tell it's stale. */
  basedOn: number;
}

export interface KitchenStore {
  catalog(): Catalog;
  saveCatalog(c: Catalog): void;
  events(): readonly StockEvent[];
  append(events: StockEvent[]): void;
}
