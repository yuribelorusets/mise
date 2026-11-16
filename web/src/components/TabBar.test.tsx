import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../App";

test("the tab bar reaches every owner screen", async () => {
  render(<MemoryRouter initialEntries={["/"]}><AppRoutes /></MemoryRouter>);
  for (const name of ["Today", "Count", "Stock", "Recipes", "Plan"]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "Count" }));
  expect(screen.getByRole("heading", { level: 1, name: /count/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /assistant/i })).toBeInTheDocument();
});

test("the public order page has no owner tab bar", () => {
  render(<MemoryRouter initialEntries={["/order"]}><AppRoutes /></MemoryRouter>);
  expect(screen.queryByRole("link", { name: "Stock" })).not.toBeInTheDocument();
});
