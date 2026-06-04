import { useState } from "react";
import { startCheckout } from "./Billing";

/**
 * UpgradeModal — shown when a gated backend call returns the upgrade 403.
 *
 * Driven by the `info` object from billing.getUpgradeInfo(err). Pass `info`
 * (or null) and an onClose handler. When the user clicks upgrade it starts
 * Stripe checkout directly (they're already logged in if they hit a gate).
 *
 * Usage in any component that calls a gated endpoint:
 *
 *   const [upgrade, setUpgrade] = useState(null);
 *   ...
 *   try { await api.post("/resume-optimize/...") }
 *   catch (err) {
 *     const info = getUpgradeInfo(err);
 *     if (info) setUpgrade(info); else showError();
 *   }
 *   ...
 *   <UpgradeModal info={upgrade} onClose={() => setUpgrade(null)} />
 */
export default function UpgradeModal({ info, onClose }) {
  const [busy, setBusy] = useState(false);
  if (!info) return null;

  const handleUpgrade = async () => {
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
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90%", maxWidth: 420,
          background: "var(--surface, #0e1311)",
          border: "1px solid rgba(0,232,122,0.28)",
          borderRadius: 20, padding: 28,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 26, marginBottom: 8 }}>✦</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
          Upgrade to Pro
        </div>
        <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16, fontFamily: "var(--font-body)" }}>
          {info.message}
        </p>

        <div style={{ marginBottom: 20 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: "#ffffff" }}>€29</span>
          <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--font-body)" }}> / month</span>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)", cursor: "pointer", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}>
            Not now
          </button>
          <button onClick={handleUpgrade} disabled={busy}
            style={{ flex: 1.4, padding: "11px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)", cursor: busy ? "wait" : "pointer", background: "linear-gradient(135deg,var(--g1),var(--g2))", color: "var(--dark)", border: "none", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Redirecting…" : "Upgrade →"}
          </button>
        </div>
      </div>
    </div>
  );
}