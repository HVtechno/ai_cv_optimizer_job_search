import { useState } from "react";
import { submitFeedback, dismissFeedbackPrompt } from "./billing";

/**
 * FeedbackModal — 1-5 star rating + optional comment.
 *
 * Used in two places:
 *   - Periodic prompt after an optimization (source="optimization"). Dismissing
 *     (Esc / click-away / "Not now") calls dismissFeedbackPrompt() to start the
 *     30-day cooldown, so the user isn't asked again for a month.
 *   - Settings "Send feedback" (source="settings"). No cooldown; dismiss just
 *     closes.
 *
 * Props:
 *   open       : boolean
 *   source     : "optimization" | "settings"
 *   onClose    : () => void                    (called after submit OR dismiss)
 *   title?     : string                        (optional custom heading)
 */
export default function FeedbackModal({ open, source = "settings", onClose, title }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!open) return null;

  const close = async (dismissed) => {
    // For the periodic prompt, a dismiss (no submit) still starts the cooldown.
    if (dismissed && source === "optimization") {
      await dismissFeedbackPrompt();
    }
    // reset for next open
    setRating(0); setHover(0); setComment(""); setBusy(false); setDone(false);
    onClose?.();
  };

  const submit = async () => {
    if (rating < 1) return;
    try {
      setBusy(true);
      await submitFeedback({ rating, comment, source });
      setDone(true);
      // Brief thank-you, then close.
      setTimeout(() => close(false), 1100);
    } catch (e) {
      console.error("Feedback submit failed", e);
      setBusy(false);
    }
  };

  return (
    <div
      onClick={() => close(true)}
      style={{
        position: "fixed", inset: 0, zIndex: 95,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90%", maxWidth: 420,
          background: "#0e1311",
          border: "1px solid rgba(0,232,122,0.28)",
          borderRadius: 20, padding: 28,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          textAlign: "center",
        }}
      >
        {done ? (
          <div style={{ padding: "20px 0" }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>🙌</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "#ffffff" }}>
              Thank you!
            </div>
            <p style={{ fontSize: 13, color: "#c7d0cc", marginTop: 8, fontFamily: "var(--font-body)" }}>
              Your feedback helps us improve Resuviq.
            </p>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, color: "#ffffff", marginBottom: 8 }}>
              {title || "How's your experience?"}
            </div>
            <p style={{ fontSize: 13, color: "#c7d0cc", lineHeight: 1.6, marginBottom: 18, fontFamily: "var(--font-body)" }}>
              Rate Resuviq so far — your feedback shapes what we build next.
            </p>

            {/* Stars */}
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 18 }}>
              {[1, 2, 3, 4, 5].map((n) => {
                const active = (hover || rating) >= n;
                return (
                  <button
                    key={n}
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    onClick={() => setRating(n)}
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      fontSize: 32, lineHeight: 1, padding: 2,
                      color: active ? "#ffc83d" : "rgba(255,255,255,0.22)",
                      transition: "color .12s, transform .12s",
                      transform: active ? "scale(1.08)" : "scale(1)",
                    }}
                  >
                    ★
                  </button>
                );
              })}
            </div>

            {/* Optional comment */}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Anything you'd like us to know? (optional)"
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box", resize: "none",
                padding: "10px 12px", borderRadius: 10, fontSize: 13,
                background: "rgba(0,0,0,0.3)", color: "#ffffff",
                border: "1px solid rgba(255,255,255,0.12)",
                fontFamily: "var(--font-body)", outline: "none", marginBottom: 18,
              }}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => close(true)}
                disabled={busy}
                style={{
                  flex: 1, padding: "11px 0", borderRadius: 10, cursor: "pointer",
                  fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)",
                  background: "transparent", color: "#c7d0cc",
                  border: "1px solid rgba(255,255,255,0.18)",
                }}
              >
                Not now
              </button>
              <button
                onClick={submit}
                disabled={busy || rating < 1}
                style={{
                  flex: 1.5, padding: "11px 0", borderRadius: 10,
                  cursor: (busy || rating < 1) ? "not-allowed" : "pointer",
                  fontSize: 13, fontWeight: 800, fontFamily: "var(--font-body)",
                  background: rating >= 1 ? "linear-gradient(135deg,var(--g1),var(--g2))" : "rgba(255,255,255,0.1)",
                  color: "#ffffff", border: "none",
                  opacity: busy ? 0.7 : 1,
                  textShadow: rating >= 1 ? "0 1px 2px rgba(0,0,0,0.35)" : "none",
                }}
              >
                {busy ? "Sending…" : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}