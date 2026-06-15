import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  fetchSubscription,
  fetchUsage, deleteAccount,
} from "../../components/Billing";
import IdealPanel from "../../components/IdealPanel";
import { isAdminEmail } from "../../components/IdealAdminPanel";
import FeedbackModal from "../../components/Feedbackmodal";
import api from "../../components/api";

/**
 * SettingsPanel — the "Settings" page rendered inside Dashboard.
 *
 * Shows the current plan, live usage meters (X of Y for resumes / refreshes /
 * optimizations), the right billing action, and a danger-zone delete-account
 * control. Matches the dark theme via the shared CSS variables.
 */
export default function SettingsPanel() {
  const { user, plan, limits, subStatus, refreshPlan, logout } = useAuth();
  const navigate = useNavigate();
  const [sub, setSub] = useState(null);

  // Live usage meters. Pro metering is per-resume, so we pass the active resume
  // id (persisted by the Dashboard in localStorage) to get its figures.
  const [usage, setUsage] = useState(null);

  // Delete-account flow state.
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Feedback modal (Settings link entry point).
  const [showFeedback, setShowFeedback] = useState(false);
  const [isContributor, setIsContributor] = useState(false);
  // Admin contact email shown to contributors — read from the same env var the
  // admin gate uses (first entry if multiple). No hardcoding.
  const adminContact = (import.meta.env.VITE_ADMIN_EMAILS || "")
    .split(",").map((e) => e.trim()).filter(Boolean)[0] || "your administrator";
  useEffect(() => {
    let alive = true;
    api.get("/team/check")
      .then((r) => { if (alive) setIsContributor(Boolean(r.data?.is_contributor)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const activeResumeId =
    typeof window !== "undefined" ? localStorage.getItem("active_resume_id") : null;

  const loadUsage = () => {
    fetchUsage(activeResumeId).then(setUsage).catch(() => setUsage(null));
  };

  useEffect(() => {
    fetchSubscription().then(setSub).catch(() => setSub(null));
    loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // If the user just came back from Stripe checkout (?checkout=success), the
  // webhook may have flipped their plan — refetch so the UI updates.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      const t = setTimeout(() => { refreshPlan(); loadUsage(); }, 1500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshPlan]);

  const handleDelete = async () => {
    if (deleteConfirm.trim().toUpperCase() !== "DELETE") return;
    try {
      setDeleting(true);
      await deleteAccount();
      // Clear local state and send them home; their account no longer exists.
      localStorage.removeItem("active_resume_id");
      logout();
      navigate("/");
    } catch (e) {
      console.error("Account deletion failed", e);
      setDeleting(false);
    }
  };

  const isAdmin = isAdminEmail(user?.sub);
  const planLabel = isAdmin ? "Admin" : isContributor ? "Contributor" : ({ basic: "Free", pro: "Pro", enterprise: "Enterprise" }[plan] || "Free");
  const fmt = (v) => (v === null || v === undefined ? "Unlimited" : v);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "32px 36px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
            Settings
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4, fontFamily: "var(--font-body)" }}>
            Manage your plan and billing
          </div>
        </div>

        {/* Account card */}
        <div style={cardStyle}>
          <div style={sectionLabel}>Account</div>
          <Row label="Email" value={user?.sub || "—"} />
          <Row
            label="Subscription status"
            value={(sub?.subscription_status || subStatus || "none").replace("_", " ")}
          />
          {(sub?.billing_interval && sub?.amount_eur != null) && (
            <Row
              label="Billing"
              value={`€${sub.amount_eur} / ${sub.billing_interval === "year" ? "year" : "month"}`}
            />
          )}
          {sub?.current_period_end ? (
            <Row
              label={sub?.subscription_status === "canceled" ? "Access ends" : "Renews on"}
              value={new Date(sub.current_period_end).toLocaleDateString(undefined, {
                year: "numeric", month: "long", day: "numeric",
              })}
            />
          ) : (plan === "pro" || plan === "enterprise") ? (
            <Row label="Renews on" value="—" />
          ) : null}
        </div>

        {/* Current plan card */}
        <div style={{ ...cardStyle, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={sectionLabel}>Current plan</div>
            <span style={{
              fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 800,
              padding: "4px 12px", borderRadius: 100,
              background: (!isAdmin && !isContributor && plan === "basic") ? "var(--border)" : "linear-gradient(135deg,var(--g1),var(--g2))",
              color: (!isAdmin && !isContributor && plan === "basic") ? "var(--muted)" : "var(--dark)",
            }}>
              {planLabel.toUpperCase()}
            </span>
          </div>

          {limits ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
              <Stat label="Resume uploads" value={fmt(limits.max_resumes)} />
              <Stat label="Job matches / resume" value={fmt(limits.max_job_matches)} />
              <Stat
                label={limits.max_refreshes_month != null ? "Refreshes / month" : "Refreshes / resume"}
                value={fmt(limits.max_refreshes_month != null ? limits.max_refreshes_month : limits.max_refreshes_resume)}
              />
              <Stat
                label={limits.max_optimized_jobs_month != null ? "Optimized jobs / month" : "Optimized jobs / resume"}
                value={fmt(limits.max_optimized_jobs_month != null ? limits.max_optimized_jobs_month : limits.max_optimized_jobs_resume)}
              />
              <Stat label="AI resume rewriting" value={limits.resume_rewrite ? "Included" : "—"} />
              <Stat label="Cover & motivation letters" value={limits.cover_letter ? "Included" : "—"} />
              <Stat label="PDF export" value={limits.pdf_export ? "Included" : "—"} />
              <Stat label="Full ATS breakdown" value={limits.full_ats_breakdown ? "Included" : "Score only"} />
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading plan…</div>
          )}
        </div>

        {/* Usage meters card — live "X of Y" counters */}
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={sectionLabel}>Usage</div>
            <button
              onClick={loadUsage}
              style={{ fontSize: 11, fontFamily: "var(--font-body)", color: "var(--g1)", background: "transparent", border: "none", cursor: "pointer" }}
            >
              ↻ Refresh
            </button>
          </div>
          {usage ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Meter
                label="Resume uploads"
                used={usage.resumes?.used}
                cap={usage.resumes?.cap}
              />
              <Meter
                label={
                  usage.optimizations?.scope === "resume"
                    ? "Optimized jobs (this resume)"
                    : "Optimized jobs (this month)"
                }
                used={usage.optimizations?.used}
                cap={usage.optimizations?.cap}
              />
              <Meter
                label={
                  usage.refreshes?.scope === "resume"
                    ? "Refreshes (this resume)"
                    : "Refreshes (this month)"
                }
                used={usage.refreshes?.used}
                cap={usage.refreshes?.cap}
              />
              {usage.refreshes?.scope === "resume" && !activeResumeId && (
                <div style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--font-body)" }}>
                  Open a resume on the dashboard to see its per-resume usage.
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading usage…</div>
          )}
        </div>

        {/* Action card — depends on plan */}
        <div style={cardStyle}>
          {isAdmin ? (
            <>
              <div style={sectionLabel}>Admin account</div>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, fontFamily: "var(--font-body)" }}>
                You have full, unlimited access as an administrator. There's no plan or billing to manage on this account.
              </p>
            </>
          ) : isContributor ? (
            <>
              <div style={sectionLabel}>Contributor account</div>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, fontFamily: "var(--font-body)" }}>
                You have full, unlimited access as a Contributor — limited to Dashboard
                &amp; Batch, without admin rights. There's no plan or billing to manage on
                this account. For any details, contact your administrator at{" "}
                <a href={`mailto:${adminContact}`} style={{ color: "var(--g1)" }}>{adminContact}</a>.
              </p>
            </>
          ) : (
            <>
              {plan === "basic" && (
                <>
                  <div style={sectionLabel}>Upgrade to Pro</div>
                  <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 18, fontFamily: "var(--font-body)" }}>
                    Unlock AI resume rewriting, cover &amp; motivation letters, PDF export,
                    unlimited refreshes, and more job matches.
                  </p>

                  {/* Manual iDEAL payment panel (no-KvK interim). */}
                  <IdealPanel />
                </>
              )}

              {plan === "pro" && (
                <>
                  {/* IdealPanel shows the active-Pro status + contact note, and no
                      request option while Pro is active. */}
                  <IdealPanel />
                </>
              )}

              {plan === "enterprise" && (
                <>
                  <div style={sectionLabel}>Enterprise plan</div>
                  <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, fontFamily: "var(--font-body)" }}>
                    Your account is on a custom Enterprise plan. For changes to seats,
                    limits, or billing, contact{" "}
                    <a href="mailto:support@resuviq-ai.nl" style={{ color: "var(--g1)" }}>support@resuviq-ai.nl</a>.
                  </p>
                </>
              )}
            </>
          )}
        </div>


        {/* Feedback card + Danger zone — hidden for admins and contributors
            (team accounts; account management is handled by the admin) */}
        {!isAdmin && !isContributor && (
          <>
            {/* Feedback card */}
            <div style={cardStyle}>
              <div style={sectionLabel}>Feedback</div>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16, fontFamily: "var(--font-body)" }}>
                Got a suggestion or something that didn't work well? We read every
                piece of feedback and use it to decide what to build next.
              </p>
              <button
                onClick={() => setShowFeedback(true)}
                style={{
                  padding: "10px 18px", borderRadius: 10, cursor: "pointer",
                  fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)",
                  background: "transparent", color: "var(--g1)",
                  border: "1px solid rgba(0,232,122,0.4)",
                }}
              >
                ★ Send feedback
              </button>
            </div>

            {/* Danger zone — delete account */}
            <div style={{ ...cardStyle, border: "1px solid rgba(255,80,80,0.28)", background: "rgba(255,80,80,0.04)" }}>
              <div style={{ ...sectionLabel, color: "#ff7676" }}>Danger zone</div>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16, fontFamily: "var(--font-body)" }}>
                Deleting your account is permanent. It removes your profile, all uploaded
                resumes, their analyses and job matches, and cancels any active
                subscription. This cannot be undone.
              </p>

              {!showDelete ? (
                <button
                  onClick={() => setShowDelete(true)}
                  style={{
                    padding: "10px 18px", borderRadius: 10, cursor: "pointer",
                    fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)",
                    background: "transparent", color: "#ff7676",
                    border: "1px solid rgba(255,118,118,0.4)",
                  }}
                >
                  Delete my account
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-body)" }}>
                    Type <strong style={{ color: "#ff7676" }}>DELETE</strong> to confirm:
                  </label>
                  <input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    style={{
                      padding: "10px 12px", borderRadius: 8, fontSize: 13,
                      background: "rgba(0,0,0,0.3)", color: "var(--text)",
                      border: "1px solid rgba(255,255,255,0.12)", fontFamily: "var(--font-body)",
                      outline: "none", maxWidth: 240,
                    }}
                  />
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => { setShowDelete(false); setDeleteConfirm(""); }}
                      disabled={deleting}
                      style={{
                        padding: "10px 18px", borderRadius: 10, cursor: "pointer",
                        fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)",
                        background: "transparent", color: "var(--muted)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting || deleteConfirm.trim().toUpperCase() !== "DELETE"}
                      style={{
                        padding: "10px 18px", borderRadius: 10,
                        cursor: (deleting || deleteConfirm.trim().toUpperCase() !== "DELETE") ? "not-allowed" : "pointer",
                        fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)",
                        background: deleteConfirm.trim().toUpperCase() === "DELETE" ? "#ff5050" : "rgba(255,80,80,0.3)",
                        color: "#fff", border: "none",
                        opacity: deleting ? 0.7 : 1,
                      }}
                    >
                      {deleting ? "Deleting…" : "Permanently delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Feedback modal (Settings entry point — no cooldown) */}
      <FeedbackModal
        open={showFeedback}
        source="settings"
        onClose={() => setShowFeedback(false)}
        title="Send us feedback"
      />
    </div>
  );
}

