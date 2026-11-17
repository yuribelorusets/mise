import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { catalog, stockView } from "../fixtures/ruki";
import { fakeApi, type FakeRoutes } from "../test/fake-api";
import { renderWith } from "../test/render";
import Count from "./Count";

type Save = { clientId: string; location: string; lines: { item: string; qty: number; unit: string }[] };

function serve(extra: FakeRoutes = {}, calls: string[] = []) {
  vi.stubGlobal("fetch", fakeApi({ "GET /api/kitchen/catalog": () => catalog, "GET /api/kitchen/stock": () => stockView, ...extra }, calls));
}

afterEach(() => vi.unstubAllGlobals());

test("starts each row at the last count for that item and location, in shelf order", async () => {
  serve();
  renderWith(<Count />);
  const cheese = await screen.findByRole("spinbutton", { name: "Farmer's cheese" });
  expect(cheese).toHaveValue(2.268); // 2268 g, shown in kg
  expect(screen.getByRole("spinbutton", { name: "Eggs" })).toHaveValue(60);
  const names = screen.getAllByRole("spinbutton").map((n) => n.getAttribute("aria-label"));
  expect(names).toEqual(["Sour cream", "Farmer's cheese", "Eggs"]);
  await userEvent.click(screen.getByRole("button", { name: "Dry store" }));
  expect(screen.getByRole("spinbutton", { name: "Flour" })).toHaveValue(15.876);
  expect(screen.getByRole("spinbutton", { name: "Sugar" })).toHaveValue(0); // never counted
});

test("saves one POST for the location, with only the rows that changed", async () => {
  const saves: Save[] = [];
  serve({ "POST /api/kitchen/counts": (b: Save) => (saves.push(b), { events: ["count-1"] }) });
  renderWith(<Count />);
  await userEvent.click(await screen.findByRole("button", { name: "More Eggs" }));
  await userEvent.click(screen.getByRole("button", { name: /save count \(1 changed\)/i }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0].location).toBe("walk-in");
  expect(saves[0].lines).toEqual([{ item: "eggs", qty: 61, unit: "each" }]);
  expect(saves[0].clientId).toMatch(/^[a-z0-9-]{8,64}$/);
  expect(await screen.findByText(/saved/i)).toBeInTheDocument();
});

test("a second tap on Save after a network error sends the same clientId", async () => {
  const saves: Save[] = [];
  let fail = true;
  serve({
    "POST /api/kitchen/counts": (b: Save) => {
      saves.push(b);
      return fail ? { status: 500, error: "The server hiccuped." } : { events: ["count-1"] };
    },
  });
  renderWith(<Count />);
  await userEvent.click(await screen.findByRole("button", { name: "More Eggs" }));
  await userEvent.click(screen.getByRole("button", { name: /save count/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The server hiccuped.");
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: /save count/i }));
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(saves[1].clientId).toBe(saves[0].clientId);
});

test("shows the server's 422 problem under the row it's about", async () => {
  serve({
    "POST /api/kitchen/counts": () => ({ status: 422, error: "Eggs can't be measured in each.", problems: ["Eggs can't be measured in each."] }),
  });
  renderWith(<Count />);
  await userEvent.click(await screen.findByRole("button", { name: "More Eggs" }));
  await userEvent.click(screen.getByRole("button", { name: /save count/i }));
  const row = (await screen.findByText("Eggs", { selector: ".count__name" })).closest("li")!;
  expect(await within(row).findByText("Eggs can't be measured in each.")).toBeInTheDocument();
  expect(screen.getAllByText("Eggs can't be measured in each.")).toHaveLength(1);
});

test("a never-counted item left at zero can be marked counted and saved as zero", async () => {
  const saves: Save[] = [];
  serve({ "POST /api/kitchen/counts": (b: Save) => (saves.push(b), { events: ["count-1"] }) });
  renderWith(<Count />);
  await userEvent.click(await screen.findByRole("button", { name: "Dry store" }));
  const save = screen.getByRole("button", { name: /save count/i });
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Mark Sugar counted" }));
  expect(screen.getByRole("button", { name: "Mark Sugar counted" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: /save count \(1 changed\)/i }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0].lines).toEqual([{ item: "sugar", qty: 0, unit: "kg" }]);
});

test("amounts of g and ml items go as kg and L, with the value as entered", async () => {
  const saves: Save[] = [];
  serve({ "POST /api/kitchen/counts": (b: Save) => (saves.push(b), { events: ["count-1"] }) });
  renderWith(<Count />);
  await userEvent.click(await screen.findByRole("button", { name: "More Farmer's cheese" }));
  await userEvent.click(screen.getByRole("button", { name: /save count/i }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0].lines).toEqual([{ item: "farmers-cheese", qty: 2.768, unit: "kg" }]);
});

test("changing the lines after a failed save sends a new clientId", async () => {
  const saves: Save[] = [];
  serve({ "POST /api/kitchen/counts": (b: Save) => (saves.push(b), { status: 500, error: "The server hiccuped." }) });
  renderWith(<Count />);
  await userEvent.click(await screen.findByRole("button", { name: "More Eggs" }));
  await userEvent.click(screen.getByRole("button", { name: /save count/i }));
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "More Eggs" }));
  await userEvent.click(screen.getByRole("button", { name: /save count/i }));
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(saves[1].lines[0].qty).toBe(62);
  expect(saves[1].clientId).not.toBe(saves[0].clientId);
});

test("Save is off until something has changed", async () => {
  serve();
  renderWith(<Count />);
  expect(await screen.findByRole("button", { name: /save count/i })).toBeDisabled();
});
