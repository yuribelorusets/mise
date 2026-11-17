export type {
  AssistantReply, BaseUnit, Catalog, Component, ConfirmResult, Item, Location, NewItemOffer, PlanLine,
  ProductionPlan, Proposal, ProposalLine, ProposalView, Recipe, StockEvent, StockKind, StockSource,
} from "../../../src/kitchen/types";

import type { ProductionPlan } from "../../../src/kitchen/types";

// Copied from src/kitchen/api.ts, src/kitchen/plan.ts and src/kitchen/stock.ts, which import Express
// or Node and so can't go into the web build. Keep them the same as the server's.

export type OnHand = Record<string, Record<string, number>>;

export interface PrepTask { recipe: string; item: string; qty: number; batches: number } // qty in base units of the item made
export interface ShoppingLine { item: string; need: number; have: number; buy: number; buyUnit?: string; buyQty?: number; buyUnitBase?: number; buyBase?: number }

/** What GET /api/kitchen/plans/:id/result returns: explode's result with names added. */
export interface PlanResult {
  prep: (PrepTask & { recipeName: string })[];
  shopping: (ShoppingLine & { name: string })[];
  uses: Record<string, number>;
}

export interface StockView {
  basedOn: number;
  onHand: OnHand;
  lastCount: Record<string, Record<string, { qty: number; at: string }>>;
  lastReceived: Record<string, string>;
}

/** What Today shows of a preorder: no phone, no notes, no last name. */
export interface GuestPreorder {
  firstName: string; // "" once retention has removed the name
  pickupTime: string;
  items: { name: string; quantity: number }[];
}

export interface TodayView {
  date: string;
  plan: ProductionPlan | null;
  prep: PlanResult["prep"];
  shopping: PlanResult["shopping"];
  preorders: GuestPreorder[];
}

export interface CostResult { cost: number; missing: string[] }

/** What GET /api/config returns that the guest page uses. */
export interface PublicConfig {
  id: string;
  name: string;
  city?: string;
  instagram?: string;
  tagline?: string;
  examples: string[];
  popup: { eventDate: string; location: string; pickupWindows: unknown[] };
  menu: { id: string; name: string; category: string; price: number; description: string; allergens: string[]; dietary: string[] }[];
  privacyNotice: string;
}
