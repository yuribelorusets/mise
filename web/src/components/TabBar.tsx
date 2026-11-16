import { NavLink } from "react-router-dom";
import "./TabBar.css";

const TABS = [
  { to: "/", label: "Today" },
  { to: "/count", label: "Count" },
  { to: "/stock", label: "Stock" },
  { to: "/recipes", label: "Recipes" },
  { to: "/plan", label: "Plan" },
];

export default function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end className="tabbar__tab">
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
