import { useEffect, useState, useCallback, useRef } from "react";
import api from "./api";

/**
 * PolarSubscriptionsPanel — READ-ONLY view of Polar subscribers (additive).
 *
 * Shows who is on a Polar-granted plan, their status, and renewal/period-end
 * date. Title is simply "Subscriptions". It does NOT approve, grant, or revoke
 * anything — Polar manages all of that via webhooks. Purely a window.
 *
 * Drill-down: the Active / Canceled / Total summary cards are clickable and open
 * a drawer listing the matching users. The drill-down filters the data already
 * fetched here (client-side), so there's no extra backend call per drill.
 *
 * Loading: this fetches once on mount. There is no separate Refresh button —
 * it loads alongside the rest of the admin Overview. Re-mounting (navigating
 * back to Overview) refreshes it.
 *
 * Data: GET /polar/admin/subscriptions (admin-gated server-side; reads our own
 * MongoDB). Visual language matches AdminMetrics.
 */

const card = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "16px 18px",
};

function StatCard({ label, value, accent, onClick }) {
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      style={{ ...card, minWidth: 0, cursor: clickable ? "pointer" : "default", transition: "border-color 120ms" }}
      onMouseEnter={(e) => clickable && (e.currentTarget.style.borderColor = "var(--g1, #00e87a)")}
      onMouseLeave={(e) => clickable && (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        {clickable && <span style={{ opacity: 0.6 }}>→</span>}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, margin: "8px 0 2px", fontFamily: "var(--font-display)", color: accent || "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    active:   { bg: "rgba(0,232,122,0.15)", fg: "var(--g1, #00e87a)", text: "Active" },
    canceled: { bg: "rgba(255,107,107,0.14)", fg: "#ff6b6b", text: "Canceled" },
  };
  const s = map[status] || { bg: "rgba(255,255,255,0.08)", fg: "var(--muted)", text: status || "—" };
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {s.text}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

// Lightweight drill-down drawer (client-side filtered rows; matches the
// slide-over look of the main metrics drawers).
function SubsDrawer({ open, title, rows, onClose }) {
  const [search, setSearch] = useState("");
  const scrollRef = useRef(null);
  const [showFade, setShowFade] = useState(false);
  const [canScrollX, setCanScrollX] = useState(false);

  // Same overflow detection as the main admin Drawer: show the ↓ button while
  // there's more to scroll down, and the "swipe →" pill while the table can
  // scroll horizontally and isn't already scrolled to the end.
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowFade(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    setCanScrollX(el.scrollWidth - el.clientWidth > 8 && el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  }, []);

  useEffect(() => { if (open) setSearch(""); }, [open, title]);
  useEffect(() => { const t = setTimeout(updateFade, 60); return () => clearTimeout(t); }, [open, title, rows, search, updateFade]);

  if (!open) return null;

  const filtered = (rows || []).filter((r) =>
    !search.trim() || (r.email || "").toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 97vw)", height: "100%", background: "var(--panel, #0d1411)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", boxShadow: "-20px 0 40px rgba(0,0,0,0.4)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "var(--text)" }}>
            {title} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 14 }}>({filtered.length})</span>
          </div>
          <button onClick={onClose} style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}>Close</button>
        </div>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email…"
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: 13, background: "rgba(255,255,255,0.04)", color: "var(--text)", border: "1px solid var(--border)", outline: "none" }}
          />
        </div>
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div ref={scrollRef} onScroll={updateFade} style={{ height: "100%", overflowY: "auto", overflowX: "auto", padding: "8px 14px", WebkitOverflowScrolling: "touch" }}>
            {filtered.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>Nothing matches.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, whiteSpace: "nowrap" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>User</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Plan</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Status</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Renews / ends</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Polar customer ID</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={r.email || i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 12px", color: "var(--text)" }}>{r.email}</td>
                      <td style={{ padding: "10px 12px", color: "var(--text)", textTransform: "capitalize" }}>{r.plan}</td>
                      <td style={{ padding: "10px 12px" }}><StatusPill status={r.subscription_status} /></td>
                      <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{fmtDate(r.current_period_end)}</td>
                      <td style={{ padding: "10px 12px", color: "var(--muted)", fontFamily: "monospace", fontSize: 12 }}>{r.polar_customer_id || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {showFade && (
            <div style={{ pointerEvents: "none", position: "absolute", bottom: 0, left: 0, right: 4, height: 56, background: "linear-gradient(to top, var(--panel, #0d1411), transparent)", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 4 }}>
              <button onClick={() => scrollRef.current?.scrollBy({ top: 240, behavior: "smooth" })}
                style={{ pointerEvents: "auto", width: 28, height: 28, borderRadius: 999, background: "rgba(0,232,122,0.15)", border: "1px solid var(--border)", color: "var(--g1, #00e87a)", cursor: "pointer" }} title="Scroll for more">↓</button>
            </div>
          )}
          {canScrollX && (
            <div style={{ pointerEvents: "none", position: "absolute", top: 6, right: 6, background: "rgba(0,232,122,0.15)", border: "1px solid var(--border)", color: "var(--g1, #00e87a)", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
              swipe →
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PolarSubscriptionsPanel() {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState("");
  const [drawer, setDrawer] = useState(null);   // { title, rows } | null

  const load = useCallback(() => {
    setErr("");
    api.get("/polar/admin/subscriptions")
      .then(({ data }) => setData(data))
      .catch((e) => {
        const msg = e?.response?.data?.detail;
        setErr(typeof msg === "string" ? msg : "Could not load subscriptions.");
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const summary = data?.summary || { active: 0, canceled: 0, total: 0 };
  const subs = data?.subscriptions || [];

  const activeRows   = subs.filter((s) => s.subscription_status === "active");
  const canceledRows = subs.filter((s) => s.subscription_status === "canceled");

  const sectionTitle = { fontSize: 13, fontWeight: 800, color: "var(--text)", textTransform: "uppercase", letterSpacing: 0.7, margin: "22px 0 10px" };

  return (
    <div>
      <div style={sectionTitle}>Subscriptions</div>

      {err && <div style={{ color: "#ff6b6b", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <StatCard label="Active" value={summary.active.toLocaleString()} accent="var(--g1, #00e87a)"
          onClick={() => setDrawer({ title: "Active subscriptions", rows: activeRows })} />
        <StatCard label="Canceled" value={summary.canceled.toLocaleString()}
          onClick={() => setDrawer({ title: "Canceled subscriptions", rows: canceledRows })} />
        <StatCard label="Total subscribers" value={summary.total.toLocaleString()}
          onClick={() => setDrawer({ title: "All subscribers", rows: subs })} />
      </div>

      <SubsDrawer
        open={!!drawer}
        title={drawer?.title || ""}
        rows={drawer?.rows || []}
        onClose={() => setDrawer(null)}
      />
    </div>
  );
}