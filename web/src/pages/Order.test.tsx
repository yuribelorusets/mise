import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../App";
import Order from "./Order";

test("shows the privacy notice", () => {
  render(<Order />);
  expect(
    screen.getByText(
      "We keep your name, phone number, order notes and this chat to prepare your order, and remove them after 90 days. The owner can read them.",
      { exact: false },
    ),
  ).toBeInTheDocument();
});

test("has no tab bar or navigation", () => {
  render(
    <MemoryRouter initialEntries={["/order"]}>
      <AppRoutes />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("picks a pickup window and the summary follows; full windows can't be picked", async () => {
  render(<Order />);
  await userEvent.click(screen.getByRole("radio", { name: /11:00 to 12:00/ }));
  expect(screen.getByText(/Sat 5 Dec, 11:00 to 12:00/)).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /13:00 to 14:00/ })).toBeDisabled();
});
