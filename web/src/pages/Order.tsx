import { useState, type FormEvent } from "react";
import { useGuestChat, usePublicConfig } from "../api/hooks";
import { showDay, showMoney } from "../lib/format";
import "./Order.css";

interface Message {
  id: string;
  from: "host" | "guest";
  text: string;
}

const SESSION_KEY = "mise.order.session";
const MESSAGES_KEY = "mise.order.messages";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** One chat session per tab, made once. */
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

export default function Order() {
  const config = usePublicConfig();
  const chat = useGuestChat();
  const [session] = useState(sessionId);
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [text, setText] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || chat.isPending) return;
    chat.mutate(
      { sessionId: session, message },
      {
        onSuccess: (r) => {
          const next: Message[] = [...messages, { id: newId(), from: "guest", text: message }, { id: newId(), from: "host", text: r.reply }];
          setMessages(next);
          setText("");
          try {
            sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(next));
          } catch {
            // The chat just won't survive a reload.
          }
        },
      },
    );
  };

  const c = config.data;

  return (
    <main className="order">
      <header className="page-head">
        <p className="page-head__kicker">{c?.name ?? " "}</p>
        <h1>Order for pickup</h1>
        {c && <p className="page-head__sub">{showDay(c.popup.eventDate)}. Tell the assistant what you'd like and when you'll pick up.</p>}
      </header>

      {config.error && <p className="order__error" role="alert">{config.error.message}</p>}
      {!c && !config.error && <p className="page-head__sub" role="status">Loading…</p>}

      {c && (
        <section className="order__menu" aria-labelledby="order-menu-h">
          <h2 id="order-menu-h">Menu</h2>
          <ul className="order__menu-list" aria-label="Menu">
            {c.menu.map((m) => (
              <li key={m.id} className="order__menu-item">
                <span className="order__menu-name">{m.name}</span>
                <span className="order__menu-price tnum">{showMoney(m.price)}</span>
                <span className="order__menu-desc">{m.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="order__chat" role="log" aria-label="Chat">
        {c && <p className="order__msg order__msg--host">Hi, this is {c.name}. What would you like?</p>}
        {messages.map((m) => (
          <p key={m.id} className={`order__msg order__msg--${m.from}`}>{m.text}</p>
        ))}
      </div>

      <form className="order__compose" onSubmit={submit}>
        <label className="sr-only" htmlFor="order-text">Message</label>
        <input
          id="order-text"
          className="field"
          placeholder="Your order, then name and phone number"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn" disabled={chat.isPending}>Send</button>
      </form>
      {chat.error && <p className="order__error" role="alert">{chat.error.message}</p>}

      {c && (
        <p className="order__notice" role="note">
          <strong>Your data</strong>
          {c.privacyNotice}
        </p>
      )}
    </main>
  );
}
