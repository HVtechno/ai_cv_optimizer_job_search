import IdealPanel from "./IdealPanel";

/**
 * UpgradeModal — shown when a gated backend call returns the upgrade 403.
 *
 * INTERIM (no-KvK) BEHAVIOUR:
 *   Previously this kicked off Stripe Checkout. While we run manual iDEAL, it
 *   now shows the iDEAL payment panel instead. The Stripe wrappers in Billing.js
 *   are left intact (just unused) so you can switch back after KvK registration
 *   by restoring the old startCheckout call here.
 *
 * Driven by the `info` object from billing.getUpgradeInfo(err). Pass `info`
 * (or null) and an onClose handler.
 */
export default function UpgradeModal({ info, onClose }) {
  if (!info) return null;

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
        {info.message && (
          <p style={{
            fontSize: 13.5, color: "var(--muted)", lineHeight: 1.7,
            marginBottom: 14, fontFamily: "var(--font-body)", textAlign: "center",
          }}>
            {info.message}
          </p>
        )}

        {/* The iDEAL payment panel handles the whole pay flow. */}
        <IdealPanel />

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
