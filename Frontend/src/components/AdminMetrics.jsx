import { useEffect, useState, useCallback, useRef } from "react";
import api from "./api";
import { useAuth } from "../context/AuthContext";
import { isAdminEmail } from "./IdealAdminPanel";

/**
 * AdminMetrics — admin analytics overview with drill-downs.
 *
 * Clicking a stat opens a slide-over drawer that lists the real underlying rows.
 * Lists are SERVER-SIDE: search, sort, date range, and quick filters are sent as
 * query params so they act on the FULL dataset, not just the visible page. The
 * drawer shows a scrollable rows area plus windowed numbered-page pagination,
 * mirroring the dashboard's JobsTable so it feels native.
 *
 * Security mirrors IdealAdminPanel: self-gates on VITE_ADMIN_EMAILS for UX, while
 * the backend enforces ADMIN_EMAILS on every /ideal/admin/* call.
 */

const PAGE_SIZE = 25;   // rows per page in a drawer (matches a "constant rows" feel)

const card = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "16px 18px",
};

function StatCard({ label, value, sub, accent, onClick }) {
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      style={{ ...card, cursor: clickable ? "pointer" : "default", transition: "border-color 120ms" }}
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
      {sub != null && <div style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

function TrendBars({ data }) {
  if (!data || data.length === 0) return <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No registration data yet.</div>;
  const W = 520, H = 120, pad = 18;
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = (W - pad * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", maxWidth: W }} role="img" aria-label="Registrations over the last 14 days">
      {data.map((d, i) => {
        const h = Math.round(((H - pad * 2) * d.count) / max);
        const x = pad + i * bw, y = H - pad - h;
        return (
          <g key={d.date}>
            <rect x={x + 2} y={y} width={Math.max(2, bw - 4)} height={Math.max(d.count > 0 ? 2 : 0, h)} rx={3} fill="var(--g1, #00e87a)" opacity={0.9}>
              <title>{`${d.date}: ${d.count}`}</title>
            </rect>
            {(i === 0 || i === data.length - 1) && (
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--muted)">{d.date.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString();
}

// ── CSV export (zero-dependency) ──────────────────────────────────────────────
// Quotes every field per RFC 4180 (doubles embedded quotes, wraps in quotes),
// prepends a UTF-8 BOM so Excel reads accents correctly, and triggers a download.
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(filename, headers, rows) {
  const head = headers.map((h) => csvCell(h.label)).join(",");
  const body = rows.map((r) => headers.map((h) => csvCell(h.value(r))).join(",")).join("\r\n");
  const csv = "\uFEFF" + head + "\r\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ctrl = {
  padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--border)", color: "var(--text)", fontSize: 12.5,
  fontFamily: "var(--font-body)",
};
const pagerBtn = (active, disabled) => ({
  minWidth: 32, height: 32, padding: "0 8px", borderRadius: 8, fontSize: 12.5, fontWeight: 700,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
  border: active ? "none" : "1px solid var(--border)",
  background: active ? "linear-gradient(135deg,var(--g1),var(--g2))" : "transparent",
  color: active ? "var(--dark, #0a0f0d)" : "var(--text)",
});

/** Windowed page numbers, same shape as the dashboard's getVisiblePages. */
function visiblePages(page, totalPages) {
  const pages = [];
  if (totalPages <= 5) { for (let i = 1; i <= totalPages; i++) pages.push(i); return pages; }
  pages.push(1);
  const start = Math.max(2, page - 1), end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("…l");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push("…r");
  pages.push(totalPages);
  return pages;
}

/**
 * Drawer — server-side list with search / sort / date-range / quick filters.
 * `config`:
 *   { title, path, dataKey, columns,
 *     searchable: "placeholder" | false,
 *     dateRange: { from: "created_from", to: "created_to", label } | false,
 *     filters: [{ label, params } ...] | [],
 *     baseParams: {}, onRowClick }
 *   columns: [{ key, label, sortKey?, render? }]
 */
function Drawer({ open, config, onClose }) {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);            // 1-based
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(null);
  const [order, setOrder] = useState("desc");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [activeFilter, setActiveFilter] = useState(0);   // index into config.filters (0 = default/all)

  const scrollRef = useRef(null);
  const [showFade, setShowFade] = useState(false);
  const [canScrollX, setCanScrollX] = useState(false);
  const debounceRef = useRef(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset everything when a new drawer opens.
  useEffect(() => {
    if (!open) return;
    setRows(null); setTotal(0); setPage(1); setErr("");
    setSearch(""); setSort(null); setOrder("desc"); setFrom(""); setTo(""); setActiveFilter(0);
  }, [open, config?.path, config?.title]);

  const buildParams = useCallback(() => {
    const filterParams = (config?.filters && config.filters[activeFilter]?.params) || {};
    const params = { ...(config?.baseParams || {}), ...filterParams };
    if (config?.searchable && search.trim()) params.search = search.trim();
    if (sort) { params.sort = sort; params.order = order; }
    if (config?.dateRange) {
      if (from) params[config.dateRange.from] = from;
      if (to) params[config.dateRange.to] = to;
    }
    return params;
  }, [config, activeFilter, search, sort, order, from, to]);

  const fetchRows = useCallback((pageNum) => {
    if (!config) return;
    setErr(""); setRows(null);
    const params = { ...buildParams(), skip: (pageNum - 1) * PAGE_SIZE, limit: PAGE_SIZE };
    api.get(config.path, { params })
      .then(({ data }) => { setRows(data[config.dataKey] || []); setTotal(data.total || 0); })
      .catch((e) => { setErr(e?.response?.data?.detail || "Could not load list."); setRows([]); });
  }, [config, buildParams]);

  const [exporting, setExporting] = useState(false);
  const doExport = useCallback(async () => {
    if (!config?.exportColumns) return;
    setExporting(true);
    try {
      const all = [];
      const base = buildParams();
      const BATCH = 200;            // server hard cap is 200/req
      let skipN = 0, totalN = Infinity;
      // Page through the FULL filtered set, not just the visible page.
      while (skipN < totalN && skipN < 100000) {
        const { data } = await api.get(config.path, { params: { ...base, skip: skipN, limit: BATCH } });
        const batch = data[config.dataKey] || [];
        all.push(...batch);
        totalN = data.total ?? all.length;
        if (batch.length === 0) break;
        skipN += BATCH;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const safeTitle = (config.title || "export").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      downloadCSV(`${safeTitle}_${stamp}.csv`, config.exportColumns, all);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Export failed.");
    } finally {
      setExporting(false);
    }
  }, [config, buildParams]);

  // Fetch when controls change (debounced for search), resetting to page 1.
  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); fetchRows(1); }, search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [open, fetchRows, search]);

  const goPage = (p) => { setPage(p); fetchRows(p); scrollRef.current?.scrollTo({ top: 0 }); };

  const updateFade = () => {
    const el = scrollRef.current;
    if (!el) return setShowFade(false);
    setShowFade(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    setCanScrollX(el.scrollWidth - el.clientWidth > 8 && el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  };
  useEffect(() => { const t = setTimeout(updateFade, 60); return () => clearTimeout(t); }, [rows, page]);

  if (!open || !config) return null;

  const toggleSort = (col) => {
    if (!col.sortKey) return;
    if (sort === col.sortKey) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(col.sortKey); setOrder("desc"); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(820px, 97vw)", height: "100%", background: "var(--panel, #0d1411)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", boxShadow: "-20px 0 40px rgba(0,0,0,0.4)" }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "var(--text)" }}>
            {config.title}{rows && <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 13 }}> · {total.toLocaleString()}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {config.exportColumns && (
              <button onClick={doExport} disabled={exporting}
                style={{ background: "linear-gradient(135deg,var(--g1),var(--g2))", border: "none", color: "var(--dark, #0a0f0d)", borderRadius: 8, padding: "5px 12px", cursor: exporting ? "wait" : "pointer", fontSize: 13, fontWeight: 700, opacity: exporting ? 0.7 : 1 }}>
                {exporting ? "Exporting…" : "Export CSV"}
              </button>
            )}
            <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 13 }}>Close</button>
          </div>
        </div>

        {/* Controls */}
        {(config.searchable || config.dateRange || (config.filters && config.filters.length > 1)) && (
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {config.searchable && (
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={config.searchable} style={{ ...ctrl, flex: "1 1 220px", minWidth: 160 }} />
            )}
            {config.dateRange && (
              <>
                <label style={{ fontSize: 11.5, color: "var(--muted)" }}>{config.dateRange.label || "From"}</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={ctrl} />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={ctrl} />
              </>
            )}
            {config.filters && config.filters.length > 1 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {config.filters.map((f, i) => (
                  <button key={i} onClick={() => setActiveFilter(i)}
                    style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                      border: "1px solid var(--border)",
                      background: activeFilter === i ? "linear-gradient(135deg,var(--g1),var(--g2))" : "transparent",
                      color: activeFilter === i ? "var(--dark, #0a0f0d)" : "var(--muted)" }}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rows */}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div ref={scrollRef} onScroll={updateFade} style={{ height: "100%", overflowY: "auto", overflowX: "auto", padding: "8px 14px", WebkitOverflowScrolling: "touch" }}>
            {err && <div style={{ color: "#ff6b6b", fontSize: 13, marginBottom: 10 }}>{err}</div>}
            {rows === null ? (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>Nothing matches.</div>
            ) : (
              <table style={{ width: "100%", minWidth: "max-content", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {config.columns.map((c) => {
                      const sorted = sort === c.sortKey;
                      return (
                        <th key={c.key} onClick={() => toggleSort(c)}
                          style={{ position: "sticky", top: 0, background: "var(--panel, #0d1411)", textAlign: "left", padding: "8px 10px", color: sorted ? "var(--g1, #00e87a)" : "var(--muted)", fontWeight: 700, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", cursor: c.sortKey ? "pointer" : "default", userSelect: "none" }}>
                          {c.label}
                          {c.sortKey && <span style={{ marginLeft: 6, opacity: sorted ? 1 : 0.4 }}>{sorted ? (order === "asc" ? "↑" : "↓") : "↕"}</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}
                      onClick={config.onRowClick ? () => config.onRowClick(r) : undefined}
                      style={{ cursor: config.onRowClick ? "pointer" : "default", borderBottom: "1px solid var(--border)" }}
                      onMouseEnter={(e) => config.onRowClick && (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                      onMouseLeave={(e) => config.onRowClick && (e.currentTarget.style.background = "transparent")}>
                      {config.columns.map((c) => (
                        <td key={c.key} style={{ padding: "8px 10px", color: "var(--text)", whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.render ? c.render(r) : (r[c.key] ?? "—")}
                        </td>
                      ))}
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

        {/* Pagination */}
        {rows && totalPages > 1 && (
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button disabled={page === 1} onClick={() => goPage(page - 1)} style={pagerBtn(false, page === 1)}>←</button>
              {visiblePages(page, totalPages).map((p, idx) =>
                typeof p === "string"
                  ? <span key={p + idx} style={{ color: "var(--muted)", padding: "0 2px" }}>…</span>
                  : <button key={p} onClick={() => goPage(p)} style={pagerBtn(p === page, false)}>{p}</button>
              )}
              <button disabled={page === totalPages} onClick={() => goPage(page + 1)} style={pagerBtn(false, page === totalPages)}>→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Full detail + plan management for one user. */
function UserDetail({ email, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState("");
  const [days, setDays] = useState("30");

  const load = useCallback(() => {
    setErr("");
    api.get("/ideal/admin/users/detail", { params: { email } })
      .then(({ data }) => { setD(data); setPlan(data.user?.plan || "basic"); })
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load user."));
  }, [email]);
  useEffect(() => { load(); }, [load]);

  const savePlan = async () => {
    setBusy(true); setNote("");
    try {
      const body = { email, plan };
      if (plan !== "basic" && days) body.days = Number(days);
      const { data } = await api.post("/ideal/admin/set-plan", body);
      setNote(`✓ ${data.email} is now ${data.plan}` + (data.current_period_end ? ` until ${fmtDate(data.current_period_end)}` : ""));
      load(); onChanged && onChanged();
    } catch (e) {
      setNote(`✗ ${e?.response?.data?.detail || "Update failed."}`);
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 70, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "5vh 12px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", background: "var(--panel, #0d1411)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, color: "var(--text)", wordBreak: "break-all" }}>{email}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 13 }}>Close</button>
        </div>

        {err && <div style={{ color: "#ff6b6b", fontSize: 13 }}>{err}</div>}
        {!d ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div> : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, fontSize: 12.5, marginBottom: 14 }}>
              {[
                ["Plan", d.user.is_admin ? "Admin" : (d.user.plan || "basic")],
                ["Subscription", d.user.subscription_status || "—"],
                ["Verified", d.user.verified ? "Yes" : "No"],
                ["Registered", fmtDate(d.user.created_at)],
                ["Period end", fmtDate(d.user.current_period_end)],
                ["Manual source", d.user.manual_plan_source || "—"],
                ["Stripe customer", d.user.stripe_customer_id || "—"],
                ["Resumes", (d.resumes || []).length],
              ].map(([k, v]) => (
                <div key={k} style={{ ...card, padding: "8px 10px" }}>
                  <div style={{ color: "var(--muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
                  <div style={{ color: "var(--text)", marginTop: 2, wordBreak: "break-all" }}>{String(v)}</div>
                </div>
              ))}
            </div>

            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700, marginBottom: 10 }}>Change plan</div>
              {d.user.is_admin ? (
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  This is an admin account — unlimited access, not on any plan. Nothing to change.
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={plan} onChange={(e) => setPlan(e.target.value)} style={{ ...ctrl, fontSize: 13 }}>
                      <option value="basic">Free (basic)</option>
                      <option value="pro">Pro</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                    {plan !== "basic" && (
                      <input value={days} onChange={(e) => setDays(e.target.value)} placeholder="days (blank = open-ended)" style={{ ...ctrl, width: 200, fontSize: 13 }} />
                    )}
                    <button onClick={savePlan} disabled={busy} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer", border: "none", background: "linear-gradient(135deg,var(--g1),var(--g2))", color: "var(--dark)", opacity: busy ? 0.7 : 1 }}>
                      {busy ? "Saving…" : "Apply"}
                    </button>
                  </div>
                  {note && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>{note}</div>}
                </>
              )}
            </div>

            <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700, marginBottom: 6 }}>Resumes ({(d.resumes || []).length})</div>
            {(d.resumes || []).length === 0 ? <div style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 12 }}>None.</div> : (
              <div style={{ marginBottom: 14 }}>
                {d.resumes.map((r) => (
                  <div key={r.resume_id} style={{ fontSize: 12.5, color: "var(--text)", padding: "6px 0", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.candidate_name || r.file_name || r.resume_id}</span>
                    <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(r.uploaded_at)}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700, marginBottom: 6 }}>Recent feedback</div>
            {(d.feedback || []).length === 0 ? <div style={{ color: "var(--muted)", fontSize: 12.5 }}>None.</div> : (
              d.feedback.map((f, i) => (
                <div key={i} style={{ fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--g1, #00e87a)", fontWeight: 700 }}>{"★".repeat(Math.max(0, Math.min(5, f.rating || 0)))}</span>
                  {f.comment && <span style={{ color: "var(--muted)", marginLeft: 8 }}>{f.comment}</span>}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminMetrics() {
  const { user } = useAuth();
  const isAdmin = isAdminEmail(user?.sub);

  const [m, setM] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [detailEmail, setDetailEmail] = useState(null);

  const load = useCallback(() => {
    setErr(""); setLoading(true);
    api.get("/ideal/admin/metrics")
      .then(({ data }) => setM(data))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load metrics."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) return null;

  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };
  const sectionTitle = { fontSize: 13, fontWeight: 800, color: "var(--text)", textTransform: "uppercase", letterSpacing: 0.7, margin: "22px 0 10px" };

  // ── Drawer configs ───────────────────────────────────────────────────────
  const userColumns = [
    { key: "email", label: "Email", sortKey: "email" },
    { key: "plan", label: "Plan", sortKey: "plan", render: (r) => (r.is_admin ? "Admin" : (r.plan || "basic")) },
    { key: "verified", label: "Verified", sortKey: "verified", render: (r) => (r.verified ? "Yes" : "No") },
    { key: "resume_count", label: "Resumes", sortKey: "resume_count" },
    { key: "created_at", label: "Joined", sortKey: "created_at", render: (r) => fmtDate(r.created_at) },
  ];
  const usersDrawer = (title, baseParams) => ({
    title, path: "/ideal/admin/users", dataKey: "users", columns: userColumns,
    searchable: "Search email…",
    dateRange: { from: "created_from", to: "created_to", label: "Joined" },
    baseParams,
    onRowClick: (r) => setDetailEmail(r.email),
  });

  const matchColumns = [
    { key: "resume_id", label: "Resume", sortKey: "resume_id" },
    { key: "user_id", label: "User", sortKey: "user_id" },
    { key: "match_count", label: "Jobs" },
    { key: "refresh_count", label: "Refreshes", sortKey: "refresh_count" },
    { key: "updated_at", label: "Updated", sortKey: "updated_at", render: (r) => fmtDate(r.updated_at) },
  ];
  const matchesDrawer = (title, baseParams) => ({
    title, path: "/ideal/admin/job-matches", dataKey: "matches", columns: matchColumns,
    searchable: "Search user / resume…", baseParams,
  });

  const visitorColumns = [
    { key: "email", label: "User", sortKey: "email", render: (r) => r.email || "guest" },
    { key: "location", label: "Location", render: (r) => r.location || (r.ip ? "—" : "") },
    { key: "ip", label: "IP", sortKey: "ip" },
    { key: "path", label: "Path" },
    { key: "hits", label: "Hits", sortKey: "hits" },
    { key: "last_seen", label: "Last seen", sortKey: "last_seen", render: (r) => fmtDate(r.last_seen) },
  ];
  const visitorsDrawer = (title, baseParams) => ({
    title, path: "/ideal/admin/visitors", dataKey: "visitors", columns: visitorColumns,
    searchable: "Search email / IP / path…", baseParams,
  });

  const resumeColumns = [
    { key: "candidate_name", label: "Name", sortKey: "candidate_name", render: (r) => r.candidate_name || r.file_name || "—" },
    { key: "user_id", label: "User", sortKey: "user_id" },
    { key: "has_embedding", label: "Embedded", sortKey: "has_embedding", render: (r) => (r.has_embedding ? "Yes" : "No") },
    { key: "uploaded_at", label: "Uploaded", sortKey: "uploaded_at", render: (r) => fmtDate(r.uploaded_at) },
  ];
  const resumesDrawer = (title, baseParams) => ({
    title, path: "/ideal/admin/resumes", dataKey: "resumes", columns: resumeColumns,
    searchable: "Search user / file / name…",
    dateRange: { from: "created_from", to: "created_to", label: "Uploaded" },
    baseParams,
  });

  const feedbackColumns = [
    { key: "rating", label: "Rating", sortKey: "rating", render: (r) => "★".repeat(Math.max(0, Math.min(5, r.rating || 0))) },
    { key: "email", label: "User", sortKey: "email" },
    { key: "comment", label: "Comment" },
    { key: "source", label: "Source", sortKey: "source" },
    { key: "created_at", label: "When", sortKey: "created_at", render: (r) => fmtDate(r.created_at) },
  ];

  // Jobs pool: on-screen table columns (truncated, friendly) ...
  const jobColumns = [
    { key: "title", label: "Title", sortKey: "title", render: (r) => r.title || r.standardizedTitle || "—" },
    { key: "companyName", label: "Company", sortKey: "companyName", render: (r) => r.companyName || "—" },
    { key: "location", label: "Location", sortKey: "location", render: (r) => r.location || "—" },
    { key: "jobPostedLanguage", label: "Lang", sortKey: "jobPostedLanguage", render: (r) => (r.jobPostedLanguage || "—").toUpperCase() },
    { key: "postedAt", label: "Posted", sortKey: "postedAt", render: (r) => fmtDate(r.postedAt) },
    { key: "expireAt", label: "Expires", sortKey: "expireAt", render: (r) => fmtDate(r.expireAt) },
    { key: "link", label: "Link", render: (r) => r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--g1, #00e87a)" }}>open</a> : "—" },
  ];
  // ... and the FULL set written to CSV (raw values, incl. job_id + full link).
  const jobExportColumns = [
    { label: "Job ID", value: (r) => r.job_id },
    { label: "Title", value: (r) => r.title || r.standardizedTitle || "" },
    { label: "Standardized title", value: (r) => r.standardizedTitle || "" },
    { label: "Company", value: (r) => r.companyName || "" },
    { label: "Location", value: (r) => r.location || "" },
    { label: "Language", value: (r) => r.jobPostedLanguage || "" },
    { label: "Posted at", value: (r) => r.postedAt || "" },
    { label: "Expires at", value: (r) => r.expireAt || "" },
    { label: "Link", value: (r) => r.link || "" },
  ];
  const jobsDrawer = {
    title: "Jobs in pool",
    path: "/ideal/admin/jobs",
    dataKey: "jobs",
    columns: jobColumns,
    exportColumns: jobExportColumns,
    searchable: "Search title / company / location…",
    dateRange: { from: "posted_from", to: "posted_to", label: "Posted" },
    baseParams: {},
    filters: [
      { label: "All", params: {} },
      { label: "Active", params: { expiry: "active" } },
      { label: "Expired", params: { expiry: "expired" } },
    ],
  };

  return (
    <div style={{ width: "100%", fontFamily: "var(--font-body)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{m?.generated_at ? `Updated ${new Date(m.generated_at).toLocaleTimeString()}` : "\u00A0"}</div>
        <button onClick={load} disabled={loading} style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: loading ? "wait" : "pointer", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err && <div style={{ color: "#ff6b6b", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {m === null ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div> : (
        <>
          <div style={sectionTitle}>Jobs</div>
          <div style={grid}>
            <StatCard label="Matched today" value={(m.jobs.matched_results_today ?? 0).toLocaleString()} sub={`${(m.jobs.matches_today ?? 0).toLocaleString()} resumes matched today`} accent="var(--g1, #00e87a)"
              onClick={() => setDrawer(matchesDrawer("Match runs today", { segment: "today" }))} />
            <StatCard label="Match runs (all time)" value={(m.jobs.matches_total ?? 0).toLocaleString()}
              onClick={() => setDrawer(matchesDrawer("All match runs", {}))} />
            <StatCard label="Jobs in pool" value={(m.jobs.raw_jobs_total ?? 0).toLocaleString()} sub="crawler-imported · tap to browse" onClick={() => setDrawer(jobsDrawer)} />
          </div>

          <div style={sectionTitle}>Users</div>
          <div style={grid}>
            <StatCard label="Free" value={(m.users.free ?? 0).toLocaleString()} onClick={() => setDrawer(usersDrawer("Free users", { plan: "basic" }))} />
            <StatCard label="Pro" value={(m.users.pro ?? 0).toLocaleString()} accent="var(--g1, #00e87a)" onClick={() => setDrawer(usersDrawer("Pro users", { plan: "pro" }))} />
            <StatCard label="Enterprise" value={(m.users.enterprise ?? 0).toLocaleString()} accent="var(--g2, #00c9ff)" onClick={() => setDrawer(usersDrawer("Enterprise users", { plan: "enterprise" }))} />
            <StatCard label="Total" value={(m.users.total ?? 0).toLocaleString()} sub={`${(m.users.verified ?? 0).toLocaleString()} verified · +${(m.users.registered_today ?? 0).toLocaleString()} today${m.users.admins ? ` · ${m.users.admins} admin${m.users.admins > 1 ? "s" : ""} excluded` : ""}`}
              onClick={() => setDrawer({ ...usersDrawer("All users", {}), filters: [
                { label: "All", params: {} },
                { label: "Verified", params: { segment: "verified" } },
                { label: "Unverified", params: { segment: "unverified" } },
                { label: "Joined today", params: { segment: "registered_today" } },
              ] })} />
          </div>
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700, marginBottom: 10 }}>Registrations · last 14 days</div>
            <TrendBars data={m.users.registrations_by_day} />
          </div>

          <div style={sectionTitle}>Visitors</div>
          <div style={grid}>
            <StatCard label="Active now" value={(m.visitors?.active_now?.active_sessions ?? 0).toLocaleString()} sub={`${m.visitors?.active_now?.logged_in_users ?? 0} logged in · last 5 min`} accent="var(--g1, #00e87a)"
              onClick={() => setDrawer(visitorsDrawer("Active visitors (5 min)", { window_minutes: 5 }))} />
            <StatCard label="Visitors today" value={(m.visitors?.today?.sessions ?? 0).toLocaleString()} sub={`${m.visitors?.today?.unique_ips ?? 0} unique IPs · rolling 24h`}
              onClick={() => setDrawer(visitorsDrawer("Visitors (24h)", { window_minutes: 1440 }))} />
            <StatCard label="Logged-in today" value={(m.visitors?.today?.logged_in_users ?? 0).toLocaleString()} sub="rolling 24h" />
          </div>

          <div style={sectionTitle}>Resumes</div>
          <div style={grid}>
            <StatCard label="Total" value={(m.resumes.total ?? 0).toLocaleString()} onClick={() => setDrawer(resumesDrawer("All resumes", {}))} />
            <StatCard label="Embedded" value={(m.resumes.embedded ?? 0).toLocaleString()} sub={`${(m.resumes.embeddings_cached ?? 0).toLocaleString()} unique cached`} accent="var(--g1, #00e87a)"
              onClick={() => setDrawer(resumesDrawer("Embedded resumes", { segment: "embedded" }))} />
            <StatCard label="Uploaded today" value={(m.resumes.uploaded_today ?? 0).toLocaleString()}
              onClick={() => setDrawer(resumesDrawer("Resumes uploaded today", { segment: "uploaded_today" }))} />
          </div>

          <div style={sectionTitle}>Feedback</div>
          <div style={grid}>
            <StatCard label="Total" value={(m.feedback.total ?? 0).toLocaleString()} sub={`+${m.feedback.today ?? 0} today`}
              onClick={() => setDrawer({
                title: "All feedback", path: "/ideal/admin/feedback", dataKey: "feedback", columns: feedbackColumns,
                searchable: "Search email / comment…",
                dateRange: { from: "created_from", to: "created_to", label: "Date" },
                baseParams: {},
                filters: [
                  { label: "All", params: {} },
                  { label: "4★ +", params: { min_rating: 4 } },
                  { label: "3★ +", params: { min_rating: 3 } },
                ],
              })} />
            <StatCard label="Avg rating" value={m.feedback.avg_rating != null ? `${m.feedback.avg_rating} / 5` : "—"} accent="var(--g1, #00e87a)" />
          </div>
        </>
      )}

      <Drawer open={!!drawer} config={drawer} onClose={() => setDrawer(null)} />
      {detailEmail && <UserDetail email={detailEmail} onClose={() => setDetailEmail(null)} onChanged={load} />}
    </div>
  );
}