/* ── tiny presentational helpers (inline so this is a single drop-in file) ── */

const cardStyle = {
  background: "var(--surface, rgba(255,255,255,0.02))",
  border: "1px solid var(--border, rgba(255,255,255,0.08))",
  borderRadius: 16,
  padding: 22,
  marginBottom: 18,
};

const sectionLabel = {
  fontFamily: "var(--font-display)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color: "var(--g1)",
  marginBottom: 14,
};

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-body)" }}>{label}</span>
      <span style={{ fontSize: 12.5, color: "var(--text)", fontFamily: "var(--font-body)", textTransform: "capitalize" }}>{value}</span>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-body)" }}>{label}</span>
      <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600, fontFamily: "var(--font-body)" }}>{value}</span>
    </div>
  );
}

function Meter({ label, used, cap }) {
  const unlimited = cap === null || cap === undefined;
  const u = used || 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((u / Math.max(cap, 1)) * 100));
  const atLimit = !unlimited && u >= cap;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-body)" }}>{label}</span>
        <span style={{
          fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-body)",
          color: atLimit ? "#ff7676" : "var(--text)",
        }}>
          {unlimited ? `${u} · Unlimited` : `${u} of ${cap}`}
        </span>
      </div>
      {!unlimited && (
        <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 100, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${pct}%`, borderRadius: 100,
            background: atLimit ? "#ff5050" : "linear-gradient(90deg,var(--g1),var(--g2))",
            transition: "width .3s",
          }} />
        </div>
      )}
    </div>
  );
}

function primaryBtn(busy) {
  return {
    padding: "11px 22px",
    borderRadius: 10,
    border: "none",
    cursor: busy ? "wait" : "pointer",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "var(--font-body)",
    background: "linear-gradient(135deg,var(--g1),var(--g2))",
    color: "var(--dark)",
    opacity: busy ? 0.7 : 1,
  };
}