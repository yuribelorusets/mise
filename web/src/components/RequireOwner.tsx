import { Outlet } from "react-router-dom";
import { useOwner } from "../api/hooks";
import SignIn from "../pages/SignIn";

/** Wraps the owner's routes: the sign-in screen until the server knows who's asking. */
export default function RequireOwner() {
  const owner = useOwner();
  if (owner.isPending) return <p className="page-head__sub" role="status">Loading…</p>;
  if (!owner.data) return <SignIn />;
  return <Outlet />;
}
