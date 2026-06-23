import { useState } from "react";
import { startPolarCheckout } from "./polar";

/**
 * UpgradeModal — shown when a gated backend call returns the upgrade 403.
 *
 * PAYMENT PROVIDER: Polar (Merchant of Record).
 *   Clicking "Upgrade to Pro" starts a Polar checkout and redirects the browser
 *   to Polar's hosted payment page (cards, iDEAL, etc.). Polar handles VAT/tax
 *   and, via a signed webhook to our backend, grants Pro automatically — no
 *   manual approval. Subscriptions auto-renew.
 *
 *   The previous manual-iDEAL panel (IdealPanel) and the Stripe wrappers in
 *   Billing.jsx are left intact in the repo but are no longer used here.
 *
 * Driven by the `info` object from billing.getUpgradeInfo(err). Pass `info`
 * (or null) and an onClose handler.
 */
export default function UpgradeModal({ info, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  if (!info) return null;

  const upgrade = async () => {
    setErr("");
    setBusy(true);
    try {
      await startPolarCheckout();   // redirects the browser to Polar on success
    } catch (e) {
      const msg = e?.response?.data?.detail;
      setErr(typeof msg === "string" ? msg : "Could not start checkout. Please try again.");
      setBusy(false);
    }
  };

  const card = {
    width: "100%", maxWidth: 460,
    background: "var(--surface, #0e1311)",
    border: "1px solid rgba(0,232,122,0.28)",
    borderRadius: 18, padding: 24, fontFamily: "var(--font-body)",
  };
  const primaryBtn = {
    display: "block", width: "100%", textAlign: "center",
    padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 700,
    cursor: busy ? "wait" : "pointer", textDecoration: "none",
    background: "linear-gradient(135deg,var(--g1),var(--g2))", color: "var(--dark)",
    border: "none", opacity: busy ? 0.7 : 1,
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
          width: "90%", maxWidth: 460,
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={card}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700,
            color: "var(--text)", marginBottom: 6,
          }}>
            Upgrade to Pro
          </div>

          {info.message && (
            <p style={{
              fontSize: 13.5, color: "var(--muted)", lineHeight: 1.7,
              marginBottom: 16, fontFamily: "var(--font-body)",
            }}>
              {info.message}
            </p>
          )}

          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16 }}>
            You'll be taken to our secure checkout to complete payment. Your Pro
            access activates automatically once payment is confirmed, and renews
            each month — cancel anytime.
          </p>

          {err && (
            <p style={{ fontSize: 13, color: "#ff6b6b", marginBottom: 12 }}>
              {err}
            </p>
          )}

          <button onClick={upgrade} disabled={busy} style={primaryBtn}>
            {busy ? "Starting checkout…" : "Upgrade to Pro"}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button onClick={onClose}
            style={{
              padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700,
              fontFamily: "var(--font-body)", cursor: "pointer",
              background: "transparent", color: "var(--muted)", border: "1px solid var(--border)",
            }}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
