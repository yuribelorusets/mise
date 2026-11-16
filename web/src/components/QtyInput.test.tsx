import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QtyInput } from "./QtyInput";

test("steps down with the button and accepts typing", async () => {
  const changes: number[] = [];
  render(<QtyInput label="Eggs" unit="each" value={1} onChange={(v) => changes.push(v)} />);
  await userEvent.click(screen.getByRole("button", { name: /less eggs/i }));
  expect(changes.at(-1)).toBe(0);
  const box = screen.getByRole("spinbutton", { name: /eggs/i });
  await userEvent.clear(box);
  await userEvent.type(box, "36");
  expect(changes.at(-1)).toBe(36);
});

test("never steps below zero", async () => {
  const changes: number[] = [];
  render(<QtyInput label="Eggs" unit="each" value={0} onChange={(v) => changes.push(v)} />);
  await userEvent.click(screen.getByRole("button", { name: /less eggs/i }));
  expect(changes.every((v) => v >= 0)).toBe(true);
  expect(changes.at(-1) ?? 0).toBe(0);
});

test("steps up by the given step", async () => {
  const changes: number[] = [];
  render(<QtyInput label="Butter" unit="lb" value={2} step={0.5} onChange={(v) => changes.push(v)} />);
  await userEvent.click(screen.getByRole("button", { name: /more butter/i }));
  expect(changes.at(-1)).toBe(2.5);
});

test("empty input does not call onChange", async () => {
  const changes: number[] = [];
  render(<QtyInput label="Eggs" unit="each" value={5} onChange={(v) => changes.push(v)} />);
  await userEvent.clear(screen.getByRole("spinbutton", { name: /eggs/i }));
  expect(changes).toEqual([]);
});

test("negative input does not call onChange", async () => {
  const changes: number[] = [];
  render(<QtyInput label="Eggs" unit="each" value={5} onChange={(v) => changes.push(v)} />);
  const box = screen.getByRole("spinbutton", { name: /eggs/i });
  await userEvent.clear(box);
  await userEvent.type(box, "-3");
  expect(changes).toEqual([]);
});

test("the box resets to the current value on blur", async () => {
  render(<QtyInput label="Eggs" unit="each" value={5} onChange={() => {}} />);
  const box = screen.getByRole("spinbutton", { name: /eggs/i });
  await userEvent.clear(box);
  await userEvent.tab();
  expect(box).toHaveValue(5);
});
