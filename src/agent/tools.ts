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

const LIST_PICKUP_WINDOWS: ToolSpec = {
  name: "list_pickup_windows",
  description: "List the pop-up's pickup windows and how many orders each can still take. Call before asking a guest to choose a window.",
  input_schema: { type: "object", properties: {} },
};

const PLACE_ORDER: ToolSpec = {
  name: "place_order",
  description: "Place a preorder for pickup at the pop-up. Items must come from search_menu; pickupTime must be one of the open pickup windows.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      phone: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { item: { type: "string" }, quantity: { type: "integer", minimum: 1, description: "Number of orders, not pieces. See piecesPerOrder in search_menu." } },
          required: ["item", "quantity"],
        },
      },
      pickupTime: { type: "string", description: "HH:MM, one of the pickup windows (required)" },
      notes: { type: "string" },
    },
    required: ["name", "phone", "items", "pickupTime"],
  },
};

const HANDOFF: ToolSpec = {
  name: "handoff_to_human",
  description: "Escalate to the owner: refunds, complaints, catering or large custom orders, or anything you cannot resolve.",
  input_schema: {
    type: "object",
    properties: { reason: { type: "string" }, summary: { type: "string" } },
    required: ["reason", "summary"],
  },
};

/** The tools a model gets: a pop-up has pickup windows, not tables. */
export function toolSpecs(_c: RestaurantConfig): ToolSpec[] {
  return [SEARCH_MENU, LIST_PICKUP_WINDOWS, PLACE_ORDER, HANDOFF];
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
        const p = c.popup;
        return {
          isError: false,
          content: { eventDate: p.eventDate, location: p.location, orderCutoff: p.orderCutoff, windows: ctx.store.windows(ctx.now) },
        };
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
        const popup = { location: c.popup.location, payment: c.popup.paymentLink ? `Pay here to confirm: ${c.popup.paymentLink}` : "Pay at pickup." };
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
