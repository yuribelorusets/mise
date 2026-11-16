import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "../App";
import { fakeApi } from "../test/fake-api";
import { renderWith } from "../test/render";

afterEach(() => vi.unstubAllGlobals());

test("the tab bar reaches every owner screen", async () => {
  vi.stubGlobal("fetch", fakeApi({ "GET /api/owner/me": () => ({ owner: true }) }));
  renderWith(<AppRoutes />);
  for (const name of ["Today", "Count", "Stock", "Recipes", "Plan"]) expect(await screen.findByRole("link", { name })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "Count" }));
  expect(screen.getByRole("heading", { level: 1, name: /count/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /assistant/i })).toBeInTheDocument();
});

test("the public order page has no owner tab bar", () => {
  vi.stubGlobal("fetch", fakeApi({}));
  renderWith(<AppRoutes />, { path: "/order" });
  expect(screen.queryByRole("link", { name: "Stock" })).not.toBeInTheDocument();
});
