import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../App";
import { fakeApi } from "../test/fake-api";
import { ApiError, apiGet } from "./client";
import { makeQueryClient } from "./query-client";
import { keys } from "./keys";
import { useConfirmProposal, useOwner } from "./hooks";

const todayView = { date: "2026-12-05", plan: null, prep: [], shopping: [], preorders: [] };
const confirmResult = { proposal: { id: "p-1", status: "confirmed", lines: [], stale: false, problems: [] }, events: [] };
const publicConfig = { name: "Syrniki Pop-up", menu: [], privacyNotice: "We keep it.", popup: { pickupWindows: [] } };

afterEach(() => vi.unstubAllGlobals());

test("shows sign-in until the passcode is right, then the screen", async () => {
  let signedIn = false;
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/owner/me": () => (signedIn ? { owner: true } : { status: 401, error: "Sign in first." }),
    "POST /api/owner/sign-in": (body) => ((signedIn = body.passcode === "syrniki-2026") ? { status: 204 } : { status: 401, error: "That passcode isn't right." }),
    "GET /api/kitchen/today": () => todayView,
    "GET /api/kitchen/catalog": () => ({ items: [], locations: [], recipes: [], plans: [] }),
  }));
  render(<QueryClientProvider client={makeQueryClient()}><MemoryRouter initialEntries={["/"]}><AppRoutes /></MemoryRouter></QueryClientProvider>);
  await userEvent.type(await screen.findByLabelText(/passcode/i), "wrong-one-x{Enter}");
  expect(await screen.findByText("That passcode isn't right.")).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText(/passcode/i));
  await userEvent.type(screen.getByLabelText(/passcode/i), "syrniki-2026{Enter}");
  expect(await screen.findByRole("heading", { level: 1, name: /today/i })).toBeInTheDocument();
});

test("a 429 on sign-in shows the server's message", async () => {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/owner/me": () => ({ status: 401 }),
    "POST /api/owner/sign-in": () => ({ status: 429, error: "Too many wrong passcodes. Try again later." }),
  }));
  render(<QueryClientProvider client={makeQueryClient()}><MemoryRouter><AppRoutes /></MemoryRouter></QueryClientProvider>);
  await userEvent.type(await screen.findByLabelText(/passcode/i), "whatever-1{Enter}");
  expect(await screen.findByText("Too many wrong passcodes. Try again later.")).toBeInTheDocument();
});

test("a 401 from any owner route marks the owner as signed out", async () => {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/owner/me": () => ({ owner: true }),
    "GET /api/kitchen/today": () => ({ status: 401, error: "Sign in first." }),
  }));
  const qc = makeQueryClient();
  function Probe() {
    const owner = useOwner();
    return <p>{owner.data === undefined ? "loading" : owner.data ? "in" : "out"}</p>;
  }
  render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>);
  expect(await screen.findByText("in")).toBeInTheDocument();
  await qc.fetchQuery({ queryKey: keys.today, queryFn: () => apiGet("/api/kitchen/today"), retry: false }).catch((e) => expect(e).toBeInstanceOf(ApiError));
  expect(await screen.findByText("out")).toBeInTheDocument();
});

test("a confirm refetches stock, today and proposals, but not the catalog", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", fakeApi({ "POST /api/kitchen/proposals/p-1/confirm": () => confirmResult }, calls));
  const qc = makeQueryClient();
  for (const k of [keys.catalog, keys.stock, keys.today, keys.proposals]) qc.setQueryData(k, {});
  const spy = vi.spyOn(qc, "invalidateQueries");
  function Confirm() {
    const confirm = useConfirmProposal();
    return <button onClick={() => confirm.mutate({ id: "p-1" })}>go</button>;
  }
  render(<QueryClientProvider client={qc}><Confirm /></QueryClientProvider>);
  await userEvent.click(screen.getByText("go"));
  await waitFor(() => expect(spy).toHaveBeenCalled());
  const invalidated = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
  expect(invalidated).toEqual(expect.arrayContaining([JSON.stringify(keys.stock), JSON.stringify(keys.today), JSON.stringify(keys.proposals)]));
  expect(invalidated).not.toContain(JSON.stringify(keys.catalog));
  expect(calls).toContain("POST /api/kitchen/proposals/p-1/confirm");
});

test("/order doesn't ask the guest to sign in", async () => {
  vi.stubGlobal("fetch", fakeApi({ "GET /api/owner/me": () => ({ status: 401 }), "GET /api/config": () => publicConfig }));
  render(<QueryClientProvider client={makeQueryClient()}><MemoryRouter initialEntries={["/order"]}><AppRoutes /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole("heading", { level: 1, name: /order for pickup/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(/passcode/i)).not.toBeInTheDocument();
});
