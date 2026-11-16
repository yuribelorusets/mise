// Local copies of the kitchen types the mockups need. They mirror
// src/kitchen/types.ts; the wired screens will get them from the API.

export type BaseUnit = "g" | "ml" | "each";

export interface Item {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  /** Item-specific units, in base units: { case: 180 } for eggs. */
  units: Record<string, number>;
  /** Par level in base units. */
  par?: number;
  shelfLifeDays?: number;
}

export interface Component {
  item: string;
  qty: number;
  unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  /** The item this recipe makes. */
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

export type StockKind = "receive" | "use" | "waste" | "count" | "move";
export type StockSource = "manual" | "chat" | "receipt" | "preorder" | "production";

export interface StockEvent {
  id: string;
  at: string; // ISO time
  kind: StockKind;
  item: string;
  location: string;
  /** Base units, never negative: the kind says which way it goes. For a count, the amount found. */
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
