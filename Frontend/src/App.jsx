import { Routes, Route, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Home from "./Pages/Home";
import Dashboard from "./Pages/Dashboard";
import PrivacyPage from "./Pages/PrivacyPage";
import TermsPage from "./Pages/TermsPage";
import CookiePage from "./Pages/CookiePage";
import VerifyEmail from "./Pages/VerifyEmail";
import ResetPassword from "./Pages/ResetPassword";
import DowngradeNotice from "./components/Downgradenotice";

export default function App() {
  return (
    <div>
      <ToastContainer position="top-right" autoClose={2500} />
      <AuthProvider>
        <DowngradeNotice/>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/cookies" element={<CookiePage />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </div>
  );
}
