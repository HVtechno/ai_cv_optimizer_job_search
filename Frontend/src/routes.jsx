import { Routes, Route, Navigate } from "react-router-dom";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";

export default function AppRoutes() {
  const user = JSON.parse(localStorage.getItem("user"));

  return (
    <Routes>
      <Route path="/" element={user ? <Dashboard /> : <Navigate to="/auth" />} />
      <Route path="/auth" element={<Auth />} />
    </Routes>
  );
}
