// What the kitchen API sends for proposals and assistant turns, as test data for the fake API.
import type { AssistantReply, ProposalView } from "../api/types";

const base = { createdAt: "2026-12-04T08:41:00", source: "chat" as const, basedOn: 212, stale: false };

export const openProposal: ProposalView = {
  ...base,
  id: "p-open",
  status: "open",
  lines: [
    { kind: "receive", item: "eggs", location: "walk-in", qty: 2, unit: "case", raw: "2 cases eggs" },
    { kind: "receive", item: "butter", location: "walk-in", qty: 10, unit: "lb", raw: "10 lb butter" },
    { kind: "receive", item: "sour-cream", location: "walk-in", qty: 3, unit: "tub", raw: "3 tubs sour cream" },
  ],
  problems: [null, null, null],
};

export const staleProposal: ProposalView = {
  ...base,
  id: "p-stale",
  status: "open",
  stale: true,
  basedOn: 209,
  lines: [{ kind: "waste", item: "eggs", location: "walk-in", qty: 4, unit: "dozen", raw: "4 dozen eggs" }],
  problems: [null],
};

export const confirmedProposal: ProposalView = {
  ...base,
  id: "p-done",
  status: "confirmed",
  confirmedAt: "2026-12-04T07:56:00",
  events: ["e-1"],
  lines: [{ kind: "use", item: "farmers-cheese", location: "walk-in", qty: 1.5, unit: "kg", raw: "1.5 kg farmer's cheese" }],
  problems: [null],
};

export const discardedProposal: ProposalView = {
  ...base,
  id: "p-gone",
  status: "discarded",
  discardedAt: "2026-12-04T09:00:00",
  lines: [
    { kind: "use", item: "flour", location: "dry-store", qty: 2, unit: "kg" },
    { kind: "use", item: "sugar", location: "dry-store", qty: 1, unit: "kg" },
  ],
  problems: [null, null],
};

const usage = { input_tokens: 10, output_tokens: 10 };

export const eggsReply: AssistantReply = {
  reply: "Here is what I would book. Check the amounts, then confirm.",
  proposals: [{ ...openProposal, id: "p-new", lines: [openProposal.lines[0]], problems: [null] }],
  offers: [],
  model: "mock",
  usage,
};

export const beetsReply: AssistantReply = {
  reply: "I don't have pickled beets on the list.",
  proposals: [],
  offers: [{ id: "pickled-beets", name: "Pickled beets", baseUnit: "g", raw: "6 jars pickled beets" }],
  model: "mock",
  usage,
};
