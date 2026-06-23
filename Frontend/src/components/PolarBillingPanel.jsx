import { useEffect, useState } from "react";
import { startPolarCheckout } from "./polar";
import api from "./api";

/**
 * PolarBillingPanel — user-facing Pro billing via Polar (NEW, additive).
 *
 * Replaces the IdealPanel in the user experience. Two states:
 *   - Not Pro  -> "Upgrade to Pro" button that starts a Polar checkout and
 *                 redirects the browser to Polar's hosted payment page.
 *   - On Pro   -> shows active status + renewal date. Polar manages renewal and
 *                 cancellation automatically (no manual approval), so we just
 *                 point the user to manage/cancel via support or their receipt.
 *
 * Styling mirrors the old IdealPanel so the Settings page looks unchanged.
 * The IdealPanel file remains in the repo, just no longer rendered.
 */
export default function PolarBillingPanel() {
  const [sub, setSub]   = useState(null);   // /polar/subscription payload
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  useEffect(() => {
    api.get("/polar/subscription")
      .then(({ data }) => setSub(data))
      .catch(() => setSub(null));
  }, []);

  const upgrade = async () => {
    setErr("");
    setBusy(true);
    try {
      await startPolarCheckout();   // redirects to Polar on success
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
  const muted = { fontSize: 13, color: "var(--muted)", lineHeight: 1.7 };
  const primaryBtn = {
    display: "block", width: "100%", textAlign: "center",
    padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 700,
    cursor: busy ? "wait" : "pointer", textDecoration: "none",
    background: "linear-gradient(135deg,var(--g1),var(--g2))", color: "var(--dark)",
    border: "none", opacity: busy ? 0.7 : 1, marginTop: 6,
  };

  const isPro = sub?.plan === "pro";
  const periodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  // Active Pro: show status, never the upgrade button.
  if (isPro) {
    return (
      <div style={card}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
          You're on Pro 🎉
        </div>
        <p style={muted}>
          Your subscription is active{periodEnd ? <> and renews on <strong>{periodEnd}</strong></> : ""}.
          Billing is handled securely by our payments partner, who also sends your
          receipts. To cancel or update payment details, use the link in your
          payment receipt email, or contact{" "}
          <a href="mailto:support@resuviq-ai.nl" style={{ color: "var(--g1)" }}>support@resuviq-ai.nl</a>.
        </p>
      </div>
    );
  }

  // Not Pro: show the upgrade CTA.
  return (
    <div style={card}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
        Go Pro
      </div>
      <p style={muted}>
        You'll be taken to our secure checkout. Pro activates automatically once
        payment is confirmed, and renews each month — cancel anytime.
      </p>
      {err && <p style={{ fontSize: 13, color: "#ff6b6b", marginTop: 10 }}>{err}</p>}
      <button onClick={upgrade} disabled={busy} style={primaryBtn}>
        {busy ? "Starting checkout…" : "Upgrade to Pro"}
      </button>
    </div>
  );
}