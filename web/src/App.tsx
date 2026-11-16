import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Today from "./pages/Today";
import Count from "./pages/Count";
import Stock from "./pages/Stock";
import Recipes from "./pages/Recipes";
import Plan from "./pages/Plan";
import Assistant from "./pages/Assistant";
import Order from "./pages/Order";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Today />} />
        <Route path="/count" element={<Count />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/recipes" element={<Recipes />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/assistant" element={<Assistant />} />
      </Route>
      <Route path="/order" element={<Order />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
