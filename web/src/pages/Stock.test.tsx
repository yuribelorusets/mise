import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stockCatalog } from "../fixtures/items";
import { historyOf, stockViewOf } from "../fixtures/stock";
import { fakeApi } from "../test/fake-api";
import { renderWith } from "../test/render";
import Stock from "./Stock";

function serve(calls: string[] = []) {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/kitchen/catalog": () => stockCatalog,
    "GET /api/kitchen/stock": () => stockViewOf(),
    "GET /api/kitchen/stock/:item/history": (_b, req) => historyOf(req.params.item),
  }, calls));
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-04T09:00:00") }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("lists stock under each location with amount and age", async () => {
  serve();
  renderWith(<Stock />);
  for (const name of ["Walk-in", "Dry store", "Freezer"]) expect(await screen.findByRole("heading", { level: 2, name })).toBeInTheDocument();
  const cheese = screen.getByRole("button", { name: /farmer's cheese/i });
  expect(cheese).toHaveTextContent("2.5");
  expect(cheese).toHaveTextContent("kg");
  expect(cheese).toHaveTextContent("received 3 days ago");
});

test("shows a negative amount and flags it", async () => {
  serve();
  renderWith(<Stock />);
  const jam = await screen.findByRole("button", { name: /jam/i });
  expect(jam).toHaveTextContent("−200");
  expect(within(jam).getByText("Negative")).toBeInTheDocument();
});

test("flags an item past its shelf life since it was last received, near expiry, and below par", async () => {
  serve();
  renderWith(<Stock />);
  expect(within(await screen.findByRole("button", { name: /whole milk/i })).getByText("Expired")).toBeInTheDocument();
  const sourCream = screen.getByRole("button", { name: /sour cream/i });
  expect(within(sourCream).getByText("Expires in 1 day")).toBeInTheDocument();
  expect(within(sourCream).getByText("Below par")).toBeInTheDocument();
  expect(within(screen.getByRole("button", { name: /butter/i })).queryByText(/par|expire/i)).not.toBeInTheDocument();
});

test("tapping an item fetches and opens its history with time, amount and source", async () => {
  const calls: string[] = [];
  serve(calls);
  renderWith(<Stock />);
  const eggs = await screen.findByRole("button", { name: /eggs/i });
  expect(screen.queryByRole("table", { name: /eggs history/i })).not.toBeInTheDocument();
  expect(calls.some((c) => c.includes("/history"))).toBe(false);
  await userEvent.click(eggs);
  expect(eggs).toHaveAttribute("aria-expanded", "true");
  const table = await screen.findByRole("table", { name: /eggs history/i });
  expect(calls).toContain("GET /api/kitchen/stock/eggs/history");
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringMatching(/Count.*Wed 2 Dec, 16:00.*manual.*=60/),
    expect.stringMatching(/Use.*Sat 28 Nov, 06:50.*production.*−96/),
    expect.stringMatching(/Receive.*Tue 24 Nov, 08:15.*receipt.*\+180/),
  ]);
  await userEvent.click(eggs);
  expect(screen.queryByRole("table", { name: /eggs history/i })).not.toBeInTheDocument();
});

test("a move shows on both sides", async () => {
  serve();
  renderWith(<Stock />);
  const freezer = await screen.findByRole("region", { name: "Freezer" });
  await userEvent.click(within(freezer).getByRole("button", { name: /syrniki/i }));
  expect(await screen.findByRole("table", { name: /syrniki history/i })).toHaveTextContent(/Move from Walk-in.*\+12/);
});

test("shows the server's message when stock can't load", async () => {
  vi.stubGlobal("fetch", fakeApi({ "GET /api/kitchen/catalog": () => stockCatalog, "GET /api/kitchen/stock": () => ({ status: 404, error: "No stock here." }) }));
  renderWith(<Stock />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No stock here.");
});
