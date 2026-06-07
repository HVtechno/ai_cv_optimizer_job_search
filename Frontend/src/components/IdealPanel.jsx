import { useEffect, useState } from "react";
import api from "./api";

/**
 * IdealPanel — user-facing "Request Pro" panel for the no-KvK manual flow.
 *
 * Flow from the user's side:
 *   - They click "Request Pro". We POST /ideal/request (no input needed — we
 *     know who they are from their token).
 *   - You (admin) email them a Tikkie link. Once sent, this panel also shows a
 *     "Pay now" button (the link is returned by /ideal/status), so they can pay
 *     from here or from the email.
 *   - After they pay and you confirm, their plan flips to Pro.
 *
 * Additive: does NOT replace Stripe. Stop rendering this once you switch live.
 * Styling reuses your existing CSS variables.
 */
export default function IdealPanel() {
  const [status, setStatus] = useState(null);   // /ideal/status payload
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState("");
  const [paidClicked, setPaidClicked] = useState(false);

  const load = () => {
    api.get("/ideal/status")
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus(null));
  };

  useEffect(() => { load(); }, []);

  const requestPro = async () => {
    setErr("");
    setBusy(true);
    try {
      await api.post("/ideal/request");
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail;
      setErr(typeof msg === "string" ? msg : "Could not submit your request. Please try again.");
    } finally {
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
    border: "none", opacity: busy ? 0.7 : 1,
  };

  const req     = status?.request || null;
  const hasLink = req?.payment_url;
  const amount  = status?.amount_eur ?? 29;
  const days    = status?.period_days ?? 30;
  const isPro   = status?.plan === "pro";
  const periodEnd = status?.current_period_end
    ? new Date(status.current_period_end).toLocaleDateString()
    : null;
  const linkExpires = req?.link_expires_at
    ? new Date(req.link_expires_at).toLocaleDateString()
    : null;

  // While Pro is ACTIVE: show status + contact note, never the request option.
  // When their period ends, expiry flips them to basic and the request UI
  // returns automatically on next load.
  if (isPro) {
    return (
      <div style={card}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
          You're on Pro 🎉
        </div>
        <p style={{ ...muted, marginBottom: 12 }}>
          Your Pro access is active{periodEnd ? <> until <b style={{ color: "var(--text)" }}>{periodEnd}</b></> : ""}.
          Enjoy the full service. Pro doesn't renew automatically — you'll be able
          to renew here once this period ends.
        </p>
        <p style={{ ...muted, margin: 0 }}>
          Need help or have a billing question? Contact{" "}
          <a href="mailto:support@resuviq-ai.nl" style={{ color: "var(--g1)" }}>support@resuviq-ai.nl</a>.
        </p>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
        Get Pro with iDEAL
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 16 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: "#fff" }}>€{amount}</span>
        <span style={muted}>/ {days} days</span>
      </div>

      {err && <div style={{ color: "#ff6b6b", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {/* State 1: a link has been emailed -> let them pay from here too. */}
      {hasLink ? (
        <>
          <p style={{ ...muted, marginBottom: 16 }}>
            We’ve emailed your iDEAL payment link. You can also pay using the button
            below.{linkExpires ? <> This link is valid until <b style={{ color: "var(--text)" }}>{linkExpires}</b> — after that you’ll need to request a new one.</> : ""}
          </p>
          <a href={req.payment_url} target="_blank" rel="noopener noreferrer" style={primaryBtn}
            onClick={() => setPaidClicked(true)}>
            Pay €{amount} with iDEAL →
          </a>

          {/* Clear waiting-for-confirmation note. We can't detect the payment
              automatically (personal iDEAL has no callback), so we set the right
              expectation: Pro activates after manual confirmation. */}
          <div style={{
            marginTop: 16, padding: "12px 14px", borderRadius: 10,
            background: "rgba(0,201,255,0.07)", border: "1px solid rgba(0,201,255,0.25)",
          }}>
            <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 700, marginBottom: 4 }}>
              {paidClicked ? "Waiting for payment confirmation" : "After you pay"}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
              Your Pro access is activated once we manually confirm your payment —
              usually shortly after. It is not instant and does not renew
              automatically. You’ll see your renewal date here once it’s active.
            </p>
          </div>
        </>
      ) : req ? (
        /* State 2: requested, waiting for you to send a link. */
        <p style={{ ...muted }}>
          ✓ Your Pro request has been received. We’ll email an iDEAL payment link
          shortly. Once you pay and we confirm it, you’ll get {days} days of Pro.
        </p>
      ) : (
        /* State 3: no request yet -> let them request. */
        <>
          <p style={{ ...muted, marginBottom: 16 }}>
            Request Pro and we’ll email you a secure iDEAL payment link. Pay €{amount}
            for {days} days of Pro — activated once we confirm your payment. No
            automatic renewal.
          </p>
          <button onClick={requestPro} disabled={busy} style={primaryBtn}>
            {busy ? "Submitting…" : "Request Pro →"}
          </button>
        </>
      )}
    </div>
  );
}
