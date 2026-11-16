import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Stock from "./Stock";

test("lists stock under each location with amount and age", () => {
  render(<Stock />);
  for (const name of ["Walk-in", "Dry store", "Freezer"]) expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
  const cheese = screen.getByRole("button", { name: /farmer's cheese/i });
  expect(cheese).toHaveTextContent("2.5");
  expect(cheese).toHaveTextContent("kg");
  expect(cheese).toHaveTextContent("received 3 days ago");
});

test("shows a negative amount and flags it", () => {
  render(<Stock />);
  const jam = screen.getByRole("button", { name: /jam/i });
  expect(jam).toHaveTextContent("−200");
  expect(within(jam).getByText("Negative")).toBeInTheDocument();
});

test("flags expired, near-expiry and below-par items", () => {
  render(<Stock />);
  expect(within(screen.getByRole("button", { name: /whole milk/i })).getByText("Expired")).toBeInTheDocument();
  const sourCream = screen.getByRole("button", { name: /sour cream/i });
  expect(within(sourCream).getByText("Expires in 1 day")).toBeInTheDocument();
  expect(within(sourCream).getByText("Below par")).toBeInTheDocument();
  expect(within(screen.getByRole("button", { name: /butter/i })).queryByText(/par|expire/i)).not.toBeInTheDocument();
});

test("tapping an item opens its history with time, amount and source", async () => {
  render(<Stock />);
  expect(screen.queryByRole("table", { name: /eggs history/i })).not.toBeInTheDocument();
  const eggs = screen.getByRole("button", { name: /eggs/i });
  await userEvent.click(eggs);
  expect(eggs).toHaveAttribute("aria-expanded", "true");
  const rows = within(screen.getByRole("table", { name: /eggs history/i })).getAllByRole("row").slice(1);
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringMatching(/Count.*Wed 2 Dec, 16:00.*manual.*=60/),
    expect.stringMatching(/Use.*Sat 28 Nov, 06:50.*production.*−96/),
    expect.stringMatching(/Receive.*Tue 24 Nov, 08:15.*receipt.*\+180/),
  ]);
  await userEvent.click(eggs);
  expect(screen.queryByRole("table", { name: /eggs history/i })).not.toBeInTheDocument();
});

test("a move shows on both sides", async () => {
  render(<Stock />);
  const freezer = screen.getByRole("region", { name: "Freezer" });
  await userEvent.click(within(freezer).getByRole("button", { name: /syrniki/i }));
  expect(screen.getByRole("table", { name: /syrniki history/i })).toHaveTextContent(/Move from Walk-in.*\+12/);
});
