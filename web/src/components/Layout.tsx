import { Link, Outlet } from "react-router-dom";
import TabBar from "./TabBar";
import "./Layout.css";

export default function Layout() {
  return (
    <div className="layout">
      <main className="layout__page">
        <Outlet />
      </main>
      <Link to="/assistant" className="layout__assistant">
        Ask the assistant
      </Link>
      <TabBar />
    </div>
  );
}
