import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stockCatalog } from "../fixtures/items";
import { planResults, plans } from "../fixtures/plans";
import { fakeApi, type FakeRoutes } from "../test/fake-api";
import { renderWith } from "../test/render";
import Plan from "./Plan";

function serve(extra: FakeRoutes = {}, calls: string[] = []) {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/kitchen/catalog": () => stockCatalog,
    "GET /api/kitchen/plans": () => plans,
    "GET /api/kitchen/plans/:id/result": (_b, req) => planResults[req.params.id],
    ...extra,
  }, calls));
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-04T09:00:00") }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("marks the preorder lines and leaves manual lines unmarked", async () => {
  serve();
  renderWith(<Plan />);
  const syrniki = await screen.findByRole("group", { name: "Syrniki" });
  const [manual, preorder] = within(syrniki).getAllByRole("listitem");
  expect(manual).toHaveTextContent(/Manual/);
  expect(within(manual).getByRole("spinbutton", { name: /syrniki/i })).toHaveValue(26);
  expect(within(manual).queryByText("Preorder")).not.toBeInTheDocument();
  expect(preorder).toHaveTextContent(/14/);
  expect(within(preorder).getByText("Preorder")).toBeInTheDocument();
  expect(within(preorder).queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.getAllByText("Preorder")).toHaveLength(2);
});

test("adds manual and preorder lines into one total per item", async () => {
  serve();
  renderWith(<Plan />);
  expect(await screen.findByRole("group", { name: "Syrniki" })).toHaveTextContent(/Syrniki\s*40\s*order/);
  expect(screen.getByText("28 from preorders")).toBeInTheDocument();
});

test("starts on the first plan from today on, and lists the plans by date", async () => {
  serve();
  renderWith(<Plan />);
  expect(await screen.findByRole("button", { name: "Sat 5 Dec" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual(["Sun 6 Dec", "Sat 12 Dec"]);
});

test("summarises prep tasks and shortfalls, with names, for the selected date", async () => {
  const calls: string[] = [];
  serve({}, calls);
  renderWith(<Plan />);
  expect(await screen.findByRole("heading", { name: "Prep for Sat 5 Dec" })).toBeInTheDocument();
  expect(await screen.findByText("6 tasks")).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: "Syrniki batter" })).toBeInTheDocument();
  expect(screen.queryByText("syrniki-batter")).not.toBeInTheDocument();
  expect(screen.getByRole("row", { name: /farmer's cheese.*6 kg.*2\.5 kg.*3\.5 kg/i })).toBeInTheDocument();
  expect(calls).toContain("GET /api/kitchen/plans/plan-12-05/result");

  await userEvent.click(screen.getByRole("button", { name: "Sun 6 Dec" }));
  expect(screen.getByRole("button", { name: "Sun 6 Dec" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { name: "Prep for Sun 6 Dec" })).toBeInTheDocument();
  expect(await screen.findByText("3 tasks")).toBeInTheDocument();
  expect(screen.getByText("No preorders yet")).toBeInTheDocument();
  expect(screen.queryByText("Preorder")).not.toBeInTheDocument();
  expect(screen.getByText("1 item to buy")).toBeInTheDocument();
});

test("says so when nothing is short", async () => {
  serve();
  renderWith(<Plan />);
  await userEvent.click(await screen.findByRole("button", { name: "Sat 12 Dec" }));
  expect(await screen.findByText(/nothing short/i)).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Syrniki" })).toHaveTextContent(/Syrniki\s*2\s*order/);
});

test("saves a changed manual line through the catalog", async () => {
  const saved: { id: string; date: string; lines: { source: string; qty: number }[] }[] = [];
  serve({ "POST /api/kitchen/catalog/plans": (b) => (saved.push(b), stockCatalog) });
  renderWith(<Plan />);
  const save = await screen.findByRole("button", { name: /save plan/i });
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "More Syrniki manual" }));
  expect(screen.getByRole("group", { name: "Syrniki" })).toHaveTextContent(/Syrniki\s*41\s*order/);
  await userEvent.click(save);
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0].id).toBe("plan-12-05");
  expect(saved[0].lines.map((l) => [l.source, l.qty])).toEqual([["manual", 27], ["preorder", 14], ["manual", 16], ["preorder", 14]]);
  expect(await screen.findByText("Saved.")).toBeInTheDocument();
});

test("shows the server's message when a save is refused", async () => {
  serve({ "POST /api/kitchen/catalog/plans": () => ({ status: 422, error: "Plan date is wrong.", errors: ["Plan date is wrong."] }) });
  renderWith(<Plan />);
  await userEvent.click(await screen.findByRole("button", { name: "More Syrniki manual" }));
  await userEvent.click(screen.getByRole("button", { name: /save plan/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Plan date is wrong.");
});
