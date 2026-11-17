import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beetsReply, eggsReply, openProposal } from "../fixtures/assistant";
import { stockCatalog } from "../fixtures/items";
import { fakeApi, type FakeRoutes } from "../test/fake-api";
import { renderWith } from "../test/render";
import Assistant from "./Assistant";

function serve(extra: FakeRoutes = {}, calls: string[] = []) {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/kitchen/catalog": () => stockCatalog,
    "GET /api/kitchen/proposals": () => [],
    ...extra,
  }, calls));
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const send = async (text: string) => {
  await userEvent.type(await screen.findByLabelText("Message"), text);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
};

test("sending a message shows the reply and a proposal card", async () => {
  const sent: { sessionId: string; message: string }[] = [];
  serve({ "POST /api/kitchen/assistant": (b) => (sent.push(b), eggsReply) });
  renderWith(<Assistant />);
  await send("two cases eggs");
  expect(await screen.findByText(eggsReply.reply)).toBeInTheDocument();
  expect(screen.getByText("two cases eggs")).toBeInTheDocument();
  expect(await screen.findByRole("region", { name: "Proposal" })).toBeInTheDocument();
  expect(sent[0].message).toBe("two cases eggs");
  expect(sent[0].sessionId).toMatch(/\S{8,}/);
  expect(screen.getByLabelText("Message")).toHaveValue("");
});

test("the card follows the live proposal list over the copy that came with the message", async () => {
  const live = { ...eggsReply.proposals[0], status: "confirmed" as const };
  serve({ "POST /api/kitchen/assistant": () => eggsReply, "GET /api/kitchen/proposals": () => [live] });
  renderWith(<Assistant />);
  await send("two cases eggs");
  expect(await screen.findByText("Booked")).toBeInTheDocument();
});

test("the same session id goes with every message in a tab", async () => {
  const ids: string[] = [];
  serve({ "POST /api/kitchen/assistant": (b) => (ids.push(b.sessionId), { ...eggsReply, proposals: [] }) });
  renderWith(<Assistant />);
  await send("one");
  await waitFor(() => expect(ids).toHaveLength(1));
  await send("two");
  await waitFor(() => expect(ids).toHaveLength(2));
  expect(ids[1]).toBe(ids[0]);
});

test("the conversation survives a reload of the tab", async () => {
  serve({ "POST /api/kitchen/assistant": () => ({ ...eggsReply, proposals: [] }) });
  const first = renderWith(<Assistant />);
  await send("two cases eggs");
  await screen.findByText(eggsReply.reply);
  first.unmount();
  renderWith(<Assistant />);
  expect(await screen.findByText(eggsReply.reply)).toBeInTheDocument();
  expect(screen.getByText("two cases eggs")).toBeInTheDocument();
});

test("an offer to add an item creates it by name and unit, and says to repeat the change", async () => {
  const saved: unknown[] = [];
  const replaced: unknown[] = [];
  serve({
    "POST /api/kitchen/assistant": () => beetsReply,
    "POST /api/kitchen/items": (b) => (saved.push(b), { id: "pickled-beets", ...b }),
    "POST /api/kitchen/catalog/items": (b) => (replaced.push(b), stockCatalog),
  });
  renderWith(<Assistant />);
  await send("6 jars pickled beets");
  const offer = await screen.findByRole("group", { name: "New item" });
  await userEvent.click(within(offer).getByRole("button", { name: "Add Pickled beets (g)" }));
  await waitFor(() => expect(saved).toEqual([{ name: "Pickled beets", baseUnit: "g" }]));
  expect(replaced).toEqual([]);
  expect(await within(offer).findByText(/added/i)).toBeInTheDocument();
  expect(within(offer).getByText(/repeat the change/i)).toBeInTheDocument();
});

test("an offer whose id is taken says so on the card", async () => {
  serve({
    "POST /api/kitchen/assistant": () => beetsReply,
    "POST /api/kitchen/items": () => ({ status: 409, error: "That's already in the catalog as \"pickled-beets\" (Pickled beets)." }),
  });
  renderWith(<Assistant />);
  await send("6 jars pickled beets");
  const offer = await screen.findByRole("group", { name: "New item" });
  await userEvent.click(within(offer).getByRole("button", { name: "Add Pickled beets (g)" }));
  expect(await within(offer).findByRole("alert")).toHaveTextContent("That's already in the catalog as");
});

test("a failed turn shows the server's error and keeps what was typed", async () => {
  serve({ "POST /api/kitchen/assistant": () => ({ status: 429, error: "You're sending messages too fast. Try again in a minute." }) });
  renderWith(<Assistant />);
  await send("two cases eggs");
  expect(await screen.findByRole("alert")).toHaveTextContent("You're sending messages too fast.");
  expect(screen.getByLabelText("Message")).toHaveValue("two cases eggs");
});

test("an open proposal from an earlier turn can still be booked from its card", async () => {
  serve({ "POST /api/kitchen/assistant": () => ({ ...eggsReply, proposals: [openProposal] }), "GET /api/kitchen/proposals": () => [openProposal] });
  renderWith(<Assistant />);
  await send("delivery");
  expect(await screen.findByRole("button", { name: "Confirm" })).toBeEnabled();
});
