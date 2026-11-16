import { useState } from "react";
import ProposalCard from "../components/ProposalCard";
import { conversation, EVENT_COUNT, type Message, type Proposal } from "../fixtures/assistant";
import "./Assistant.css";

export default function Assistant() {
  const [messages, setMessages] = useState<Message[]>(conversation);
  const [creates, setCreates] = useState<Record<string, "added" | "skipped">>({});

  const patch = (id: string, change: Partial<Proposal>) =>
    setMessages((ms) =>
      ms.map((m) => (m.from === "assistant" && m.proposal?.id === id ? { ...m, proposal: { ...m.proposal, ...change } } : m)),
    );

  return (
    <>
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Assistant</h1>
        <p className="page-head__sub">Tell it what came in or went out. Nothing is booked until you confirm.</p>
      </header>

      <div className="chat" role="log" aria-label="Conversation">
        {messages.map((m) => (
          <div key={m.id} className={`chat__msg chat__msg--${m.from}`}>
            <span className="chat__who">{m.from === "owner" ? "You" : "Mise"}</span>
            <p className="chat__bubble">{m.text}</p>
            {m.from === "assistant" && m.proposal && (
              <ProposalCard
                key={`${m.proposal.id}-${m.proposal.basedOn}`}
                proposal={m.proposal}
                events={EVENT_COUNT}
                onConfirm={() => patch(m.proposal!.id, { status: "confirmed" })}
                onDiscard={() => patch(m.proposal!.id, { status: "discarded" })}
                onRefresh={() => patch(m.proposal!.id, { basedOn: EVENT_COUNT })}
              />
            )}
            {m.from === "assistant" && m.create && (
              <div className="chat__create" role="group" aria-label="New item">
                {creates[m.id] === "added" ? (
                  <p><span className="tag">&#10003; Added</span> {m.create.name}, counted in {m.create.unit}s.</p>
                ) : creates[m.id] === "skipped" ? (
                  <p className="muted">Left it off the list.</p>
                ) : (
                  <>
                    <p><strong>{m.create.name}</strong> <span className="muted">new item, unit: {m.create.unit}</span></p>
                    <div className="chat__create-actions">
                      <button type="button" className="btn" onClick={() => setCreates({ ...creates, [m.id]: "skipped" })}>Not now</button>
                      <button type="button" className="btn btn--primary" onClick={() => setCreates({ ...creates, [m.id]: "added" })}>
                        Create {m.create.name}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form className="chat__compose" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor="assistant-text">Message</label>
        <input id="assistant-text" className="field" placeholder="2 cases eggs in the walk-in" />
        <button type="submit" className="btn btn--primary">Send</button>
      </form>
    </>
  );
}
