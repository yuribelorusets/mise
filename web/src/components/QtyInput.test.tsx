import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QtyInput } from "./QtyInput";

test("steps with buttons, accepts typing, and never goes below zero", async () => {
  const changes: number[] = [];
  render(<QtyInput label="Eggs" unit="each" value={1} onChange={(v) => changes.push(v)} />);
  await userEvent.click(screen.getByRole("button", { name: /less eggs/i }));
  await userEvent.click(screen.getByRole("button", { name: /less eggs/i }));
  expect(changes.at(-1)).toBe(0);
  const box = screen.getByRole("spinbutton", { name: /eggs/i });
  await userEvent.clear(box);
  await userEvent.type(box, "36");
  expect(changes.at(-1)).toBe(36);
});

test("steps up by the given step", async () => {
  const changes: number[] = [];
  render(<QtyInput label="Butter" unit="lb" value={2} step={0.5} onChange={(v) => changes.push(v)} />);
  await userEvent.click(screen.getByRole("button", { name: /more butter/i }));
  expect(changes.at(-1)).toBe(2.5);
});
