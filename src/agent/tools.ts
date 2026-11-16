import type { ToolSpec } from "../llm/types.js";
import type { RestaurantConfig, RestaurantStore } from "../domain/restaurant.js";
import { WebhookClient, type MiseEvent } from "../integrations/webhook.js";

export const ALLERGENS = ["gluten", "dairy", "egg", "peanuts", "tree_nuts", "soy", "sesame", "fish", "shellfish"];
export const DIETARY = ["vegetarian", "vegan", "gluten_free", "dairy_free"];

const SEARCH_MENU: ToolSpec = {
  name: "search_menu",
  description:
    "Search the menu. The ONLY source of truth for dishes, prices, allergens and what's sold out. Use excludeAllergens whenever a guest mentions an allergy or intolerance. Use query '*' to list everything.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Dish, ingredient or category in English, or '*' for all." },
      excludeAllergens: { type: "array", items: { type: "string", enum: ALLERGENS } },
      dietary: { type: "array", items: { type: "string", enum: DIETARY } },
    },
    required: ["query"],
  },
};

const CHECK_AVAILABILITY: ToolSpec = {
  name: "check_availability",
  description: "Check whether a table is available. Always call this before create_reservation.",
  input_schema: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD" },
      time: { type: "string", description: "HH:MM, 24-hour, restaurant local time" },
      partySize: { type: "integer", minimum: 1 },
    },
    required: ["date", "time", "partySize"],
  },
};

const CREATE_RESERVATION: ToolSpec = {
  name: "create_reservation",
  description: "Book a table once you have date, time, party size, name and phone, and availability is confirmed.",
  input_schema: {
    type: "object",
    properties: {
      date: { type: "string" },
      time: { type: "string" },
      partySize: { type: "integer", minimum: 1 },
      name: { type: "string" },
      phone: { type: "string" },
      notes: { type: "string", description: "Allergies, occasions, accessibility needs." },
    },
    required: ["date", "time", "partySize", "name", "phone"],
  },
};

const LIST_PICKUP_WINDOWS: ToolSpec = {
  name: "list_pickup_windows",
  description: "List the pop-up's pickup windows and how many orders each can still take. Call before asking a guest to choose a window.",
  input_schema: { type: "object", properties: {} },
};

const placeOrder = (popup: boolean): ToolSpec => ({
  name: "place_order",
  description: popup
    ? "Place a preorder for pickup at the pop-up. Items must come from search_menu; pickupTime must be one of the open pickup windows."
    : "Place a pickup order. Items must be menu item ids or names returned by search_menu.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      phone: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { item: { type: "string" }, quantity: { type: "integer", minimum: 1 } },
          required: ["item", "quantity"],
        },
      },
      pickupTime: { type: "string", description: popup ? "HH:MM, one of the pickup windows (required)" : "HH:MM, optional" },
      notes: { type: "string" },
    },
    required: popup ? ["name", "phone", "items", "pickupTime"] : ["name", "phone", "items"],
  },
});

const handoff = (c: RestaurantConfig): ToolSpec => ({
  name: "handoff_to_human",
  description:
    c.mode === "popup"
      ? "Escalate to the owner: refunds, complaints, catering or large custom orders, or anything you cannot resolve."
      : `Escalate to a staff member: refunds, complaints, parties larger than ${c.seating.maxPartySize}, private events, or anything you cannot resolve.`,
  input_schema: {
    type: "object",
    properties: { reason: { type: "string" }, summary: { type: "string" } },
    required: ["reason", "summary"],
  },
});

/** The tools a model gets depend on the business: a pop-up has pickup windows, not tables. */
export function toolSpecs(c: RestaurantConfig): ToolSpec[] {
  return c.mode === "popup"
    ? [SEARCH_MENU, LIST_PICKUP_WINDOWS, placeOrder(true), handoff(c)]
    : [SEARCH_MENU, CHECK_AVAILABILITY, CREATE_RESERVATION, placeOrder(false), handoff(c)];
}

