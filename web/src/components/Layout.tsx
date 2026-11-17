import { Link, Outlet, useLocation } from "react-router-dom";
import TabBar from "./TabBar";
import "./Layout.css";

export default function Layout() {
  const onAssistant = useLocation().pathname === "/assistant";
  return (
    <div className="layout">
      <main className="layout__page">
        <Outlet />
      </main>
      {!onAssistant && (
        <Link to="/assistant" className="layout__assistant">
          Ask the assistant
        </Link>
      )}
      <TabBar />
    </div>
  );
}
