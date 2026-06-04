import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "react-toastify";
import { useAuth } from "../context/AuthContext";
import VeloraLogo from "./VeloraLogo";

export default function AuthModal({ show, onClose, t }) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [mode, setMode] = useState("login");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [shake, setShake] = useState(false);

  const validateEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleSubmit = async () => {
    try {
      if (!validateEmail(email)) {
        setEmailError("Invalid email");
        setShake(true);
        setTimeout(() => setShake(false), 400);
        toast.error("Please enter a valid email");
        return;
      }
      if (mode !== "forgot" && password.length < 6) {
        toast.error("Password must be 6+ chars");
        return;
      }

      const endpoint = mode === "signup" ? "signup" : mode === "login" ? "login" : "forgot-password";
      const payload = mode === "forgot" ? { email } : { email, password };

      const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const res = await fetch(`${API}/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.detail === "USER_NOT_FOUND") {
          setMode("signup");
          setEmailError("User not found → Please sign up");
          toast.info("User not found. Switching to signup...");
          return;
        }
        // Account exists but hasn't confirmed their email yet. The backend has
        // already (re)sent a fresh verification link, so just tell them to check.
        if (data.detail === "EMAIL_NOT_VERIFIED") {
          toast.info("Please verify your email. We just sent you a new link.");
          setEmailError("Email not verified — check your inbox for the link.");
          return;
        }
        // Verification email couldn't be sent (mail server issue). The backend
        // rolled back so no half-created account is left behind — user can retry.
        if (data.detail === "EMAIL_SEND_FAILED") {
          toast.error("We couldn't send the verification email. Please try again in a moment.");
          setEmailError("Couldn't send verification email — please try again.");
          return;
        }
        toast.error(typeof data.detail === "string" ? data.detail : "Something went wrong");
        return;
      }

      if (mode === "signup") {
        // Login is blocked until the email is verified, so we do NOT auto-login.
        // We surface the "check your email" state instead.
        toast.success("Account created! Check your email to verify, then log in.");
        setEmailError("Verification link sent — check your inbox.");
        setMode("login");
        setPassword("");
        return;
      }

      if (mode === "login" && data.access_token) {
        localStorage.setItem("token", data.access_token);
        login(data.access_token);
        onClose();
        navigate("/dashboard");
        toast.success("Login successful!");
        return;
      }

      if (mode === "forgot") {
        // Anti-enumeration: backend always returns 200 with a generic message.
        toast.success("If that email is registered, a reset link is on its way.");
        setMode("login");
      }
    } catch (err) {
      console.error(err);
      toast.error("Server error. Please try again.");
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}>
          <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }} />
          <div className="animate-iosModal" style={{ position: "relative", background: "#0C1318", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 22, padding: "36px 24px 26px", width: "100%", maxWidth: 400, boxShadow: "0 40px 100px rgba(0,0,0,0.8)" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}><VeloraLogo size={17} /></div>
            <button onClick={onClose} style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: 12 }}>✕</button>

            {mode !== "forgot" && (
              <>
                <button style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "10px 0", borderRadius: 10, border: "1px solid rgba(255,255,255,0.11)", background: "transparent", color: "rgba(237,246,242,0.65)", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-body)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  {t.authGoogle}
                </button>
                <div style={{ display: "flex", alignItems: "center", margin: "14px 0" }}>
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
                  <span style={{ padding: "0 12px", fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-body)" }}>{t.authOr}</span>
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
                </div>
              </>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {mode !== "forgot" && (
                <div className={shake ? "animate-shake" : ""}>
                  <input className="auth-input" type="email" placeholder={t.authEmail} value={email}
                    onChange={e => { setEmail(e.target.value); setEmailError(!validateEmail(e.target.value) ? "Enter a valid email address" : ""); }} />
                </div>
              )}
              {emailError && <p style={{ color: "#FF6B6B", fontSize: 12, fontFamily: "var(--font-body)" }}>{emailError}</p>}
              {mode !== "forgot" && (
                <div style={{ position: "relative" }}>
                  <input className="auth-input" type={showPassword ? "text" : "password"} placeholder={t.authPassword}
                    value={password} onChange={e => setPassword(e.target.value)} style={{ paddingRight: 42 }} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              )}
              {mode === "forgot" && <input className="auth-input" type="email" placeholder={t.authForgotEmail} value={email}
                onChange={e => { setEmail(e.target.value); setEmailError(!validateEmail(e.target.value) ? "Enter a valid email address" : ""); }} />}
              <button onClick={handleSubmit}
                style={{ width: "100%", padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)", background: "linear-gradient(135deg,var(--g1),var(--g2))", color: "var(--dark)", border: "none", cursor: "pointer", transition: "opacity .15s" }}
                onMouseEnter={e => e.target.style.opacity = "0.86"} onMouseLeave={e => e.target.style.opacity = "1"}>
                {mode === "login" && t.authLogin}
                {mode === "signup" && t.authSignup}
                {mode === "forgot" && t.authForgot}
              </button>
            </div>

            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.38)", marginTop: 14, textAlign: "center", fontFamily: "var(--font-body)" }}>
              {mode === "login" && (
                <>
                  <p onClick={() => setMode("forgot")} style={{ cursor: "pointer", marginBottom: 6 }}>{t.authForgotLink}</p>
                  <p>{t.authNoAccount} <span onClick={() => setMode("signup")} style={{ color: "var(--g1)", cursor: "pointer", fontWeight: 600 }}>{t.authSignupLink}</span></p>
                </>
              )}
              {mode === "signup" && <p>{t.authHaveAccount} <span onClick={() => setMode("login")} style={{ color: "var(--g1)", cursor: "pointer", fontWeight: 600 }}>{t.authLoginLink}</span></p>}
              {mode === "forgot" && <p onClick={() => setMode("login")} style={{ color: "var(--g1)", cursor: "pointer", fontWeight: 600 }}>{t.authBack}</p>}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
