import { useState, useEffect, useCallback, useRef } from "react";
import api from "../components/api";
import { useAuth } from "../context/AuthContext";
import { isAdminEmail } from "../components/IdealAdminPanel";
import AIApplicationModalPreview from "../components/AIApplicationModel";

// Mirror ResumeFilterModal exactly so batch filters use values the backend's
// geocoding/language logic actually recognizes.
const NL_CITIES = [
  "Amsterdam", "Rotterdam", "Utrecht", "The Hague", "Eindhoven", "Groningen",
  "Tilburg", "Breda", "Nijmegen", "Leiden", "Remote",
];
const RADIUS_STEPS = [10, 20, 50, 100, 200];
const EXPIRY_PRESETS = [
  { label: "2 days", value: 2 }, { label: "7 days", value: 7 },
  { label: "14 days", value: 14 }, { label: "30 days", value: 30 },
  { label: "60 days", value: 60 }, { label: "All", value: 999 },
];
const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" }, { label: "Dutch", value: "nl" },
  { label: "Both (EN + NL)", value: "both" },
];
const JOBS_PER_RESUME_OPTIONS = [10, 25, 50, 75, 100];
const RESULTS_PER_PAGE = 25;

/**
 * BatchPanel — enterprise batch job UI.
 *
 * Matches existing dashboard conventions:
 *   - uses the shared `api` axios instance (token interceptor handles auth)
 *   - dark theme / tailwind classes consistent with Sidebar + dashboard
 *   - rendered by Dashboard when activePage === "Batch"
 *
 * Flow for the user:
 *   1. Pick resumes (multi-select from their existing resumes)
 *   2. Choose a schedule (run once / every N hours / daily at hour)
 *   3. Create -> backend runs it; user can also "Run now"
 *   4. Results table shows the latest run per resume, newest on top
 *
 * ADMIN MODE: pass admin={true} (gate on isAdminEmail in Dashboard, same as
 * your other admin panels). In admin mode the panel lists EVERY org's batches
 * via /batch/admin/all and reads results via /batch/admin/{id}/results, and
 * shows an Org column. The create form is hidden — admins observe, they don't
 * create batches on behalf of orgs.
 */
