import { useState, type FormEvent } from "react";
import { useSignIn } from "../api/hooks";
import "./SignIn.css";

export default function SignIn() {
  const [passcode, setPasscode] = useState("");
  const signIn = useSignIn();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (passcode) signIn.mutate(passcode);
  };

  return (
    <main className="signin">
      <header className="page-head">
        <p className="page-head__kicker">Ruki pop-up</p>
        <h1>Sign in</h1>
        <p className="page-head__sub">Kitchen screens are for the owner.</p>
      </header>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="signin-passcode">Passcode</label>
        <input
          id="signin-passcode"
          className="field"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
        />
        {signIn.error && <p className="signin__error" role="alert">{signIn.error.message}</p>}
        <button type="submit" className="btn btn--primary signin__go" disabled={signIn.isPending}>Sign in</button>
      </form>
    </main>
  );
}
