import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Recipes from "./Recipes";

const open = (path = "/recipes") => render(<MemoryRouter initialEntries={[path]}><Recipes /></MemoryRouter>);

test("lists the recipes and badges only the draft", () => {
  open();
  expect(screen.getAllByRole("listitem")).toHaveLength(6);
  expect(within(screen.getByRole("link", { name: /sour cherry compote/i })).getByText("Draft")).toBeInTheDocument();
  expect(within(screen.getByRole("link", { name: /^syrniki batter/i })).queryByText("Draft")).not.toBeInTheDocument();
  expect(screen.getAllByText("Draft")).toHaveLength(1);
});

test("the editor shows yield, components and the cost per batch and per plate", async () => {
  open();
  await userEvent.click(screen.getByRole("link", { name: /^syrniki\s*makes 20 order/i }));
  expect(screen.getByRole("heading", { level: 2, name: "Syrniki" })).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "Yield" })).toHaveValue(20);
  expect(screen.getByRole("spinbutton", { name: "Sour cream" })).toHaveValue(600);
  expect(screen.getByText("Per batch").nextElementSibling).toHaveTextContent("$38.04");
  expect(screen.getByText("Per plate").nextElementSibling).toHaveTextContent("$1.90");
});

test("a component made by a recipe is marked and links to that recipe", async () => {
  open("/recipes?r=syrniki");
  const batter = screen.getByRole("listitem", { name: "Syrniki batter" });
  expect(within(batter).getByText("Recipe")).toBeInTheDocument();
  expect(within(screen.getByRole("listitem", { name: "Jam" })).queryByText("Recipe")).not.toBeInTheDocument();
  await userEvent.click(within(batter).getByRole("link", { name: "Syrniki batter" }));
  expect(screen.getByRole("heading", { level: 2, name: "Syrniki batter" })).toBeInTheDocument();
  expect(screen.getByText("Per kg")).toBeInTheDocument();
});

test("names the ingredients with no known price, including ones inside a sub-recipe", () => {
  open("/recipes?r=syrniki-batter");
  expect(within(screen.getByRole("listitem", { name: "Salt" })).getByText("no price")).toBeInTheDocument();
  expect(screen.getByRole("note", { name: /no price/i })).toHaveTextContent("No price for Salt");
});

test("the plate recipe inherits a missing price from its batter", () => {
  open("/recipes?r=syrniki");
  expect(screen.getByRole("note", { name: /no price/i })).toHaveTextContent("No price for Salt");
});

test("changing a component amount changes the cost", async () => {
  open("/recipes?r=syrniki");
  await userEvent.click(screen.getByRole("button", { name: "More Jam" }));
  expect(screen.getByText("Per batch").nextElementSibling).toHaveTextContent("$38.64");
});
