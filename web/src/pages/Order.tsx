import { useState } from "react";
import "./Order.css";

const chat = [
  { id: 1, from: "host", text: "Hi, this is Ruki. Pickup is Saturday 5 Dec. What would you like?" },
  { id: 2, from: "guest", text: "2 orders of syrniki and 1 nalysnyky please. No jam on the syrniki." },
  { id: 3, from: "host", text: "Done. Pick a pickup time below and give me a name and phone number." },
] as const;

const windows = [
  { id: "11", label: "11:00 to 12:00", note: "4 spots left", full: false },
  { id: "12", label: "12:00 to 13:00", note: "9 spots left", full: false },
  { id: "13", label: "13:00 to 14:00", note: "Full", full: true },
];

const lines = [
  { name: "Syrniki", note: "no jam", qty: 2, unit: "orders", price: 24 },
  { name: "Nalysnyky", note: "", qty: 1, unit: "order", price: 14 },
];

export default function Order() {
  const [pick, setPick] = useState("12");
  const total = lines.reduce((n, l) => n + l.price, 0);
  const window = windows.find((w) => w.id === pick)!;

  return (
    <main className="order">
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Order for pickup</h1>
        <p className="page-head__sub">Saturday 5 Dec. Pay when you collect.</p>
      </header>

      <p className="order__notice" role="note">
        <strong>Your data</strong>
        We keep your name, phone number, order notes and this chat to prepare your order, and remove them after 90 days. The owner can read them.
      </p>

      <div className="order__chat" role="log" aria-label="Chat">
        {chat.map((m) => (
          <p key={m.id} className={`order__msg order__msg--${m.from}`}>{m.text}</p>
        ))}
      </div>

      <fieldset className="order__windows">
        <legend className="sheet-label">Pickup window</legend>
        <div role="radiogroup" aria-label="Pickup window">
          {windows.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={pick === w.id}
              disabled={w.full}
              className="order__window"
              onClick={() => setPick(w.id)}
            >
              <span className="tnum">{w.label}</span>
              <span className="order__window-note">{w.note}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <section className="order__summary" aria-labelledby="order-sum-h">
        <h2 id="order-sum-h">Your order</h2>
        <p className="order__summary-meta tnum">Sat 5 Dec, {window.label}</p>
        <table className="order__table">
          <tbody>
            {lines.map((l) => (
              <tr key={l.name}>
                <th scope="row">
                  {l.name}
                  {l.note && <span className="sheet-unit"> ({l.note})</span>}
                </th>
                <td className="tnum">{l.qty} <span className="sheet-unit">{l.unit}</span></td>
                <td className="tnum">${l.price}</td>
              </tr>
            ))}
            <tr className="order__total">
              <th scope="row">Total</th>
              <td />
              <td className="tnum">${total}</td>
            </tr>
          </tbody>
        </table>
        <button type="button" className="btn btn--primary order__send">Place order</button>
      </section>

      <form className="order__compose" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor="order-text">Message</label>
        <input id="order-text" className="field" placeholder="Name and phone number" />
        <button type="submit" className="btn">Send</button>
      </form>
    </main>
  );
}
