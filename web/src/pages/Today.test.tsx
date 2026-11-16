import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Today from "./Today";

test("shows the prep list and what's short", () => {
  render(<MemoryRouter><Today /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: /prep/i })).toBeInTheDocument();
  expect(screen.getByText(/syrniki batter/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /short/i })).toBeInTheDocument();
});

test("checking a prep row keeps it on the list", async () => {
  render(<MemoryRouter><Today /></MemoryRouter>);
  const box = screen.getByRole("checkbox", { name: /syrniki batter/i });
  expect(box).not.toBeChecked();
  await userEvent.click(box);
  expect(box).toBeChecked();
  expect(screen.getByText(/syrniki batter/i)).toBeInTheDocument();
});

test("lists preorders by pickup window", () => {
  render(<MemoryRouter><Today /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: /preorders/i })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem", { name: /preorder/i }).length).toBe(6);
});
