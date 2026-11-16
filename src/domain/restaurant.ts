import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface MenuItem {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  price: number;
  quantity?: number; // limited batch (pop-ups); omitted = unlimited
  piecesPerOrder?: number; // syrniki come three to an order; omitted = 1
  allergens: string[];
  dietary: string[];
  description: string;
}

export interface RestaurantConfig {
  id: string;
  draft?: boolean;
  name: string;
  codePrefix: string;
  city: string;
  phone?: string;
  timezone: string;
  instagram?: string;
  brand?: { tagline?: string; accent?: string; examples?: string[] };
  popup: {
    eventDate: string; // YYYY-MM-DD
    location: string;
    pickupWindows: string[]; // HH:MM
    ordersPerWindow: number;
    orderCutoff: string; // ISO datetime
    paymentLink?: string;
    maxOrdersPerPhone?: number; // default 2
    maxPerItem?: number; // most of one item in a single order, default 6
  };
  menu: MenuItem[];
}

export interface Order {
  id: string;
  name: string;
  phone: string;
  items: { id: string; name: string; quantity: number; price: number }[];
  total: number;
  pickupDate?: string;
  pickupTime: string;
  notes?: string;
  sessionId?: string;
  createdAt?: string;
}

const DATA_DIR = fileURLToPath(new URL("../../data/restaurants/", import.meta.url));

export const listRestaurants = () => readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

