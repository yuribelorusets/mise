// Shaped like Proposal and ProposalLine in src/kitchen/types.ts.
export type StockKind = "receive" | "use" | "waste" | "count" | "move";

export interface ProposalLine {
  kind: StockKind;
  item: string;
  location: string;
  qty: number;
  unit: string;
  to?: string;
  /** The text this line came from ("two cases eggs"). */
  raw?: string;
}

export interface Proposal {
  id: string;
  createdAt: string;
  source: "manual" | "chat" | "receipt" | "preorder" | "production";
  lines: ProposalLine[];
  status: "open" | "confirmed" | "discarded";
  /** Number of stock events when the proposal was made. */
  basedOn: number;
}

/** Stock events on record right now. A proposal based on fewer is stale. */
export const EVENT_COUNT = 212;

export type Message =
  | { id: string; from: "owner"; text: string }
  | { id: string; from: "assistant"; text: string; proposal?: Proposal; create?: { name: string; unit: string } };

export const conversation: Message[] = [
  { id: "m1", from: "owner", text: "Delivery came: 2 cases eggs, 10 lb butter, 3 tubs sour cream. All in the walk-in." },
  {
    id: "m2",
    from: "assistant",
    text: "Here is what I would book. Check the amounts, then confirm.",
    proposal: {
      id: "p1",
      createdAt: "2026-12-04T08:41:00",
      source: "chat",
      status: "open",
      basedOn: EVENT_COUNT,
      lines: [
        { kind: "receive", item: "eggs", location: "walk-in", qty: 2, unit: "case", raw: "2 cases eggs" },
        { kind: "receive", item: "butter", location: "walk-in", qty: 10, unit: "lb", raw: "10 lb butter" },
        { kind: "receive", item: "sour-cream", location: "walk-in", qty: 3, unit: "tub", raw: "3 tubs sour cream" },
      ],
    },
  },
  { id: "m3", from: "owner", text: "Used 1.5 kg farmer's cheese for the filling this morning." },
  {
    id: "m4",
    from: "assistant",
    text: "Booked.",
    proposal: {
      id: "p2",
      createdAt: "2026-12-04T07:55:00",
      source: "chat",
      status: "confirmed",
      basedOn: EVENT_COUNT - 1,
      lines: [{ kind: "use", item: "farmers-cheese", location: "walk-in", qty: 1.5, unit: "kg", raw: "1.5 kg farmer's cheese" }],
    },
  },
  { id: "m5", from: "owner", text: "Threw out 4 dozen eggs, they were cracked." },
  {
    id: "m6",
    from: "assistant",
    text: "Stock has moved since I drafted this.",
    proposal: {
      id: "p3",
      createdAt: "2026-12-04T08:12:00",
      source: "chat",
      status: "open",
      basedOn: EVENT_COUNT - 3,
      lines: [{ kind: "waste", item: "eggs", location: "walk-in", qty: 4, unit: "dozen", raw: "4 dozen eggs" }],
    },
  },
  { id: "m7", from: "owner", text: "Got 6 jars of pickled beets for the side plate." },
  {
    id: "m8",
    from: "assistant",
    text: "I don't have pickled beets on the list. Should I add them as a new item, counted in jars?",
    create: { name: "Pickled beets", unit: "jar" },
  },
];
