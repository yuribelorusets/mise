import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCatalog, useProposals } from "../api/hooks";
import type { ProposalLine, ProposalView } from "../api/types";
import { confirmedProposal, discardedProposal, openProposal, staleProposal } from "../fixtures/assistant";
import { stockCatalog } from "../fixtures/items";
import { fakeApi, type FakeRoutes } from "../test/fake-api";
import { renderWith } from "../test/render";
import ProposalCard from "./ProposalCard";

/** The cards the way the Assistant page draws them: from the list the server sends. */
function Cards() {
  const proposals = useProposals();
  const catalog = useCatalog();
  if (!proposals.data || !catalog.data) return null;
  return <>{proposals.data.map((p) => <ProposalCard key={p.id} proposal={p} catalog={catalog.data} />)}</>;
}

function serve(list: () => ProposalView[], extra: FakeRoutes = {}, calls: string[] = []) {
  vi.stubGlobal("fetch", fakeApi({
    "GET /api/kitchen/catalog": () => stockCatalog,
    "GET /api/kitchen/proposals": list,
    ...extra,
  }, calls));
}

afterEach(() => vi.unstubAllGlobals());

test("a stale card says so, can't be confirmed, and goes back to Confirm after Refresh", async () => {
  let current = staleProposal;
  const calls: string[] = [];
  serve(() => [current], { "POST /api/kitchen/proposals/:id/refresh": () => (current = { ...staleProposal, stale: false, basedOn: 212 }) }, calls);
  renderWith(<Cards />);
  const card = await screen.findByRole("region", { name: "Proposal" });
  expect(within(card).getByText("Stale")).toBeInTheDocument();
  expect(within(card).getByText(/stock changed since this was made/i)).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Confirm" })).toBeDisabled();
  expect(within(card).getByRole("button", { name: "Discard" })).toBeEnabled();
  await userEvent.click(within(card).getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Proposal" })).queryByText(/stock changed/i)).not.toBeInTheDocument());
  expect(calls).toContain("POST /api/kitchen/proposals/p-stale/refresh");
  expect(within(screen.getByRole("region", { name: "Proposal" })).getByRole("button", { name: "Confirm" })).toBeEnabled();
});

test("Confirm sends the edited amount, then the card says Booked and can't be confirmed again", async () => {
  let current: ProposalView = openProposal;
  const sent: { lines: ProposalLine[] }[] = [];
  serve(() => [current], {
    "POST /api/kitchen/proposals/:id/confirm": (b) => {
      sent.push(b);
      current = { ...openProposal, status: "confirmed", lines: b.lines };
      return { proposal: current, events: ["e-1", "e-2", "e-3"] };
    },
  });
  renderWith(<Cards />);
  const card = await screen.findByRole("region", { name: "Proposal" });
  const amount = within(within(card).getByRole("listitem", { name: "Receive Eggs" })).getByLabelText("Amount");
  expect(amount).toHaveValue(2);
  await userEvent.clear(amount);
  await userEvent.type(amount, "3");
  await userEvent.click(within(card).getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("Booked")).toBeInTheDocument();
  expect(sent).toHaveLength(1);
  expect(sent[0].lines[0]).toMatchObject({ item: "eggs", qty: 3, unit: "case" });
  const done = screen.getByRole("region", { name: "Proposal" });
  expect(within(done).queryByRole("button")).not.toBeInTheDocument();
  expect(within(done).getByRole("listitem", { name: "Receive Eggs" })).toHaveTextContent(/3\s*case/);
});

test("a 409 on confirm refetches the proposals, and the card turns stale", async () => {
  let current: ProposalView = openProposal;
  const calls: string[] = [];
  serve(() => [current], {
    "POST /api/kitchen/proposals/:id/confirm": () => {
      current = { ...openProposal, stale: true };
      return { status: 409, error: "Stock changed since this was made. Refresh it first." };
    },
  }, calls);
  renderWith(<Cards />);
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("Stale")).toBeInTheDocument();
  expect(calls.filter((c) => c === "GET /api/kitchen/proposals").length).toBeGreaterThanOrEqual(2);
});

test("a 409 for a proposal another tab confirmed shows it as Booked", async () => {
  let current: ProposalView = openProposal;
  serve(() => [current], {
    "POST /api/kitchen/proposals/:id/confirm": () => {
      current = { ...openProposal, status: "confirmed" };
      return { status: 409, error: "That proposal is already confirmed." };
    },
  });
  renderWith(<Cards />);
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("Booked")).toBeInTheDocument();
});

