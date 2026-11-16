import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Today from "./Today";

vi.mock("../fixtures/ruki", async (orig) => {
  const real = await orig<typeof import("../fixtures/ruki")>();
  return { ...real, shortfalls: [{ item: "mystery-flour", need: 10, have: 2, buy: 8 }] };
});

test("an unknown item in the shortfalls falls back to its id and does not crash", () => {
  render(<MemoryRouter><Today /></MemoryRouter>);
  expect(screen.getByRole("rowheader", { name: /mystery-flour/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /short/i })).toBeInTheDocument();
});
