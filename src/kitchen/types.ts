// Shared kitchen types. Every package builds against these, so change them only between packages, not inside one.

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
  confirmedAt?: string;
  discardedAt?: string;
  /** Ids of the stock events the confirm wrote. */
  events?: string[];
}

/** A proposal as the API and the assistant return it. `stale` and `problems` are worked out when it's read. */
export interface ProposalView extends Proposal {
  /** Stock for one of its items changed after it was made. It can't be booked until it's refreshed. */
  stale: boolean;
  /** One entry per line: why it can't be booked as it stands, or null. */
  problems: (string | null)[];
}

export interface ConfirmResult {
  proposal: ProposalView;
  events: string[];
}

/** The assistant met a name it doesn't know and offers to add it. Nothing is written until the owner says yes. */
export interface NewItemOffer {
  /** What the item will be saved as. Worked out by the server, never by the screen. */
  id: string;
  name: string;
  baseUnit: BaseUnit;
  raw?: string;
}

export interface AssistantReply {
  reply: string;
  proposals: ProposalView[];
  offers: NewItemOffer[];
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface KitchenAssistant {
  turn(sessionId: string, text: string): Promise<AssistantReply>;
}

export interface KitchenStore {
  catalog(): Catalog;
  saveCatalog(c: Catalog): void;
  events(): readonly StockEvent[];
  append(events: StockEvent[]): void;
}
