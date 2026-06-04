import { useAuth } from "../context/AuthContext";
import { startCheckout } from "./Billing";
import { useState } from "react";

/**
 * DowngradeNotice — a friendly popup shown once when a user's paid subscription
 * has ended and they've been moved back to the Free tier. Detection lives in
 * AuthContext (justDowngraded); this just renders + offers a resubscribe button.
 *
 * Mount it once near the app root (e.g. in App.jsx) so it can appear on any page.
 */
export default function DowngradeNotice() {
  const { justDowngraded, clearDowngradeNotice } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!justDowngraded) return null;

  const resubscribe = async () => {
    try {
      setBusy(true);
      await startCheckout("monthly");
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  };

  return (
    <div
      onClick={clearDowngradeNotice}
      style={{
        position: "fixed", inset: 0, zIndex: 90,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90%", maxWidth: 440,
          background: "#0e1311",
          border: "1px solid rgba(0,232,122,0.28)",
          borderRadius: 20, padding: 30, textAlign: "center",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 34, marginBottom: 10 }}>👋</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "#ffffff", marginBottom: 10 }}>
          You're now on the Free plan
        </div>
        <p style={{ fontSize: 13.5, color: "#c7d0cc", lineHeight: 1.7, marginBottom: 22, fontFamily: "var(--font-body)" }}>
          Your Pro subscription has ended, so your account moved to the Free tier.
          Your data is safe. Subscribe again anytime to unlock unlimited refreshes,
          more optimizations, and the full ATS breakdown — and pick up right where
          you left off.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={clearDowngradeNotice}
            style={{
              flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer",
              fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)",
              background: "transparent", color: "#c7d0cc", border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            Maybe later
          </button>
          <button
            onClick={resubscribe}
            disabled={busy}
            style={{
              flex: 1.5, padding: "12px 0", borderRadius: 10,
              cursor: busy ? "wait" : "pointer",
              fontSize: 13, fontWeight: 800, fontFamily: "var(--font-body)",
              background: "linear-gradient(135deg,var(--g1),var(--g2))",
              color: "#ffffff", border: "none", opacity: busy ? 0.7 : 1,
              textShadow: "0 1px 2px rgba(0,0,0,0.35)",
            }}
          >
            {busy ? "Redirecting…" : "Subscribe to Pro →"}
          </button>
        </div>
      </div>
    </div>
  );
}