export default function BatchPanel({ admin = false }) {
  const [resumes, setResumes] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selected, setSelected] = useState([]);
  // Per-resume candidate name the user can set for this batch (keyed by id).
  const [candidateNames, setCandidateNames] = useState({});
  const [name, setName] = useState("");
  const [schedType, setSchedType] = useState("once");
  const [interval, setIntervalH] = useState(24);
  const [dailyHour, setDailyHour] = useState(3);
  // Filters — dropdowns mirroring ResumeFilterModal so values always match the
  // backend's known geocodes/languages (free text was silently dropping all jobs).
  const [fLanguage, setFLanguage] = useState("en");      // "en" | "nl" | "both"
  const [fCity, setFCity] = useState("Any");             // "Any" | NL city | "Remote"
  const [fRadiusIdx, setFRadiusIdx] = useState(1);       // index into RADIUS_STEPS
  const [fExpiry, setFExpiry] = useState(999);           // 999 = All
  const [maxJobs, setMaxJobs] = useState(25);            // jobs scored per resume
  const [resultPage, setResultPage] = useState(0);       // results pagination
  const [editingId, setEditingId] = useState(null);   // batch being edited
  const resultsRef = useRef(null);
  const [activeBatch, setActiveBatch] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState(null);

  // ── Role gate for the new Analysis / Align actions ──────────────────────
  // Per requirement: admins, team (contributors) AND enterprise users may use
  // Analysis + Align. The Batch tab itself is already restricted to exactly
  // these roles in the Sidebar, so this is a belt-and-braces guard.
  const { user, plan } = useAuth();
  const [isContributor, setIsContributor] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get("/team/check")
      .then((r) => { if (alive) setIsContributor(Boolean(r.data?.is_contributor)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user?.sub]);
  const canApply =
    isAdminEmail(user?.sub) || isContributor || plan === "enterprise";
  // Align opens the optimize modal for a specific resume's owner — that only
  // makes sense in a user's OWN batch view. The admin "all orgs" view is
  // read-only observation across other people's orgs, so Align is hidden there
  // (Analysis stays — admins can still inspect strong/weak/gaps).
  const showAlign = canApply && !admin;

  // Analysis popover: which flattened row's strong/weak/gaps is open (null = none).
  const [analysisRow, setAnalysisRow] = useState(null);
  // Align modal: holds {job, activeResume} built from a batch row, or null.
  const [alignTarget, setAlignTarget] = useState(null);

  // ── Admin-only operational metrics ──────────────────────────────────────
  const loadOverview = useCallback(async () => {
    if (!admin) return;
    try {
      const { data } = await api.get("/batch/admin/overview");
      setOverview(data);
    } catch { /* ignore */ }
  }, [admin]);

  // ── Load the user's resumes + existing batches ──────────────────────────
  const loadResumes = useCallback(async () => {
    try {
      const { data } = await api.get("/resumes");
      setResumes(data?.resumes || data || []);
    } catch { /* surfaced by interceptor */ }
  }, []);

  const loadBatches = useCallback(async () => {
    try {
      const { data } = await api.get(admin ? "/batch/admin/all" : "/batch");
      setBatches(data || []);
    } catch { /* ignore */ }
  }, [admin]);

  useEffect(() => {
    if (!admin) loadResumes();
    loadBatches();
    loadOverview();
  }, [admin, loadResumes, loadBatches, loadOverview]);

  // ── Build the schedule spec the backend expects ─────────────────────────
  const buildSchedule = () => {
    if (schedType === "interval") return { type: "interval", hours: Number(interval) };
    if (schedType === "daily")    return { type: "daily", hour: Number(dailyHour) };
    return { type: "once" };
  };

  // Map dropdown selections to the backend filter shape (matching how
  // ResumeFilterModal transforms: Remote -> remote_only, All expiry -> no filter,
  // "both" languages -> [en, nl], "Any" city -> no location filter).
  const buildFilters = () => {
    const f = {};
    if (fLanguage === "both") f.languages = ["en", "nl"];
    else f.languages = [fLanguage];

    if (fCity === "Remote") {
      f.remote_only = true;
    } else if (fCity && fCity !== "Any") {
      f.location = fCity;
      f.radius_km = RADIUS_STEPS[fRadiusIdx];
    }

    if (fExpiry !== 999) f.expiry_days = fExpiry;
    return f;
  };

  const toggleResume = (id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    // Prefill the name field from the resume's existing candidate_name / file_name.
    setCandidateNames((prev) => {
      if (prev[id] !== undefined) return prev;
      const r = resumes.find((x) => (x.resume_id || x.id) === id);
      const guess =
        (r?.candidate_name && r.candidate_name.trim()) ||
        (r?.file_name ? r.file_name.replace(/\.[^.]+$/, "") : "") || "";
      return { ...prev, [id]: guess };
    });
  };

  const setCandidateName = (id, val) =>
    setCandidateNames((prev) => ({ ...prev, [id]: val }));

  const createBatch = async () => {
    if (!name.trim() || selected.length === 0) return;
    setBusy(true);
    try {
      await api.post("/batch", {
        name: name.trim(),
        resume_ids: selected,
        candidate_names: selected.reduce((acc, id) => {
          const v = (candidateNames[id] || "").trim();
          if (v) acc[id] = v;
          return acc;
        }, {}),
        max_jobs_per_resume: maxJobs,
        filters: buildFilters(),
        schedule: buildSchedule(),
      });
      setName(""); setSelected([]); setCandidateNames({});
      await loadBatches();
    } finally { setBusy(false); }
  };

  // Open the edit form for a batch — preload its current filters into the inputs.
  const startEdit = (b) => {
    const f = b.filters || {};
    setEditingId(b.batch_id);
    // languages: [en,nl] -> "both", else single
    if (Array.isArray(f.languages) && f.languages.length > 1) setFLanguage("both");
    else if (Array.isArray(f.languages) && f.languages[0]) setFLanguage(f.languages[0]);
    else setFLanguage("en");
    // city / remote
    if (f.remote_only) setFCity("Remote");
    else if (f.location) setFCity(f.location);
    else setFCity("Any");
    // radius -> nearest preset index
    const ri = RADIUS_STEPS.indexOf(f.radius_km);
    setFRadiusIdx(ri >= 0 ? ri : 1);
    // expiry
    setFExpiry(f.expiry_days || 999);
    setMaxJobs(b.max_jobs_per_resume || 25);
  };

  // Save edited filters to an existing batch, then optionally re-run it now.
  const saveEdit = async (batch_id, rerun) => {
    setBusy(true);
    try {
      await api.post(`/batch/${batch_id}/update`, {
        filters: buildFilters(),
        max_jobs_per_resume: maxJobs,
      });
      if (rerun) await api.post(`/batch/${batch_id}/run-now`);
      setEditingId(null);
      await loadBatches();
    } finally { setBusy(false); }
  };

  const runNow = async (batch_id) => {
    setBusy(true);
    try { await api.post(`/batch/${batch_id}/run-now`); await loadBatches(); }
    finally { setBusy(false); }
  };

  const togglePause = async (batch_id) => {
    await api.post(`/batch/${batch_id}/pause`);
    await loadBatches();
  };

  const viewResults = async (batch) => {
    setActiveBatch(batch); setLoading(true); setResults([]); setResultPage(0);
    try {
      const url = admin
        ? `/batch/admin/${batch.batch_id}/results`
        : `/batch/${batch.batch_id}/results`;
      const { data } = await api.get(url);
      setResults(data?.results || []);
      // Bring the results panel into view so it reads as "opening results",
      // not expanding the list in place.
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } finally { setLoading(false); }
  };

  const scoreColor = (s) =>
    s >= 65 ? "#00e87a" : s >= 35 ? "#facc15" : "#f87171";

  // Build the exact {job, activeResume} shape AIApplicationModalPreview reads
  // (job.id, job.match, job.interview_probability, job.title/company/location/
  // link/expiry/job_language; activeResume.id, activeResume.name) from a batch
  // row, then open the same modal the Dashboard uses. The job was bridged into
  // the resume's job_matches at batch time, so optimize/cover/motivation resolve.
  const openAlign = (m) => {
    if (!m || m.empty || !m.resume_id || !m.job_id) return;
    setAlignTarget({
      job: {
        id:                    m.job_id,
        title:                 m.title,
        company:               m.company,
        location:              m.location || "",
        link:                  m.link || "",
        match:                 m.score,
        interview_probability: m.interview_probability,
        expiry:                m.expiry || null,
        job_language:          m.job_language || "English",
      },
      activeResume: { id: m.resume_id, name: m.candidate },
    });
  };

  // Flatten results into rows (one per candidate-job), keeping candidates with
  // zero matches visible so it's clear they were processed but matched nothing.
  const flatRows = () => {
    const rows = [];
    (results || []).forEach((r) => {
      const cand = r.candidate || r.resume_id;
      const rid  = r.resume_id;
      const matches = r.matches || [];
      if (matches.length === 0 || (matches[0] && matches[0].error)) {
        rows.push({
          candidate: cand, resume_id: rid,
          title: matches[0]?.error ? "(error)" : "(no matches)",
          company: "", score: "", interview_probability: "",
          missing_keywords: [], link: "", empty: true,
        });
      } else {
        matches.forEach((m) => rows.push({ candidate: cand, resume_id: rid, ...m }));
      }
    });
    return rows;
  };

  const downloadCsv = () => {
    const rows = flatRows();
    const header = ["Candidate", "Job", "Company", "ATS", "Interview",
                    "Strong", "Weak", "Gaps", "Link"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    rows.forEach((r) => {
      // Same grouping as the on-screen Analysis popover so the file matches it:
      //   Strong = demonstrated skills + matched keywords
      //   Weak   = partial skills
      //   Gaps   = missing skills + missing keywords
      const strong = [...(r.strong_skills || []), ...(r.matched_keywords || [])];
      const weak   = [...(r.weak_skills || [])];
      const gaps   = [...(r.missing_skills || []), ...(r.missing_keywords || [])];
      lines.push([
        r.candidate, r.title, r.company, r.score, r.interview_probability,
        strong.join("; "), weak.join("; "), gaps.join("; "), r.link,
      ].map(esc).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch-${(activeBatch?.name || "results").replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto p-6 text-gray-200">
      <h1 className="text-xl font-semibold mb-1">
        {admin ? "Batch Jobs — All Organizations" : "Batch Job Runner"}
      </h1>
      <p className="text-sm text-gray-400 mb-6">
        {admin
          ? "Read-only view of every org's batch jobs and their latest results."
          : "Select resumes, schedule a run, and the system matches each against live jobs in the background. Come back any time to see the latest results."}
      </p>

      {/* ── Admin operational metrics ─────────────────────────────────── */}
      {admin && overview && (
        <div className="mb-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {[
              ["Total batches", overview.total_batches],
              ["Users with batches", overview.distinct_users],
              ["Users running now", overview.active_users],
              ["Resumes enrolled", overview.total_resumes_enrolled],
              ["Total runs fired", overview.total_runs],
            ].map(([label, val]) => (
              <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-2xl font-bold text-white">{val ?? 0}</p>
                <p className="text-[11px] text-gray-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mb-4 text-[11px]">
            <span className="px-2 py-1 rounded-full bg-green-600/30 text-green-300">
              {overview.status_counts?.active || 0} active
            </span>
            <span className="px-2 py-1 rounded-full bg-yellow-600/30 text-yellow-300">
              {overview.status_counts?.paused || 0} paused
            </span>
            <span className="px-2 py-1 rounded-full bg-gray-600/30 text-gray-300">
              {overview.status_counts?.completed || 0} completed
            </span>
          </div>

          {/* Per-user breakdown — who is actually running batches */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold mb-3 text-white">
              Users running batches
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500">
                  <tr className="text-left">
                    <th className="py-1 pr-4">User</th>
                    <th className="py-1 pr-4">Batches</th>
                    <th className="py-1 pr-4">Active</th>
                    <th className="py-1 pr-4">Resumes</th>
                    <th className="py-1">Last run</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview.per_user || []).map((u) => (
                    <tr key={u.org_id} className="border-t border-gray-800">
                      <td className="py-1.5 pr-4 text-cyan-400">{u.org_id}</td>
                      <td className="py-1.5 pr-4">{u.total_batches}</td>
                      <td className="py-1.5 pr-4">{u.active}</td>
                      <td className="py-1.5 pr-4">{u.resumes_enrolled}</td>
                      <td className="py-1.5 text-gray-400">
                        {u.last_run ? new Date(u.last_run).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {(overview.per_user || []).length === 0 && (
                    <tr><td colSpan={5} className="py-2 text-gray-500">
                      No users have created batches yet.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className={admin ? "" : "grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-stretch"}>
        {/* ── Create panel (hidden for admins — they observe, not create) ── */}
        {!admin && (
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 max-h-[75vh] overflow-y-auto lg:h-[75vh]">
          <h2 className="text-sm font-semibold mb-3 text-white">New batch</h2>

          <label className="block text-xs text-gray-400 mb-1">Batch name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Backend candidates — Amsterdam"
            className="w-full mb-4 bg-gray-800 rounded px-3 py-2 text-sm outline-none"
          />

          <label className="block text-xs text-gray-400 mb-1">
            Resumes ({selected.length} selected) — set a candidate name for each
          </label>
          <div className="max-h-56 overflow-y-auto mb-4 border border-gray-800 rounded">
            {resumes.length === 0 && (
              <p className="text-xs text-gray-500 p-3">No resumes uploaded yet.</p>
            )}
            {resumes.map((r) => {
              const id = r.resume_id || r.id;
              const label = r.candidate_name || r.file_name || r.name || id;
              const isSel = selected.includes(id);
              return (
                <div key={id} className="border-b border-gray-800 last:border-b-0">
                  <div
                    onClick={() => toggleResume(id)}
                    className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-800 ${
                      isSel ? "bg-gray-800" : ""
                    }`}
                  >
                    <input type="checkbox" readOnly checked={isSel} />
                    <span className="truncate">{label}</span>
                  </div>
                  {isSel && (
                    <div className="px-3 pb-2 pt-0">
                      <input
                        value={candidateNames[id] ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setCandidateName(id, e.target.value)}
                        placeholder="Candidate name (shown in results)"
                        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs outline-none"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <label className="block text-xs text-gray-400 mb-1">
            Filters <span className="text-gray-600">(select to narrow — defaults match everything)</span>
          </label>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <span className="block text-[10px] text-gray-500 mb-1">Language</span>
              <select value={fLanguage} onChange={(e) => setFLanguage(e.target.value)}
                className="w-full bg-gray-800 rounded px-3 py-2 text-sm outline-none">
                {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <span className="block text-[10px] text-gray-500 mb-1">Location</span>
              <select value={fCity} onChange={(e) => setFCity(e.target.value)}
                className="w-full bg-gray-800 rounded px-3 py-2 text-sm outline-none">
                <option value="Any">Any location</option>
                {NL_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <span className="block text-[10px] text-gray-500 mb-1">
                Radius {fCity !== "Any" && fCity !== "Remote" ? `(${RADIUS_STEPS[fRadiusIdx]} km)` : ""}
              </span>
              <select value={fRadiusIdx}
                disabled={fCity === "Any" || fCity === "Remote"}
                onChange={(e) => setFRadiusIdx(Number(e.target.value))}
                className="w-full bg-gray-800 rounded px-3 py-2 text-sm outline-none disabled:opacity-40">
                {RADIUS_STEPS.map((r, i) => <option key={r} value={i}>{r} km</option>)}
              </select>
            </div>
            <div>
              <span className="block text-[10px] text-gray-500 mb-1">Posted within</span>
              <select value={fExpiry} onChange={(e) => setFExpiry(Number(e.target.value))}
                className="w-full bg-gray-800 rounded px-3 py-2 text-sm outline-none">
                {EXPIRY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <label className="block text-xs text-gray-400 mb-1">
            Jobs to match per candidate
            <span className="text-gray-600"> (more = deeper search, higher cost)</span>
          </label>
          <select value={maxJobs} onChange={(e) => setMaxJobs(Number(e.target.value))}
            className="w-full mb-4 bg-gray-800 rounded px-3 py-2 text-sm outline-none">
            {JOBS_PER_RESUME_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} jobs</option>
            ))}
          </select>

          <label className="block text-xs text-gray-400 mb-1">Schedule</label>
          <select
            value={schedType}
            onChange={(e) => setSchedType(e.target.value)}
            className="w-full mb-3 bg-gray-800 rounded px-3 py-2 text-sm outline-none"
          >
            <option value="once">Run once now</option>
            <option value="interval">Every N hours</option>
            <option value="daily">Daily at a set hour</option>
          </select>

          {schedType === "interval" && (
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">Every (hours)</label>
              <input
                type="number" min="1" value={interval}
                onChange={(e) => setIntervalH(e.target.value)}
                className="w-full bg-gray-800 rounded px-3 py-2 text-sm outline-none"
              />
            </div>
          )}
          {schedType === "daily" && (
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">
                Hour (0–23, UTC — pick off-peak like 3)
              </label>
              <input
                type="number" min="0" max="23" value={dailyHour}
                onChange={(e) => setDailyHour(e.target.value)}
                className="w-full bg-gray-800 rounded px-3 py-2 text-sm outline-none"
              />
            </div>
          )}

          <button
            onClick={createBatch}
            disabled={busy || !name.trim() || selected.length === 0}
            className="w-full mt-2 py-2 rounded text-sm font-semibold disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#00e87a,#00c9ff)", color: "#0a0f0d" }}
          >
            {busy ? "Working…" : "Create batch"}
          </button>
        </div>
        )}

        {/* ── Existing batches ─────────────────────────────────────────── */}
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 flex flex-col max-h-[75vh] lg:h-[75vh]">
          <h2 className="text-sm font-semibold mb-3 text-white shrink-0">
            {admin ? "All batches" : "Your batches"}
          </h2>
          {batches.length === 0 && (
            <p className="text-xs text-gray-500">No batches yet.</p>
          )}
          <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
            {batches.map((b) => (
              <div key={b.batch_id} className="border border-gray-800 rounded p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{b.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    b.status === "active" ? "bg-green-600/30 text-green-300"
                    : b.status === "completed" ? "bg-gray-600/30 text-gray-300"
                    : "bg-yellow-600/30 text-yellow-300"
                  }`}>{b.status}</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  {admin && b.org_id && (
                    <span className="text-cyan-400">{b.org_id} · </span>
                  )}
                  {b.resume_ids?.length || 0} resume(s) ·{" "}
                  {b.schedule?.type === "once" ? "one-off"
                    : b.schedule?.type === "interval" ? `every ${b.schedule.hours}h`
                    : `daily @ ${b.schedule?.hour}:00`}
                  {b.last_run && ` · last run ${new Date(b.last_run).toLocaleString()}`}
                </p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  <button onClick={() => viewResults(b)}
                    className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
                    View results
                  </button>
                  {!admin && (
                    <button onClick={() => runNow(b.batch_id)} disabled={busy}
                      className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40">
                      Run now
                    </button>
                  )}
                  {!admin && (
                    <button onClick={() => (editingId === b.batch_id ? setEditingId(null) : startEdit(b))}
                      className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
                      {editingId === b.batch_id ? "Close" : "Edit filters"}
                    </button>
                  )}
                  {!admin && b.status !== "completed" && (
                    <button onClick={() => togglePause(b.batch_id)}
                      className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
                      {b.status === "active" ? "Pause" : "Resume"}
                    </button>
                  )}
                </div>

                {/* Inline filter editor — change filters, keep the same resumes,
                    save and optionally re-run immediately. */}
                {!admin && editingId === b.batch_id && (
                  <div className="mt-3 p-3 rounded bg-gray-950 border border-gray-800">
                    <p className="text-[11px] text-gray-400 mb-2">
                      Edit filters for this batch (same resumes), then save or re-run.
                    </p>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <select value={fLanguage} onChange={(e) => setFLanguage(e.target.value)}
                        className="bg-gray-800 rounded px-2 py-1.5 text-xs outline-none">
                        {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <select value={fCity} onChange={(e) => setFCity(e.target.value)}
                        className="bg-gray-800 rounded px-2 py-1.5 text-xs outline-none">
                        <option value="Any">Any location</option>
                        {NL_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={fRadiusIdx}
                        disabled={fCity === "Any" || fCity === "Remote"}
                        onChange={(e) => setFRadiusIdx(Number(e.target.value))}
                        className="bg-gray-800 rounded px-2 py-1.5 text-xs outline-none disabled:opacity-40">
                        {RADIUS_STEPS.map((r, i) => <option key={r} value={i}>{r} km</option>)}
                      </select>
                      <select value={fExpiry} onChange={(e) => setFExpiry(Number(e.target.value))}
                        className="bg-gray-800 rounded px-2 py-1.5 text-xs outline-none">
                        {EXPIRY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                      <select value={maxJobs} onChange={(e) => setMaxJobs(Number(e.target.value))}
                        className="bg-gray-800 rounded px-2 py-1.5 text-xs outline-none">
                        {JOBS_PER_RESUME_OPTIONS.map((n) => <option key={n} value={n}>{n} jobs/candidate</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(b.batch_id, false)} disabled={busy}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40">
                        Save filters
                      </button>
                      <button onClick={() => saveEdit(b.batch_id, true)} disabled={busy}
                        className="text-xs px-3 py-1 rounded font-semibold disabled:opacity-40"
                        style={{ background: "linear-gradient(135deg,#00e87a,#00c9ff)", color: "#0a0f0d" }}>
                        Save &amp; run now
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {activeBatch && (
        <div ref={resultsRef} className="mt-6 bg-gray-900 rounded-xl p-5 border-2 border-cyan-500/30 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">
              Results — {activeBatch.name}
              {admin && activeBatch.org_id && (
                <span className="text-cyan-400 ml-2 font-normal">({activeBatch.org_id})</span>
              )}
              {!loading && results.length > 0 && (
                <span className="text-gray-500 ml-2 font-normal text-xs">
                  · {results.length} candidate(s), {flatRows().filter((r) => !r.empty).length} match(es)
                </span>
              )}
            </h2>
            <button onClick={() => setActiveBatch(null)}
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">
              ✕ Close
            </button>
          </div>
          {loading && <p className="text-xs text-gray-500">Loading…</p>}
          {!loading && results.length === 0 && (
            <p className="text-xs text-gray-500">
              No results yet. If the batch was just created, the scheduler runs it
              within a minute — check back shortly.
            </p>
          )}
          {!loading && results.length > 0 && (
          <div>
            {(() => {
              const note = flatRows().find((r) => r._filter_note)?._filter_note;
              return note ? (
                <div className="mb-3 text-[11px] text-yellow-300 bg-yellow-600/15 border border-yellow-600/30 rounded px-3 py-2">
                  ⚠ {note}
                </div>
              ) : null;
            })()}
            <div className="flex justify-end mb-2">
              <button onClick={downloadCsv}
                className="text-xs px-3 py-1.5 rounded font-semibold"
                style={{ background: "linear-gradient(135deg,#00e87a,#00c9ff)", color: "#0a0f0d" }}>
                ⬇ Download CSV
              </button>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[55vh] border border-gray-800 rounded">
              <table className="w-full text-xs">
                <thead className="text-gray-500 sticky top-0 bg-gray-900 z-10">
                  <tr className="text-left">
                    <th className="py-2 px-3">Candidate</th>
                    <th className="py-2 px-3">Job</th>
                    <th className="py-2 px-3">Company</th>
                    <th className="py-2 px-3">ATS</th>
                    <th className="py-2 px-3">Interview</th>
                    <th className="py-2 px-3">Analysis</th>
                    {showAlign && <th className="py-2 px-3">Align</th>}
                  </tr>
                </thead>
                <tbody>
                  {flatRows()
                    .slice(resultPage * RESULTS_PER_PAGE, (resultPage + 1) * RESULTS_PER_PAGE)
                    .map((m, i) => (
                    <tr key={i} className="border-t border-gray-800">
                      <td className="py-1.5 px-3 text-cyan-400 font-medium">{m.candidate}</td>
                      <td className="py-1.5 px-3">
                        {m.empty ? <span className="text-gray-600 italic">{m.title}</span>
                          : m.link ? <a href={m.link} target="_blank" rel="noreferrer"
                            className="text-gray-200 hover:underline">{m.title}</a> : m.title}
                      </td>
                      <td className="py-1.5 px-3 text-gray-400">{m.company}</td>
                      <td className="py-1.5 px-3 font-semibold"
                        style={{ color: m.empty ? "#6b7280" : scoreColor(m.score) }}>
                        {m.empty ? "—" : `${m.score}%`}
                      </td>
                      <td className="py-1.5 px-3">{m.interview_probability || "—"}</td>
                      <td className="py-1.5 px-3">
                        {m.empty ? <span className="text-gray-600">—</span> : (
                          <button
                            onClick={() => setAnalysisRow(m)}
                            className="text-cyan-400 hover:underline">
                            view
                          </button>
                        )}
                      </td>
                      {showAlign && (
                        <td className="py-1.5 px-3">
                          {m.empty ? <span className="text-gray-600">—</span> : (
                            <button
                              onClick={() => openAlign(m)}
                              className="text-emerald-400 hover:underline font-medium">
                              align
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {(() => {
              const total = flatRows().length;
              const pages = Math.ceil(total / RESULTS_PER_PAGE);
              if (pages <= 1) return (
                <p className="text-[11px] text-gray-500 mt-2">{total} row(s)</p>
              );
              const cur = Math.min(resultPage, pages - 1);
              return (
                <div className="flex items-center justify-between mt-3 text-xs">
                  <span className="text-gray-500">
                    Showing {cur * RESULTS_PER_PAGE + 1}–{Math.min((cur + 1) * RESULTS_PER_PAGE, total)} of {total}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => setResultPage(0)} disabled={cur === 0}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30">«</button>
                    <button onClick={() => setResultPage(cur - 1)} disabled={cur === 0}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30">‹ Prev</button>
                    <span className="px-2 py-1 text-gray-400">Page {cur + 1} / {pages}</span>
                    <button onClick={() => setResultPage(cur + 1)} disabled={cur >= pages - 1}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30">Next ›</button>
                    <button onClick={() => setResultPage(pages - 1)} disabled={cur >= pages - 1}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30">»</button>
                  </div>
                </div>
              );
            })()}
          </div>
          )}
        </div>
      )}

      {/* ── Analysis popover (strong / weak / gaps) ──────────────────────── */}
      {analysisRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAnalysisRow(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl p-5 shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-sm font-semibold text-white pr-4">
                {analysisRow.title}
              </h3>
              <button onClick={() => setAnalysisRow(null)}
                className="text-gray-400 hover:text-white text-sm">✕</button>
            </div>
            <p className="text-[11px] text-gray-400 mb-4">
              {analysisRow.candidate}
              {analysisRow.company ? ` · ${analysisRow.company}` : ""}
              {" · "}
              <span style={{ color: scoreColor(analysisRow.score) }}>
                ATS {analysisRow.score}%
              </span>
            </p>

            {(() => {
              const Block = ({ label, items, color }) => (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold mb-1" style={{ color }}>
                    {label}
                  </p>
                  {(items && items.length) ? (
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((x, i) => (
                        <span key={i}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-200">
                          {x}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-600 italic">None</p>
                  )}
                </div>
              );
              // "Strong" = skills demonstrated + keywords matched.
              const strong = [
                ...(analysisRow.strong_skills || []),
                ...(analysisRow.matched_keywords || []),
              ];
              return (
                <>
                  <Block label="STRONG (demonstrated)" items={strong} color="#00e87a" />
                  <Block label="WEAK (partial / needs emphasis)"
                    items={analysisRow.weak_skills} color="#facc15" />
                  <Block label="GAPS (missing skills & keywords)"
                    items={[
                      ...(analysisRow.missing_skills || []),
                      ...(analysisRow.missing_keywords || []),
                    ]}
                    color="#f87171" />
                </>
              );
            })()}

            {showAlign && !analysisRow.empty && (
              <button
                onClick={() => { const r = analysisRow; setAnalysisRow(null); openAlign(r); }}
                className="mt-2 w-full text-xs px-3 py-2 rounded font-semibold"
                style={{ background: "linear-gradient(135deg,#00e87a,#00c9ff)", color: "#0a0f0d" }}>
                Align this resume →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Align modal — same component the Dashboard uses ───────────────── */}
      {showAlign && alignTarget && (
        <AIApplicationModalPreview
          isOpen={Boolean(alignTarget)}
          onClose={() => setAlignTarget(null)}
          job={alignTarget.job}
          activeResume={alignTarget.activeResume}
          onUpgradeRequired={() => {}}
          allowRegenerate={false}
          onOptimized={() => {}}
        />
      )}
    </div>
  );
}