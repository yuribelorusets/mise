import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Plan from "./Plan";

test("marks the preorder lines and leaves manual lines unmarked", () => {
  render(<Plan />);
  const syrniki = screen.getByRole("group", { name: "Syrniki" });
  const [manual, preorder] = within(syrniki).getAllByRole("listitem");
  expect(manual).toHaveTextContent(/Manual\s*26/);
  expect(within(manual).queryByText("Preorder")).not.toBeInTheDocument();
  expect(preorder).toHaveTextContent(/14/);
  expect(within(preorder).getByText("Preorder")).toBeInTheDocument();
  expect(screen.getAllByText("Preorder")).toHaveLength(2);
});

test("adds manual and preorder lines into one total per item", () => {
  render(<Plan />);
  expect(screen.getByRole("group", { name: "Syrniki" })).toHaveTextContent(/Syrniki\s*40\s*order/);
  expect(screen.getByText("28 from preorders")).toBeInTheDocument();
});

test("summarises prep tasks and shortfalls for the selected date", async () => {
  render(<Plan />);
  expect(screen.getByRole("heading", { name: "Prep for Sat 5 Dec" })).toBeInTheDocument();
  expect(screen.getByText("6 tasks")).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /farmer's cheese.*6 kg.*2\.5 kg.*3\.5 kg/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Sun 6 Dec" }));
  expect(screen.getByRole("button", { name: "Sun 6 Dec" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { name: "Prep for Sun 6 Dec" })).toBeInTheDocument();
  expect(screen.getByText("3 tasks")).toBeInTheDocument();
  expect(screen.getByText("No preorders yet")).toBeInTheDocument();
  expect(screen.queryByText("Preorder")).not.toBeInTheDocument();
  expect(screen.getByText("1 item to buy")).toBeInTheDocument();
});

test("says so when nothing is short", async () => {
  render(<Plan />);
  await userEvent.click(screen.getByRole("button", { name: "Sat 12 Dec" }));
  expect(screen.getByText(/nothing short/i)).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Syrniki" })).toHaveTextContent(/Syrniki\s*2\s*order/);
});