export function loadRestaurant(id = process.env.MISE_RESTAURANT || "ruki"): RestaurantConfig {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid restaurant id "${id}"`);
  return JSON.parse(readFileSync(`${DATA_DIR}${id}.json`, "utf8")) as RestaurantConfig;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Receives every order so it can be saved; replays them on restart. */
export interface Recorder {
  record(kind: "order", value: Order): void;
}

/** Pop-up state: orders and remaining stock. One instance per process or per eval scenario. */
export class RestaurantStore {
  readonly orders: Order[] = [];

  constructor(
    readonly config: RestaurantConfig = loadRestaurant(),
    opts: { history?: { orders?: Order[] }; recorder?: Recorder } = {},
  ) {
    for (const o of opts.history?.orders ?? []) this.orders.push(o);
    this.recorder = opts.recorder;
  }
  private recorder?: Recorder;

  menu(): MenuItem[] {
    return this.config.menu;
  }

  /** Units left of a limited item, or undefined when unlimited. */
  remaining(itemId: string): number | undefined {
    const item = this.config.menu.find((m) => m.id === itemId);
    if (item?.quantity === undefined) return undefined;
    const sold = this.orders.flatMap((o) => o.items).filter((l) => l.id === itemId).reduce((s, l) => s + l.quantity, 0);
    return Math.max(0, item.quantity - sold);
  }

  findItem(idOrName: string): MenuItem | undefined {
    const q = idOrName.trim().toLowerCase();
    return this.config.menu.find((m) => m.id === q || m.name.toLowerCase() === q || m.aliases.some((a) => a.toLowerCase() === q));
  }

  searchMenu(opts: { query?: string; excludeAllergens?: string[]; dietary?: string[] }) {
    const q = opts.query?.trim().toLowerCase();
    return this.config.menu
      .filter((m) => {
        if (q && q !== "*") {
          const hay = [m.name, m.category, m.description, ...m.aliases].join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (opts.excludeAllergens?.some((a) => m.allergens.includes(a))) return false;
        if (opts.dietary?.some((d) => !m.dietary.includes(d))) return false;
        return true;
      })
      .map((m) => ({ ...m, remaining: this.remaining(m.id), soldOut: this.remaining(m.id) === 0 }));
  }

  // ---------- pickup windows (pop-up mode) ----------

  windows(now: Date) {
    const p = this.config.popup;
    if (!p) return [];
    const closed = now.getTime() > Date.parse(p.orderCutoff);
    return p.pickupWindows.map((time) => {
      const taken = this.orders.filter((o) => o.pickupTime === time).length;
      return { time, left: Math.max(0, p.ordersPerWindow - taken), open: !closed && taken < p.ordersPerWindow };
    });
  }

  // ---------- orders ----------

  placeOrder(
    o: { name: string; phone: string; items: { item: string; quantity: number }[]; pickupTime?: string; notes?: string; sessionId?: string },
    now: Date,
    opts: { caps?: boolean } = {},
  ): Order & { duplicate?: boolean } {
    const c = this.config;
    if (!Array.isArray(o.items) || !o.items.length) throw new Error("An order needs at least one item.");
    if (o.items.length > 20) throw new Error("That's more than 20 different items. For a big order, ask for the owner.");
    const contact = checkContact(o.name, o.phone);

    // Merge repeated lines ("2 syrniki" + "1 syrniki") before checking stock, so a split order can't oversell.
    const qty = new Map<string, number>();
    for (const { item, quantity } of o.items) {
      const m = this.findItem(String(item ?? ""));
      if (!m) throw new Error(`"${item}" is not on the menu.`);
      if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`Invalid quantity for ${m.name}.`);
      qty.set(m.id, (qty.get(m.id) ?? 0) + quantity);
    }
    const lines = [...qty].map(([id, quantity]) => {
      const m = this.config.menu.find((x) => x.id === id)!;
      if (quantity > 20) throw new Error(`Invalid quantity for ${m.name}: 20 is the most per order.`);
      const left = this.remaining(m.id);
      if (left !== undefined && quantity > left) throw new Error(left === 0 ? `${m.name} is sold out.` : `Only ${left} ${m.name} left.`);
      return { id: m.id, name: m.name, quantity, price: m.price };
    });

    const pickupTime = o.pickupTime ? normTime(o.pickupTime) : undefined;
    if (now.getTime() > Date.parse(c.popup.orderCutoff)) throw new Error("Preorders are closed for this pop-up.");
    if (!pickupTime) throw new Error(`Pick a pickup window: ${c.popup.pickupWindows.join(", ")}.`);
    const pickupDate = c.popup.eventDate;

    // The same conversation placing the same order again (a repeated "yes", a retried tool call) gets the original back.
    const same = (x: Order) =>
      x.sessionId === o.sessionId && digits(x.phone) === contact.phone && x.pickupTime === pickupTime &&
      JSON.stringify(x.items.map((l) => [l.id, l.quantity]).sort()) === JSON.stringify(lines.map((l) => [l.id, l.quantity]).sort());
    const dupe = o.sessionId && this.orders.find((x) => same(x) && now.getTime() - Date.parse(x.createdAt ?? "0") < 60 * 60_000);
    if (dupe) return { ...dupe, duplicate: true };

    if (opts.caps !== false) {
      const maxPerPhone = c.popup.maxOrdersPerPhone ?? 2;
      const fromPhone = this.orders.filter((x) => lastTen(x.phone) === lastTen(o.phone)).length;
      if (fromPhone >= maxPerPhone)
        throw new Error(`This phone number already has ${fromPhone} preorders. To change one, message us${c.instagram ? ` on Instagram (${c.instagram})` : ""}.`);
      const maxPerItem = c.popup.maxPerItem ?? 6;
      for (const l of lines) if (l.quantity > maxPerItem) throw new Error(`One order can include at most ${maxPerItem} of ${l.name}.`);
    }

    const w = this.windows(now).find((x) => x.time === pickupTime);
    if (!w) throw new Error(`${pickupTime} isn't a pickup window. Windows: ${c.popup.pickupWindows.join(", ")}.`);
    if (!w.open) throw new Error(`The ${pickupTime} window is full.`);

    const order: Order = {
      id: `${c.codePrefix}-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: contact.name,
      phone: o.phone.trim(),
      items: lines,
      total: lines.reduce((s, l) => s + l.price * l.quantity, 0),
      pickupDate,
      pickupTime,
      notes: clip(o.notes, 300),
      sessionId: o.sessionId,
      createdAt: now.toISOString(),
    };
    this.orders.push(order);
    this.recorder?.record("order", order);
    return order;
  }
}

// ---------- validation helpers ----------

const digits = (s: string) => String(s ?? "").replace(/\D/g, "");
const lastTen = (s: string) => digits(s).slice(-10);
const clip = (s: string | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : undefined);

/** "9:30", " 11:00 " -> "09:30", "11:00". Anything else passes through and fails the stricter checks. */
export const normTime = (t: string) => {
  const m = String(t ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : String(t ?? "").trim();
};

function checkContact(name: unknown, phone: unknown) {
  const n = typeof name === "string" ? name.trim() : "";
  const p = digits(String(phone ?? ""));
  if (!n || typeof phone !== "string" || !phone.trim()) throw new Error("A name and phone number are required.");
  if (n.length > 80) throw new Error("That name is too long. Please give a first name or the name for the order.");
  if (p.length < 7 || p.length > 15) throw new Error("That doesn't look like a phone number. Please ask the guest for a number with area code.");
  return { name: n, phone: p };
}

export const localDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
