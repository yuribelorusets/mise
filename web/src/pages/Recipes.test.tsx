import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { recipeCatalog } from "../fixtures/recipes";
import { fakeApi, type FakeRoutes } from "../test/fake-api";
import { renderWith } from "../test/render";
import Recipes from "./Recipes";

// What the server's cost route answers, by "item|qty|unit".
const costs: Record<string, { cost: number; missing: string[] }> = {
  "syrniki|20|order": { cost: 38.04, missing: ["salt"] },
  "syrniki|1|order": { cost: 1.9, missing: ["salt"] },
  "syrniki-batter|2400|g": { cost: 21.5, missing: ["salt"] },
  "syrniki-batter|1|kg": { cost: 8.96, missing: ["salt"] },
  "nalysnyky-batter|1|L": { cost: 3.1, missing: [] },
  "salt|10|g": { cost: 0, missing: ["salt"] },
  "jam|400|g": { cost: 4.8, missing: [] },
};

function serve(extra: FakeRoutes = {}, calls: string[] = []) {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/kitchen/catalog": () => recipeCatalog,
    "GET /api/kitchen/cost": (_b, req) => costs[`${req.query.get("item")}|${req.query.get("qty")}|${req.query.get("unit")}`] ?? { cost: 0, missing: [] },
    ...extra,
  }, calls));
}
const open = (path = "/recipes") => renderWith(<Recipes />, { path });

afterEach(() => vi.unstubAllGlobals());

test("lists the recipes and badges only the draft", async () => {
  serve();
  open();
  expect(await screen.findAllByRole("listitem")).toHaveLength(6);
  expect(within(screen.getByRole("link", { name: /sour cherry compote/i })).getByText("Draft")).toBeInTheDocument();
  expect(within(screen.getByRole("link", { name: /^syrniki batter/i })).queryByText("Draft")).not.toBeInTheDocument();
  expect(screen.getAllByText("Draft")).toHaveLength(1);
});

test("the list shows the cost of one plate, or one kg, from the server", async () => {
  serve();
  open();
  const syrniki = await screen.findByRole("link", { name: /^syrniki\s*makes 20 order/i });
  await waitFor(() => expect(syrniki).toHaveTextContent("$1.90"));
  expect(syrniki).toHaveTextContent("/ plate");
  await waitFor(() => expect(screen.getByRole("link", { name: /^syrniki batter/i })).toHaveTextContent("$8.96"));
});

test("the editor shows yield, components and the cost per batch and per plate", async () => {
  const calls: string[] = [];
  serve({}, calls);
  open();
  await userEvent.click(await screen.findByRole("link", { name: /^syrniki\s*makes 20 order/i }));
  expect(screen.getByRole("heading", { level: 2, name: "Syrniki" })).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "Yield" })).toHaveValue(20);
  expect(screen.getByRole("spinbutton", { name: "Sour cream" })).toHaveValue(600);
  await waitFor(() => expect(screen.getByText("Per batch").nextElementSibling).toHaveTextContent("$38.04"));
  expect(screen.getByText("Per plate").nextElementSibling).toHaveTextContent("$1.90");
  expect(calls).toContain("GET /api/kitchen/cost?item=syrniki&qty=20&unit=order");
  expect(calls).toContain("GET /api/kitchen/cost?item=syrniki&qty=1&unit=order");
});

test("a component made by a recipe is marked and links to that recipe", async () => {
  serve();
  open("/recipes?r=syrniki");
  const batter = await screen.findByRole("listitem", { name: "Syrniki batter" });
  expect(within(batter).getByText("Recipe")).toBeInTheDocument();
  expect(within(screen.getByRole("listitem", { name: "Jam" })).queryByText("Recipe")).not.toBeInTheDocument();
  await userEvent.click(within(batter).getByRole("link", { name: "Syrniki batter" }));
  expect(screen.getByRole("heading", { level: 2, name: "Syrniki batter" })).toBeInTheDocument();
  expect(await screen.findByText("Per kg")).toBeInTheDocument();
});

test("names the ingredients with no known price by name", async () => {
  serve();
  open("/recipes?r=syrniki-batter");
  expect(await screen.findByRole("note", { name: /no price/i })).toHaveTextContent("No price for Salt");
  await waitFor(() => expect(within(screen.getByRole("listitem", { name: "Salt" })).getByText("no price")).toBeInTheDocument());
});

test("saving sends the edited recipe to the catalog and says so", async () => {
  const saved: unknown[] = [];
  serve({ "POST /api/kitchen/catalog/recipes": (b) => (saved.push(b), recipeCatalog) });
  open("/recipes?r=syrniki");
  await userEvent.click(await screen.findByRole("button", { name: "More Jam" }));
  await userEvent.click(screen.getByRole("button", { name: /save recipe/i }));
  await waitFor(() => expect(saved).toHaveLength(1));
  const recipe = saved[0] as { id: string; components: { item: string; qty: number }[] };
  expect(recipe.id).toBe("syrniki");
  expect(recipe.components.find((c) => c.item === "jam")?.qty).toBe(450);
  expect(await screen.findByText("Saved.")).toBeInTheDocument();
});

test("shows the server's errors when a save is refused", async () => {
  serve({
    "POST /api/kitchen/catalog/recipes": () => ({ status: 422, error: "Recipe cycle: syrniki -> syrniki.", errors: ["Recipe cycle: syrniki -> syrniki."] }),
  });
  open("/recipes?r=syrniki");
  await userEvent.click(await screen.findByRole("button", { name: "More Jam" }));
  await userEvent.click(screen.getByRole("button", { name: /save recipe/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Recipe cycle: syrniki -> syrniki.");
});
