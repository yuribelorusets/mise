import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Assistant from "./Assistant";

const cards = () => screen.getAllByRole("region", { name: "Proposal" });

test("the stale card can't be confirmed but can be discarded", async () => {
  render(<Assistant />);
  const stale = cards().find((c) => within(c).queryByText(/stock changed since this was made/i))!;
  expect(within(stale).getByRole("button", { name: "Confirm" })).toBeDisabled();
  expect(within(stale).getByRole("button", { name: "Discard" })).toBeEnabled();
  await userEvent.click(within(stale).getByRole("button", { name: "Refresh" }));
  const fresh = cards()[2];
  expect(within(fresh).queryByText(/stock changed/i)).not.toBeInTheDocument();
  expect(within(fresh).getByRole("button", { name: "Confirm" })).toBeEnabled();
});

test("editing a line's amount changes what's shown", async () => {
  render(<Assistant />);
  const open = cards()[0];
  const eggs = within(open).getByRole("listitem", { name: "Receive Eggs" });
  const amount = within(eggs).getByLabelText("Amount");
  expect(amount).toHaveValue(2);
  await userEvent.clear(amount);
  await userEvent.type(amount, "3");
  expect(amount).toHaveValue(3);
  await userEvent.click(within(open).getByRole("button", { name: "Confirm" }));
  expect(within(cards()[0]).getByText("Booked")).toBeInTheDocument();
  expect(within(cards()[0]).getByRole("listitem", { name: "Receive Eggs" })).toHaveTextContent(/3\s*case/);
});

test("a confirmed card is read-only with a done mark", () => {
  render(<Assistant />);
  const done = cards()[1];
  expect(within(done).getByText(/done/i)).toBeInTheDocument();
  expect(within(done).queryByRole("button")).not.toBeInTheDocument();
  expect(within(done).queryByRole("spinbutton")).not.toBeInTheDocument();
});

test("offers to create an unknown item", async () => {
  render(<Assistant />);
  await userEvent.click(screen.getByRole("button", { name: "Create Pickled beets" }));
  expect(within(screen.getByRole("group", { name: "New item" })).getByText(/counted in jars/)).toBeInTheDocument();
});