test("shows a line's problem under it and keeps Confirm off until the line is changed", async () => {
  serve(() => [{ ...openProposal, problems: [null, "Butter can't be measured in tubs.", null] }]);
  renderWith(<Cards />);
  const card = await screen.findByRole("region", { name: "Proposal" });
  const butter = within(card).getByRole("listitem", { name: "Receive Butter" });
  expect(within(butter).getByText("Butter can't be measured in tubs.")).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Confirm" })).toBeDisabled();
  await userEvent.selectOptions(within(butter).getByLabelText("Unit"), "lb");
  expect(within(card).getByRole("button", { name: "Confirm" })).toBeEnabled();
});

test("a 422 on confirm shows the problems the server sent", async () => {
  serve(() => [openProposal], {
    "POST /api/kitchen/proposals/:id/confirm": () => ({ status: 422, error: "Check the lines.", problems: [null, null, "There's no sour cream in the walk-in."] }),
  });
  renderWith(<Cards />);
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("There's no sour cream in the walk-in.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
});

test("a confirmed card is read-only with a done mark", async () => {
  serve(() => [confirmedProposal]);
  renderWith(<Cards />);
  const done = await screen.findByRole("region", { name: "Proposal" });
  expect(within(done).getByText(/done/i)).toBeInTheDocument();
  expect(within(done).queryByRole("button")).not.toBeInTheDocument();
  expect(within(done).queryByRole("spinbutton")).not.toBeInTheDocument();
});

test("a discarded proposal is a one-line stub with its lines behind a disclosure", async () => {
  serve(() => [discardedProposal]);
  renderWith(<Cards />);
  const stub = await screen.findByText("Discarded · 2 lines");
  const details = stub.closest("details")!;
  expect(details).not.toHaveAttribute("open");
  expect(within(details).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  await userEvent.click(stub);
  expect(details).toHaveAttribute("open");
  expect(within(details).getByRole("listitem", { name: "Use Flour" })).toBeInTheDocument();
});

test("after a 409 turns the card stale, Refresh clears the old error and Confirm works again", async () => {
  let current: ProposalView = openProposal;
  serve(() => [current], {
    "POST /api/kitchen/proposals/:id/confirm": () => {
      current = { ...openProposal, stale: true, basedOn: 200 };
      return { status: 409, error: "Stock changed since this was made. Refresh it first." };
    },
    "POST /api/kitchen/proposals/:id/refresh": () => (current = { ...openProposal, stale: false, basedOn: 213 }),
  });
  renderWith(<Cards />);
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  await userEvent.click(await screen.findByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByText("Stale")).not.toBeInTheDocument());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
});

test("a stale card shows one message, not the status line and the 409 text", async () => {
  let current: ProposalView = openProposal;
  serve(() => [current], {
    "POST /api/kitchen/proposals/:id/confirm": () => {
      current = { ...openProposal, stale: true };
      return { status: 409, error: "Stock changed since this was made. Refresh it first." };
    },
  });
  renderWith(<Cards />);
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  expect(await screen.findByText(/before booking/i)).toBeInTheDocument();
  expect(screen.queryByText(/refresh it first/i)).not.toBeInTheDocument();
});

test("a 422's problems are dropped once the card is refreshed", async () => {
  let current: ProposalView = openProposal;
  serve(() => [current], {
    "POST /api/kitchen/proposals/:id/confirm": () => {
      current = { ...openProposal, stale: true, basedOn: 200 };
      return { status: 422, error: "Check.", problems: [null, "Old problem.", null] };
    },
    "POST /api/kitchen/proposals/:id/refresh": () => (current = { ...openProposal, basedOn: 213 }),
  });
  renderWith(<Cards />);
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  await userEvent.click(await screen.findByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByText("Old problem.")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
});

test("a 404 on confirm refetches the proposals, and the card goes with the server's list", async () => {
  let list: ProposalView[] = [openProposal];
  serve(() => list, {
    "POST /api/kitchen/proposals/:id/confirm": () => {
      list = [];
      return { status: 404, error: "There's no proposal with that id." };
    },
  });
  renderWith(<Cards />);
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Proposal" })).not.toBeInTheDocument());
});
