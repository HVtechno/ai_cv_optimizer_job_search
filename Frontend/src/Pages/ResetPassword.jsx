import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { toast } from "react-toastify";
import VeloraLogo from "../components/VeloraLogo";

/**
 * ResetPassword.jsx (NEW)
 *
 * Landing page for the link in the password-reset email:
 *   /reset-password?token=<jwt>
 *
 * Collects a new password and POSTs {token, password} to /auth/reset-password.
 * On success it sends the user back home to log in with the new password.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!token) {
      toast.error("Missing reset token. Open the link from your email again.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be 6+ chars");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }

    try {
      setSubmitting(true);
      const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const res = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (res.ok) {
        toast.success("Password updated! You can now log in.");
        setTimeout(() => navigate("/"), 1200);
      } else {
        toast.error(typeof data.detail === "string" ? data.detail : "Reset failed");
      }
    } catch (e) {
      console.error(e);
      toast.error("Server error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ marginBottom: 22, textAlign: "center" }}><VeloraLogo size={18} /></div>
        <h1 style={h1}>Choose a new password</h1>

        {!token && (
          <p style={{ ...p, color: "#FF6B6B" }}>
            This link is missing its token. Please open the reset link from your email.
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 18 }}>
          <div style={{ position: "relative" }}>
            <input type={showPassword ? "text" : "password"}
              placeholder="New password" value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ ...inputStyle, paddingRight: 44 }} />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <input type={showPassword ? "text" : "password"}
              placeholder="Confirm new password" value={confirm}
              onChange={e => setConfirm(e.target.value)}
              style={{ ...inputStyle, paddingRight: 44 }} />
          </div>

          <button onClick={handleSubmit} disabled={submitting}
            style={{ width: "100%", padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)", background: "linear-gradient(135deg,#00E87A,#00C9FF)", color: "#0C1318", border: "none", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Updating…" : "Update password"}
          </button>
        </div>

        <p style={{ ...p, textAlign: "center", marginTop: 16 }}>
          <Link to="/" style={{ color: "var(--g1)", textDecoration: "none", fontWeight: 600 }}>Back to login</Link>
        </p>
      </div>
    </div>
  );
}

const wrap = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0C1318", padding: "0 16px" };
const card = { background: "#111A21", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "40px 32px", width: "100%", maxWidth: 420, boxShadow: "0 40px 100px rgba(0,0,0,0.7)" };
const h1   = { color: "#EDF6F2", fontSize: 22, margin: "0 0 6px", fontFamily: "var(--font-display)", textAlign: "center" };
const p    = { color: "#9FB3AD", fontSize: 14, lineHeight: "22px", margin: 0, fontFamily: "var(--font-body)" };
const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 14px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.10)",
  color: "#EDF6F2",            // light text so it's visible on the dark card
  fontSize: 14,
  fontFamily: "var(--font-body)",
  outline: "none",
};
