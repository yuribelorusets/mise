import { useState, type FormEvent } from "react";
import { useAddItem, useAssistantTurn, useCatalog, useProposals } from "../api/hooks";
import type { NewItemOffer, ProposalView } from "../api/types";
import ProposalCard from "../components/ProposalCard";
import "./Assistant.css";

type Message =
  | { id: string; from: "owner"; text: string }
  | { id: string; from: "assistant"; text: string; proposals: ProposalView[]; offers: NewItemOffer[] };

const SESSION_KEY = "mise.assistant.session";
const MESSAGES_KEY = "mise.assistant.messages";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** One conversation per tab: the id and the messages live in sessionStorage, not in the browser's long-term storage. */
function sessionId(): string {
  try {
    const kept = sessionStorage.getItem(SESSION_KEY);
    if (kept) return kept;
    const made = newId();
    sessionStorage.setItem(SESSION_KEY, made);
    return made;
  } catch {
    return newId();
  }
}

function loadMessages(): Message[] {
  try {
    return JSON.parse(sessionStorage.getItem(MESSAGES_KEY) ?? "[]") as Message[];
  } catch {
    return [];
  }
}

function Offer({ offer }: { offer: NewItemOffer }) {
  const save = useAddItem();
  const [state, setState] = useState<"added" | "skipped">();
  return (
    <div className="chat__create" role="group" aria-label="New item">
      {state === "added" ? (
        <p>
          <span className="tag">&#10003; Added</span> {offer.name}, counted in {offer.baseUnit}. Repeat the change so it goes on a card.
        </p>
      ) : state === "skipped" ? (
        <p className="muted">Left it off the list.</p>
      ) : (
        <>
          <p><strong>{offer.name}</strong> <span className="muted">new item, unit: {offer.baseUnit}</span></p>
          {save.error && <p role="alert">{save.error.message}</p>}
          <div className="chat__create-actions">
            <button type="button" className="btn" onClick={() => setState("skipped")}>Not now</button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={save.isPending}
              onClick={() => save.mutate({ name: offer.name, baseUnit: offer.baseUnit }, { onSuccess: () => setState("added") })}
            >
              Add {offer.name} ({offer.baseUnit})
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Assistant() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [text, setText] = useState("");
  const [session] = useState(sessionId);
  const turn = useAssistantTurn();
  const proposals = useProposals();
  const catalog = useCatalog();

  const live = new Map((proposals.data ?? []).map((p) => [p.id, p]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || turn.isPending) return;
    turn.mutate(
      { sessionId: session, message },
      {
        onSuccess: (reply) => {
          const next: Message[] = [
            ...messages,
            { id: newId(), from: "owner", text: message },
            { id: newId(), from: "assistant", text: reply.reply, proposals: reply.proposals, offers: reply.offers },
          ];
          setMessages(next);
          setText("");
          try {
            sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(next));
          } catch {
            // The conversation just won't survive a reload.
          }
        },
      },
    );
  };

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
            {m.from === "assistant" && catalog.data &&
              m.proposals.map((p) => <ProposalCard key={p.id} proposal={live.get(p.id) ?? p} catalog={catalog.data} />)}
            {m.from === "assistant" && m.offers.map((o, i) => <Offer key={i} offer={o} />)}
          </div>
        ))}
      </div>

      <form className="chat__compose" onSubmit={submit}>
        <label className="sr-only" htmlFor="assistant-text">Message</label>
        <input
          id="assistant-text"
          className="field"
          placeholder="2 cases eggs in the walk-in"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={turn.isPending}>Send</button>
      </form>
      {turn.error && <p className="chat__error" role="alert">{turn.error.message}</p>}
    </>
  );
}
