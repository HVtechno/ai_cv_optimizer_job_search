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
  const [loading, setLoading] = useState(false);

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
      setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}>
          <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }} />
          <div className="animate-iosModal" style={{ position: "relative", background: "#0C1318", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 22, padding: "36px 24px 26px", width: "100%", maxWidth: 400, boxShadow: "0 40px 100px rgba(0,0,0,0.8)" }}>
            <style>{`@keyframes authSpin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ textAlign: "center", marginBottom: 20 }}><VeloraLogo size={17} /></div>
            <button onClick={onClose} style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: 12 }}>✕</button>

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
              <button onClick={() => { if (!loading) handleSubmit(); }} disabled={loading}
                style={{ width: "100%", padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)", background: "linear-gradient(135deg,var(--g1),var(--g2))", color: "var(--dark)", border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, transition: "opacity .15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = "0.86"; }} onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = "1"; }}>
                {loading ? (
                  <>
                    <span style={{ width: 15, height: 15, border: "2px solid var(--dark)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "authSpin 0.6s linear infinite" }} />
                    {mode === "login" && "Logging in…"}
                    {mode === "signup" && "Creating account…"}
                    {mode === "forgot" && "Sending…"}
                  </>
                ) : (
                  <>
                    {mode === "login" && t.authLogin}
                    {mode === "signup" && t.authSignup}
                    {mode === "forgot" && t.authForgot}
                  </>
                )}
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