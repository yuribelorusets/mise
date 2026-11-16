import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "../App";
import { publicConfig } from "../fixtures/config";
import { fakeApi, type FakeRoutes } from "../test/fake-api";
import { renderWith } from "../test/render";
import Order from "./Order";

function serve(extra: FakeRoutes = {}) {
  vi.stubGlobal("fetch", fakeApi({ "GET /api/config": () => publicConfig, ...extra }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const send = async (text: string) => {
  await userEvent.type(await screen.findByLabelText("Message"), text);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
};

test("shows the menu from the server with each item's price", async () => {
  serve();
  renderWith(<Order />);
  const menu = await screen.findByRole("list", { name: "Menu" });
  expect(menu).toHaveTextContent("Babushka's Syrniki");
  expect(menu).toHaveTextContent("$12.00");
  expect(menu).toHaveTextContent("$14.50");
  expect(screen.getByRole("heading", { level: 1, name: /order for pickup/i })).toBeInTheDocument();
  expect(screen.getByText(/Sat 5 Dec/)).toBeInTheDocument();
});

test("shows the privacy notice word for word, under the chat box", async () => {
  serve();
  renderWith(<Order />);
  const notice = await screen.findByText(publicConfig.privacyNotice);
  const box = screen.getByLabelText("Message");
  expect(box.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("sends a message with one session id per tab and shows the reply", async () => {
  const sent: { sessionId: string; message: string }[] = [];
  serve({ "POST /api/chat": (b) => (sent.push(b), { reply: `Got it: ${b.message}` }) });
  renderWith(<Order />);
  await send("2 syrniki please");
  expect(await screen.findByText("Got it: 2 syrniki please")).toBeInTheDocument();
  expect(screen.getByText("2 syrniki please")).toBeInTheDocument();
  expect(screen.getByLabelText("Message")).toHaveValue("");
  await send("Anya 555 0100");
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[0].sessionId).toMatch(/\S{8,}/);
  expect(sent[1].sessionId).toBe(sent[0].sessionId);
});

test("a 429 shows the server's message and keeps what was typed", async () => {
  serve({ "POST /api/chat": () => ({ status: 429, error: "You're sending messages too fast. Try again in a minute." }) });
  renderWith(<Order />);
  await send("hello");
  expect(await screen.findByRole("alert")).toHaveTextContent("You're sending messages too fast. Try again in a minute.");
  expect(screen.getByLabelText("Message")).toHaveValue("hello");
});

test("has no tab bar or navigation, and doesn't ask to sign in", async () => {
  serve({ "GET /api/owner/me": () => ({ status: 401 }) });
  renderWith(<AppRoutes />, { path: "/order" });
  expect(await screen.findByRole("list", { name: "Menu" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/passcode/i)).not.toBeInTheDocument();
});
