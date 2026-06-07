import { useEffect, useState, useCallback } from "react";
import api from "./api";
import { useAuth } from "../context/AuthContext";

/**
 * IdealAdminPanel — admin queue for the manual iDEAL Pro flow.
 *
 * SECURITY (defense in depth):
 *   1. Backend gates /ideal/admin/* by ADMIN_EMAILS (the real enforcement).
 *   2. This component also self-gates on VITE_ADMIN_EMAILS so normal users never
 *      see it. The code still ships in the bundle (all frontend JS does); hiding
 *      the UI is about UX, the backend does the actual access control.
 *
 * Keep VITE_ADMIN_EMAILS in sync with the backend ADMIN_EMAILS. Example:
 *   VITE_ADMIN_EMAILS=support@resuviq-ai.nl
 *
 * Workflow per request:
 *   requested  -> paste the Tikkie link you made -> "Send link" (emails the user)
 *   link_sent  -> once they've paid -> "Confirm" (grants 30 days Pro)
 */

const ADMIN_EMAILS = new Set(
  (import.meta.env.VITE_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export function isAdminEmail(email) {
  return Boolean(email) && ADMIN_EMAILS.has(String(email).toLowerCase());
}

export default function IdealAdminPanel() {
  const { user } = useAuth();
  const email = user?.sub;            // JWT carries email in `sub`
  const isAdmin = isAdminEmail(email);

  const [requests, setRequests] = useState(null);
  const [linkInputs, setLinkInputs] = useState({});  // request_id -> typed url
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setErr("");
    api.get("/ideal/admin/requests")
      .then(({ data }) => setRequests(data.requests))
      .catch((e) => {
        const msg = e?.response?.data?.detail;
        setErr(typeof msg === "string" ? msg : "Could not load requests.");
        setRequests([]);
      });
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const sendLink = async (request_id) => {
    const payment_url = (linkInputs[request_id] || "").trim();
    if (!payment_url) { setNote("Paste a Tikkie link first."); return; }
    setBusyId(request_id); setNote("");
    try {
      const { data } = await api.post("/ideal/admin/send-link", { request_id, payment_url });
      setNote(data.emailed
        ? `✓ Link emailed to ${data.email}`
        : `⚠ Link saved but email may have failed for ${data.email} (they can still see it in-app)`);
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail;
      setNote(`✗ ${typeof msg === "string" ? msg : "Send failed."}`);
    } finally {
      setBusyId(null);
    }
  };

  const confirm = async (request_id) => {
    setBusyId(request_id); setNote("");
    try {
      const { data } = await api.post("/ideal/admin/confirm", { request_id });
      setNote(`✓ ${data.email} is now Pro until ${new Date(data.period_end).toLocaleDateString()}` +
        (data.emailed ? " · confirmation email sent" : " · (email may have failed — check logs)"));
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail;
      setNote(`✗ ${typeof msg === "string" ? msg : "Confirm failed."}`);
    } finally {
      setBusyId(null);
    }
  };

  const wrap = {
    width: "100%",
    fontFamily: "var(--font-body)",
  };
  const input = {
    flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8,
    background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
    color: "var(--text)", fontSize: 12.5, fontFamily: "var(--font-body)",
  };
  const btn = (busy) => ({
    flexShrink: 0, padding: "8px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700,
    cursor: busy ? "wait" : "pointer", border: "none",
    background: "linear-gradient(135deg,var(--g1),var(--g2))", color: "var(--dark)",
    opacity: busy ? 0.7 : 1,
  });

  if (!isAdmin) return null;  // after all hooks

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 14 }}>
        <button onClick={load}
          style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
            background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}>
          Refresh
        </button>
      </div>

      {err && <div style={{ color: "#ff6b6b", fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {note && <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>{note}</div>}

      {requests === null ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>No open requests.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {requests.map((r) => (
            <div key={r.request_id}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
                borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>
                {r.email} · €{r.amount_eur}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "2px 0 10px" }}>
                {r.status === "requested" ? "Waiting for you to send a link" : "Link sent — waiting for payment"}
                {r.created_at ? ` · ${new Date(r.created_at).toLocaleString()}` : ""}
                {r.status === "link_sent" && r.payment_link_expires_at
                  ? ` · link valid until ${new Date(r.payment_link_expires_at).toLocaleDateString()}`
                  : ""}
              </div>

              {r.status === "requested" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={input}
                    placeholder="Paste Tikkie link (https://tikkie.me/...)"
                    value={linkInputs[r.request_id] || ""}
                    onChange={(e) => setLinkInputs((s) => ({ ...s, [r.request_id]: e.target.value }))}
                  />
                  <button onClick={() => sendLink(r.request_id)} disabled={busyId === r.request_id} style={btn(busyId === r.request_id)}>
                    {busyId === r.request_id ? "Sending…" : "Send link"}
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {r.payment_url && (
                    <a href={r.payment_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "var(--g1)", wordBreak: "break-all" }}>
                      {r.payment_url}
                    </a>
                  )}
                  <button onClick={() => confirm(r.request_id)} disabled={busyId === r.request_id}
                    style={{ ...btn(busyId === r.request_id), marginLeft: "auto" }}>
                    {busyId === r.request_id ? "Confirming…" : "Confirm → grant Pro"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
