import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "../App";
import { catalog, todayView } from "../fixtures/ruki";
import { fakeApi } from "../test/fake-api";
import { renderWith } from "../test/render";

afterEach(() => vi.unstubAllGlobals());

test("the tab bar reaches every owner screen", async () => {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/owner/me": () => ({ owner: true }),
    "GET /api/kitchen/today": () => todayView,
    "GET /api/kitchen/catalog": () => catalog,
  }));
  renderWith(<AppRoutes />);
  for (const name of ["Today", "Count", "Stock", "Recipes", "Plan"]) expect(await screen.findByRole("link", { name })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "Count" }));
  expect(screen.getByRole("heading", { level: 1, name: /count/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /assistant/i })).toBeInTheDocument();
});

test("the assistant strip is hidden on the assistant screen itself", async () => {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/owner/me": () => ({ owner: true }),
    "GET /api/kitchen/catalog": () => catalog,
    "GET /api/kitchen/proposals": () => [],
  }));
  renderWith(<AppRoutes />, { path: "/assistant" });
  expect(await screen.findByRole("heading", { level: 1, name: /assistant/i })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /ask the assistant/i })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
});

test("the public order page has no owner tab bar", () => {
  vi.stubGlobal("fetch", fakeApi({}));
  renderWith(<AppRoutes />, { path: "/order" });
  expect(screen.queryByRole("link", { name: "Stock" })).not.toBeInTheDocument();
});