export interface ToolContext {
  store: RestaurantStore;
  webhook: WebhookClient;
  sessionId: string;
  channel: MiseEvent["channel"];
  now: Date;
}

export interface ToolOutcome { content: unknown; isError: boolean; handoff?: boolean }

/** Deliver in the background: a slow or dead CRM must never make a guest wait. */
function emit(ctx: ToolContext, type: Parameters<WebhookClient["build"]>[0], data: Record<string, unknown>) {
  ctx.webhook.send(ctx.webhook.build(type, ctx.sessionId, ctx.channel, data)).catch((err) => console.error("[mise] webhook failed:", err));
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const c = ctx.store.config;
  // A model can only call tools it was given, but don't trust that: enforce it here too.
  if (!toolSpecs(c).some((t) => t.name === name)) return { isError: true, content: { error: `Tool ${name} is not available for ${c.name}.` } };
  try {
    switch (name) {
      case "search_menu": {
        const items = ctx.store.searchMenu({
          query: str(input.query),
          excludeAllergens: strArr(input.excludeAllergens),
          dietary: strArr(input.dietary),
        });
        return {
          isError: false,
          content: {
            results: items.map(({ id, name, price, allergens, dietary, description, piecesPerOrder, remaining, soldOut }) => ({
              id, name, price, allergens, dietary, description,
              ...(piecesPerOrder && piecesPerOrder > 1 ? { piecesPerOrder } : {}),
              ...(remaining !== undefined ? { remaining, soldOut } : {}),
            })),
            note: items.length ? "Kitchen handles all major allergens; cross-contact is possible." : "No matching dishes on the menu.",
          },
        };
      }
      case "list_pickup_windows": {
        const p = c.popup!;
        return {
          isError: false,
          content: { eventDate: p.eventDate, location: p.location, orderCutoff: p.orderCutoff, windows: ctx.store.windows(ctx.now) },
        };
      }
      case "check_availability":
        return { isError: false, content: ctx.store.checkAvailability(str(input.date), str(input.time), Number(input.partySize), ctx.now) };
      case "create_reservation": {
        const res = ctx.store.createReservation({
          date: str(input.date), time: str(input.time), partySize: Number(input.partySize),
          name: str(input.name), phone: str(input.phone), notes: str(input.notes) || undefined, sessionId: ctx.sessionId,
        }, ctx.now);
        if (!res.duplicate) emit(ctx, "reservation.created", { restaurant: c.id, ...res });
        return { isError: false, content: { confirmed: true, ...res } };
      }
      case "place_order": {
        const items = Array.isArray(input.items)
          ? input.items.map((i) => ({ item: str((i as Record<string, unknown>).item), quantity: Number((i as Record<string, unknown>).quantity) }))
          : [];
        const order = ctx.store.placeOrder(
          { name: str(input.name), phone: str(input.phone), items, pickupTime: str(input.pickupTime) || undefined, notes: str(input.notes) || undefined, sessionId: ctx.sessionId },
          ctx.now,
        );
        if (!order.duplicate) emit(ctx, "order.placed", { restaurant: c.id, ...order });
        const popup = c.mode === "popup" && c.popup
          ? { location: c.popup.location, payment: c.popup.paymentLink ? `Pay here to confirm: ${c.popup.paymentLink}` : "Pay at pickup." }
          : {};
        return { isError: false, content: { confirmed: true, ...order, ...popup } };
      }
      case "handoff_to_human": {
        emit(ctx, "handoff.requested", { restaurant: c.id, reason: str(input.reason).slice(0, 300), summary: str(input.summary).slice(0, 1000) });
        return { isError: false, handoff: true, content: { queued: true, message: "A staff member will follow up shortly." } };
      }
      default:
        return { isError: true, content: { error: `Unknown tool ${name}` } };
    }
  } catch (err) {
    return { isError: true, content: { error: (err as Error).message } };
  }
}
