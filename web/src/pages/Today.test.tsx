import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { catalog, todayView } from "../fixtures/ruki";
import { fakeApi, type FakeRoutes } from "../test/fake-api";
import { renderWith } from "../test/render";
import Today from "./Today";

const serve = (today: unknown = todayView, extra: FakeRoutes = {}) =>
  vi.stubGlobal("fetch", fakeApi({ "GET /api/kitchen/today": () => today, "GET /api/kitchen/catalog": () => catalog, ...extra }));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("shows the prep list and what's short", async () => {
  serve();
  renderWith(<Today />);
  expect(await screen.findByRole("heading", { name: /prep/i })).toBeInTheDocument();
  expect(screen.getByText(/syrniki batter/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /short/i })).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: /farmer's cheese/i })).toBeInTheDocument();
  expect(screen.getByText("Next production, Saturday 5 December: 40 syrniki, 30 nalysnyky")).toBeInTheDocument();
});

test("names a prep task by its recipe name, never its id", async () => {
  serve();
  renderWith(<Today />);
  expect(await screen.findByText("Syrniki batter")).toBeInTheDocument();
  expect(screen.queryByText("syrniki-batter")).not.toBeInTheDocument();
  expect(screen.queryByText(/dill-schmear/)).not.toBeInTheDocument();
});

test("checking a prep row keeps it on the list, and keeps it checked after a reload", async () => {
  serve();
  const first = renderWith(<Today />);
  const box = await screen.findByRole("checkbox", { name: /syrniki batter/i });
  expect(box).not.toBeChecked();
  expect(screen.getByText("0 of 6 done")).toBeInTheDocument();
  await userEvent.click(box);
  expect(box).toBeChecked();
  expect(screen.getByText("1 of 6 done")).toBeInTheDocument();
  expect(screen.getByText(/syrniki batter/i)).toBeInTheDocument();
  first.unmount();

  renderWith(<Today />);
  expect(await screen.findByRole("checkbox", { name: /syrniki batter/i })).toBeChecked();
});

test("a prep checkbox is named by its label: item, batches and quantity", async () => {
  serve();
  renderWith(<Today />);
  expect(await screen.findByRole("checkbox", { name: /syrniki batter.*2 batches.*4\.8.*kg/i })).toBeInTheDocument();
});

test("lists preorders by pickup time, by first name only", async () => {
  serve();
  renderWith(<Today />);
  expect(await screen.findByRole("heading", { name: /preorders/i })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem", { name: /preorder/i }).length).toBe(6);
  const marcus = screen.getByRole("listitem", { name: "Preorder from Marcus" });
  expect(within(marcus).getByText("2 syrniki, 2 nalysnyky")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "11:00" })).toBeInTheDocument();
});

test("the header gives one total per dish and says how many of it are preordered", async () => {
  const plan = {
    ...todayView.plan,
    lines: [
      { item: "syrniki", qty: 40, unit: "order", source: "manual" },
      { item: "nalysnyky", qty: 30, unit: "order", source: "manual" },
      { item: "syrniki", qty: 5, unit: "order", source: "preorder" },
    ],
  };
  serve({ ...todayView, plan });
  renderWith(<Today />);
  expect(await screen.findByText("Next production, Saturday 5 December: 45 syrniki (5 preordered), 30 nalysnyky")).toBeInTheDocument();
});

test("a plan made only from preorders says so once per dish", async () => {
  const plan = { id: "preorders-2026-12-05", date: "2026-12-05", lines: [{ item: "syrniki", qty: 5, unit: "order", source: "preorder" }] };
  serve({ ...todayView, plan });
  renderWith(<Today />);
  expect(await screen.findByText("Next production, Saturday 5 December: 5 syrniki (all preordered)")).toBeInTheDocument();
});

test("a preorder whose name was removed still shows", async () => {
  serve({ ...todayView, preorders: [{ firstName: "", pickupTime: "11:00", items: [{ name: "Syrniki", quantity: 2 }] }] });
  renderWith(<Today />);
  expect(await screen.findByRole("listitem", { name: /preorder from a guest/i })).toBeInTheDocument();
});

test("says there's no plan yet when the server has none", async () => {
  serve({ date: "2026-12-04", plan: null, prep: [], shopping: [], preorders: [] });
  renderWith(<Today />);
  expect(await screen.findByText(/no plan yet/i)).toBeInTheDocument();
});

test("a shopping line for an item the catalog doesn't know falls back to the name the server sent", async () => {
  serve({ ...todayView, shopping: [{ item: "mystery-flour", name: "mystery-flour", need: 10, have: 2, buy: 8 }] });
  renderWith(<Today />);
  expect(await screen.findByRole("rowheader", { name: /mystery-flour/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /short/i })).toBeInTheDocument();
});

test("shows the server's message when Today can't load", async () => {
  vi.stubGlobal("fetch", fakeApi({ "GET /api/kitchen/today": () => ({ status: 404, error: "Nothing here." }), "GET /api/kitchen/catalog": () => catalog }));
  renderWith(<Today />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Nothing here.");
});
