import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { toast } from "react-toastify";
import { useAuth } from "../context/AuthContext";
import VeloraLogo from "../components/VeloraLogo";

/**
 * VerifyEmail.jsx (NEW)
 *
 * Landing page for the link in the verification email:
 *   /verify-email?token=<jwt>
 *
 * It POSTs the token to /auth/verify-email. On success the backend returns an
 * access token, so we log the user straight in and send them to the dashboard.
 * Uses the same hardcoded API base as the rest of the app so behaviour matches.
 */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState("verifying"); // verifying | success | error
  const ran = useRef(false); // guard against double-run in React strict mode

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const token = params.get("token");
    if (!token) {
      setStatus("error");
      return;
    }

    (async () => {
      try {
        const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
        const res = await fetch(`${API}/auth/verify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();

        if (res.ok && data.access_token) {
          localStorage.setItem("token", data.access_token);
          login(data.access_token);
          setStatus("success");
          toast.success("Email verified! Welcome aboard.");
          setTimeout(() => navigate("/dashboard"), 1200);
        } else {
          setStatus("error");
        }
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    })();
  }, [params, login, navigate]);

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ marginBottom: 22 }}><VeloraLogo size={18} /></div>

        {status === "verifying" && (
          <>
            <h1 style={h1}>Verifying your email…</h1>
            <p style={p}>Hang tight, this only takes a moment.</p>
          </>
        )}

        {status === "success" && (
          <>
            <h1 style={h1}>You're all set ✅</h1>
            <p style={p}>Your email is verified. Redirecting you to your dashboard…</p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 style={h1}>Link invalid or expired</h1>
            <p style={p}>
              This verification link is no longer valid. Try logging in again —
              we'll send you a fresh link automatically.
            </p>
            <Link to="/" style={btn}>Back to home</Link>
          </>
        )}
      </div>
    </div>
  );
}

const wrap = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0C1318", padding: "0 16px" };
const card = { background: "#111A21", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "40px 32px", width: "100%", maxWidth: 420, textAlign: "center", boxShadow: "0 40px 100px rgba(0,0,0,0.7)" };
const h1   = { color: "#EDF6F2", fontSize: 22, margin: "0 0 10px", fontFamily: "var(--font-display)" };
const p    = { color: "#9FB3AD", fontSize: 14, lineHeight: "22px", margin: 0, fontFamily: "var(--font-body)" };
const btn  = { display: "inline-block", marginTop: 22, background: "linear-gradient(135deg,#00E87A,#00C9FF)", color: "#0C1318", textDecoration: "none", fontWeight: 700, fontSize: 14, padding: "11px 22px", borderRadius: 10 };
