/**
 * AIApplicationModalPreview — complete update
 *
 * Changes (this revision):
 * - On any 402/403 quota response from optimize/cover/motivation (or their PDF
 *   routes), we now call onUpgradeRequired(info) so the Dashboard's UpgradeModal
 *   pops instead of showing a raw error. info is parsed from the backend's
 *   { detail: { error, message, ... } } shape.
 * - Regenerate is removed everywhere (sidebar, in-tab, footer, letter preview).
 *   Once an artifact is generated for a job it can only be DOWNLOADED, not
 *   regenerated — this prevents repeat OpenAI calls. Enterprise can still
 *   regenerate (allowRegenerate prop, default false).
 *
 * Earlier changes:
 * - LaTeX section removed from UI
 * - Cover Letter tab: generates + previews + downloads PDF
 * - Motivation Letter tab: generates + previews + downloads PDF
 * - Optimized resume shows gap-filling summary (what was added/strengthened)
 * - Before/after probability level displayed clearly
 */

import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("token")}` };
}

// Parse the backend's quota/upgrade 403 (or 402) into the shape the Dashboard's
// UpgradeModal expects. Returns null if it isn't an upgrade-style error.
function parseUpgrade(status, data) {
  const detail = data?.detail;
  if (
    (status === 403 || status === 402) &&
    detail && typeof detail === "object" &&
    (detail.error === "plan_limit_reached" || detail.error === "plan_upgrade_required")
  ) {
    return {
      kind: detail.error,
      feature: detail.feature || null,
      limit: detail.limit || null,
      currentPlan: detail.current_plan || "basic",
      message: detail.message || "Upgrade to Pro to continue.",
    };
  }
  return null;
}

export default function AIApplicationModalPreview({
  isOpen, onClose, job, activeResume,
  onUpgradeRequired,          // NEW: called with upgrade info on a quota 403
  allowRegenerate = false,    // NEW: only Enterprise passes true
  onOptimized,                // NEW: called after a successful optimization
}) {
  const [activeTab,        setActiveTab]        = useState("Resume");
  const [isGenerating,     setIsGenerating]     = useState(false);
  const [optimizedResume,  setOptimizedResume]  = useState(null);
  const [optimizeResult,   setOptimizeResult]   = useState(null);
  const [isExporting,      setIsExporting]      = useState(false);
  const [language,         setLanguage]         = useState("English");
  const [error,            setError]            = useState("");

  // Cover letter state
  const [coverLetterText,  setCoverLetterText]  = useState("");
  const [coverLetterHtml,  setCoverLetterHtml]  = useState("");
  const [isGenCover,       setIsGenCover]       = useState(false);
  const [isDownCover,      setIsDownCover]      = useState(false);

  // Motivation letter state
  const [motivationText,   setMotivationText]   = useState("");
  const [motivationHtml,   setMotivationHtml]   = useState("");
  const [isGenMotivation,  setIsGenMotivation]  = useState(false);
  const [isDownMotivation, setIsDownMotivation] = useState(false);

  const tabs = ["Resume", "Cover Letter", "Motivation Letter"];

  // Reset all generated artifacts whenever the selected job changes. Without
  // this, the modal stays mounted and keeps showing the PREVIOUS job's optimized
  // resume / ATS scores / letters when you open a different job — which is
  // confusing and wrong. Each job must show only its own results.
  useEffect(() => {
    setOptimizedResume(null);
    setOptimizeResult(null);
    setCoverLetterText("");
    setCoverLetterHtml("");
    setMotivationText("");
    setMotivationHtml("");
    setError("");
    setActiveTab("Resume");
    // Default the language to the JOB's own language (Dutch JD -> Dutch,
    // English JD -> English). The user can still override via the dropdown; the
    // override holds until they open a different job. Falls back to English when
    // the job has no language (defensive — real jobs always carry one).
    setLanguage(job?.job_language === "Dutch" ? "Dutch" : "English");
  }, [job?.id]);

  // Central handler: given a fetch Response + parsed body, if it's an upgrade
  // error fire the modal and return true (so callers stop). Otherwise set the
  // inline error and return false.
  const handleError = (res, data, fallbackMsg) => {
    const info = parseUpgrade(res.status, data);
    if (info && onUpgradeRequired) {
      onUpgradeRequired(info);
      return true;
    }
    setError((data && data.detail && (data.detail.message || data.detail)) || fallbackMsg);
    return true;
  };

  const getDaysLeft = (expiryDate) => {
    if (!expiryDate) return null;
    const diff = Math.ceil((new Date(expiryDate) - new Date()) / 86400000);
    if (diff < 0) return "Expired";
    if (diff === 0) return "Expires today";
    return `Expires in ${diff} day${diff > 1 ? "s" : ""}`;
  };

  // ── Generate optimized resume ─────────────────────────────────────────────

  const generatePatches = async () => {
    if (!activeResume?.id || !job?.id) return;
    setIsGenerating(true);
    setError("");
    try {
      const form = new FormData();
      form.append("job_id", String(job.id));
      form.append("target_language", language);

      const res  = await fetch(`${API}/resume-optimize/${activeResume.id}`, {
        method: "POST", headers: authHeaders(), body: form,
      });
      const data = await res.json();
      if (!res.ok) { handleError(res, data, "Optimization failed"); return; }
      setOptimizeResult(data);
      setOptimizedResume(data.resume_data);
      // Notify the dashboard so it can (maybe) show the periodic feedback prompt.
      if (onOptimized) { try { onOptimized(); } catch { /* non-critical */ } }
    } catch (err) {
      setError("Network error — check backend connection");
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Export optimized resume PDF ───────────────────────────────────────────

  const exportResumePDF = async () => {
    setIsExporting(true);
    setError("");
    try {
      if (optimizeResult?.html_resume) {
        const res = await fetch(`${API}/export-pdf-from-html`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ html: optimizeResult.html_resume }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); handleError(res, e, "PDF failed"); return; }
        _downloadBlob(await res.blob(), `${_safeName()}_optimized_resume.pdf`);
        return;
      }
      // fallback — re-run
      const form = new FormData();
      form.append("job_id", String(job.id));
      form.append("target_language", language);
      const res = await fetch(`${API}/resume-optimize/${activeResume.id}/export-pdf`, {
        method: "POST", headers: authHeaders(), body: form,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); handleError(res, e, "PDF failed"); return; }
      _downloadBlob(await res.blob(), `${_safeName()}_optimized_resume.pdf`);
    } catch (err) {
      setError("Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Cover letter ──────────────────────────────────────────────────────────

  const generateCoverLetter = async () => {
    if (!activeResume?.id || !job?.id) return;
    setIsGenCover(true);
    setError("");
    try {
      const form = new FormData();
      form.append("job_id", String(job.id));
      form.append("target_language", language);
      const res  = await fetch(`${API}/resume-cover-letter/${activeResume.id}`, {
        method: "POST", headers: authHeaders(), body: form,
      });
      const data = await res.json();
      if (!res.ok) { handleError(res, data, "Cover letter failed"); return; }
      setCoverLetterText(data.cover_letter_text);
      setCoverLetterHtml(data.html);
    } catch (err) {
      setError("Cover letter generation failed");
    } finally {
      setIsGenCover(false);
    }
  };

  const downloadCoverLetterPDF = async () => {
    setIsDownCover(true);
    try {
      const form = new FormData();
      form.append("job_id", String(job.id));
      form.append("target_language", language);
      const res = await fetch(`${API}/resume-cover-letter/${activeResume.id}/pdf`, {
        method: "POST", headers: authHeaders(), body: form,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); handleError(res, e, "Cover letter PDF failed"); return; }
      _downloadBlob(await res.blob(), `${_safeName()}_cover_letter.pdf`);
    } catch (err) {
      setError("Download failed");
    } finally {
      setIsDownCover(false);
    }
  };

  // ── Motivation letter ─────────────────────────────────────────────────────

  const generateMotivationLetter = async () => {
    if (!activeResume?.id || !job?.id) return;
    setIsGenMotivation(true);
    setError("");
    try {
      const form = new FormData();
      form.append("job_id", String(job.id));
      form.append("target_language", language);
      const res  = await fetch(`${API}/resume-motivation-letter/${activeResume.id}`, {
        method: "POST", headers: authHeaders(), body: form,
      });
      const data = await res.json();
      if (!res.ok) { handleError(res, data, "Motivation letter failed"); return; }
      setMotivationText(data.motivation_letter_text);
      setMotivationHtml(data.html);
    } catch (err) {
      setError("Motivation letter generation failed");
    } finally {
      setIsGenMotivation(false);
    }
  };

  const downloadMotivationPDF = async () => {
    setIsDownMotivation(true);
    try {
      const form = new FormData();
      form.append("job_id", String(job.id));
      form.append("target_language", language);
      const res = await fetch(`${API}/resume-motivation-letter/${activeResume.id}/pdf`, {
        method: "POST", headers: authHeaders(), body: form,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); handleError(res, e, "Motivation letter PDF failed"); return; }
      _downloadBlob(await res.blob(), `${_safeName()}_motivation_letter.pdf`);
    } catch (err) {
      setError("Download failed");
    } finally {
      setIsDownMotivation(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const _safeName = () =>
    (activeResume?.name || "candidate").replace(/\.[^.]+$/, "").replace(/\s+/g, "_");

  const _downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const probColor = (level) =>
    level === "high" ? "text-emerald-300" : level === "medium" ? "text-yellow-300" : "text-red-300";

  // ── Resume structured renderer ────────────────────────────────────────────

  const ResumeContent = () => {
    if (!optimizedResume) return null;
    const skills    = optimizedResume.skills || {};
    const allSkills = [...(skills.technical||[]), ...(skills.tools||[]), ...(skills.soft||[])];
    return (
      <div>
        <div className="border-b pb-5 mb-5">
          <h1 className="text-[26px] font-bold">
            {optimizeResult?.candidate_name || activeResume?.name || "Candidate"}
          </h1>
          <div className="mt-2 text-[12px] text-gray-600">{optimizedResume.contact || ""}</div>
        </div>

        {optimizedResume.summary && (
          <section className="mb-6">
            <h2 className="text-[14px] font-bold border-b border-black pb-1 mb-2">SUMMARY</h2>
            <p className="text-[12px]">{optimizedResume.summary}</p>
          </section>
        )}

        {allSkills.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[14px] font-bold border-b border-black pb-1 mb-3">SKILLS</h2>
            <div className="flex flex-wrap gap-1">
              {allSkills.map((s, i) => (
                <span key={i} className="text-[12px]">{s}{i < allSkills.length - 1 ? " •" : ""} </span>
              ))}
            </div>
          </section>
        )}

        {optimizedResume.experience?.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[14px] font-bold border-b border-black pb-1 mb-4">EXPERIENCE</h2>
            {optimizedResume.experience.map((exp, i) => (
              <div key={i} className="mb-5">
                <div className="flex justify-between">
                  <div>
                    <h3 className="text-[13px] font-semibold">{exp.title}</h3>
                    <p className="text-[12px] text-gray-700">{exp.company}</p>
                  </div>
                  <span className="text-[11px] text-gray-500">{exp.dates}</span>
                </div>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  {exp.bullets?.map((b, j) => <li key={j} className="text-[12px]">{b}</li>)}
                </ul>
              </div>
            ))}
          </section>
        )}

        {optimizedResume.education?.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[14px] font-bold border-b border-black pb-1 mb-4">EDUCATION</h2>
            {optimizedResume.education.map((edu, i) => (
              <div key={i} className="mb-3">
                <h3 className="text-[13px] font-semibold">{edu.degree}</h3>
                <div className="flex justify-between text-[12px] text-gray-700">
                  <span>{edu.institution}</span><span>{edu.year}</span>
                </div>
                {edu.details && <p className="text-[11px] text-gray-500 mt-0.5">{edu.details}</p>}
              </div>
            ))}
          </section>
        )}

        {optimizedResume.certifications?.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[14px] font-bold border-b border-black pb-1 mb-3">CERTIFICATIONS</h2>
            <ul className="list-disc pl-5 space-y-1">
              {optimizedResume.certifications.map((c, i) => <li key={i} className="text-[12px]">{c}</li>)}
            </ul>
          </section>
        )}

        {optimizedResume.projects?.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[14px] font-bold border-b border-black pb-1 mb-3">PROJECTS</h2>
            {optimizedResume.projects.map((p, i) => (
              <div key={i} className="mb-3">
                <h3 className="text-[13px] font-semibold">{p.name}</h3>
                <p className="text-[12px] text-gray-700">{p.description}</p>
                {p.tech?.length > 0 && (
                  <p className="text-[11px] text-gray-500 italic mt-0.5">Tech: {p.tech.join(", ")}</p>
                )}
              </div>
            ))}
          </section>
        )}

        {optimizedResume.extra_sections?.map((sec, i) => (
          <section key={i} className="mb-6">
            <h2 className="text-[14px] font-bold border-b border-black pb-1 mb-2">
              {sec.title?.toUpperCase()}
            </h2>
            <p className="text-[12px] whitespace-pre-line">{sec.content}</p>
          </section>
        ))}
      </div>
    );
  };

  // ── Letter preview ────────────────────────────────────────────────────────
  // Regenerate removed: once `text` exists, the Generate button is hidden and
  // only Download remains (unless allowRegenerate, i.e. Enterprise).

  const LetterPreview = ({ text, isGenerating, onGenerate, onDownload, isDownloading, type }) => {
    const showGenerate = !text || allowRegenerate;
    return (
      <div className="h-[900px] flex flex-col border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-white/10 bg-white/[0.02]">
          <span className="text-sm font-semibold text-white">{type}</span>
          <div className="flex gap-2">
            {showGenerate && (
              <button
                onClick={onGenerate}
                disabled={isGenerating}
                className="px-3 py-1.5 text-xs bg-emerald-500 text-black rounded-lg font-semibold disabled:opacity-50 hover:scale-[1.02] transition"
              >
                {isGenerating ? "Generating..." : text ? "Regenerate" : `Generate ${type}`}
              </button>
            )}
            {text && (
              <button
                onClick={onDownload}
                disabled={isDownloading}
                className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg font-semibold disabled:opacity-50 hover:scale-[1.02] transition"
              >
                {isDownloading ? "Downloading..." : "⬇ PDF"}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white p-8 text-black font-serif text-[13px] leading-relaxed">
          {isGenerating && (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
              <div className="w-8 h-8 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm">Generating {type}...</p>
            </div>
          )}
          {!isGenerating && !text && (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3 text-center">
              <div className="text-3xl">✉️</div>
              <p className="text-sm font-medium">No {type} generated yet</p>
              <p className="text-xs max-w-xs">
                Click "Generate {type}" to create a personalized letter tailored to this job
              </p>
            </div>
          )}
          {!isGenerating && text && (
            <div className="whitespace-pre-line">{text}</div>
          )}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="w-[95vw] h-[92vh] rounded-[30px] overflow-hidden border border-white/10 bg-[#0f172a] shadow-[0_20px_100px_rgba(0,0,0,0.6)] flex flex-col">

        {/* HEADER */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 via-cyan-500/5">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{job?.title || "No title"}</h1>
              <div className="px-3 py-1 rounded-full bg-white/10 text-xs font-semibold">
                ATS {job?.match}%
                <span className={`ml-1 ${probColor(job?.interview_probability)}`}>
                  ({job?.interview_probability})
                </span>
              </div>
              {optimizeResult && (
                <div className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 text-xs font-semibold">
                  After: {optimizeResult.ats_score_after}%
                  <span className={`ml-1 ${probColor(optimizeResult.interview_probability_after)}`}>
                    ({optimizeResult.interview_probability_after})
                  </span>
                </div>
              )}
            </div>
            <p className="text-slate-400 mt-2 text-xs flex items-center gap-2">
              {job?.company} • {job?.location} •
              <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-300 border border-yellow-500/20 animate-pulse">
                {getDaysLeft(job?.expiry)}
              </span>
            </p>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:outline-none"
            >
              {["English","Dutch"].map(l => (
                <option key={l} value={l} className="bg-[#0f172a] text-white">{l}</option>
              ))}
            </select>

            {activeTab === "Resume" && (
              <button
                onClick={exportResumePDF}
                disabled={isExporting || !optimizedResume}
                className="px-4 py-2 rounded-xl bg-emerald-400 text-black text-xs font-semibold disabled:opacity-40"
              >
                {isExporting ? "Exporting..." : "⬇ Download Resume PDF"}
              </button>
            )}

            <button
              onClick={onClose}
              className="w-10 h-10 shrink-0 rounded-full bg-white/5 hover:bg-white/10 transition text-slate-300 text-xl flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">

          {/* SIDEBAR */}
          <aside className="w-full lg:w-[320px] shrink-0 border-r border-white/10 bg-white/[0.03] overflow-y-auto">
            <div className="p-5 space-y-4">

              {/* STATUS */}
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-3 mb-2">
                  {isGenerating ? (
                    <div className="w-10 h-10 rounded-xl border-2 border-emerald-400 border-t-transparent animate-spin" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-emerald-400/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 text-lg">
                      {optimizedResume ? "✓" : "🧠"}
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-sm">
                      {isGenerating ? "AI Processing..." : optimizedResume ? "Optimization Complete" : "AI Ready"}
                    </h3>
                    <p className="text-xs text-emerald-200/70 mt-0.5">
                      {isGenerating ? "Extract → Analyze → Rewrite → Assemble" :
                       optimizedResume ? "All gaps filled and keywords injected" :
                       "Gap-aware 4-pass rewriter"}
                    </p>
                  </div>
                </div>
              </div>

              {/* AI ACTIONS — generate buttons hide once generated (no regenerate
                  unless Enterprise). This stops repeat OpenAI calls. */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold mb-3">AI Actions</h2>
                <div className="space-y-2">
                  {(!optimizedResume || allowRegenerate) && (
                    <button
                      onClick={() => { setActiveTab("Resume"); generatePatches(); }}
                      disabled={isGenerating}
                      className="w-full py-2.5 rounded-xl bg-emerald-400 text-black text-xs font-semibold hover:scale-[1.01] disabled:opacity-50 transition"
                    >
                      {isGenerating ? "Optimizing..." : "Generate AI Resume"}
                    </button>
                  )}
                  {(!coverLetterText || allowRegenerate) && (
                    <button
                      onClick={() => { setActiveTab("Cover Letter"); generateCoverLetter(); }}
                      disabled={isGenCover}
                      className="w-full py-2.5 rounded-xl bg-cyan-500 text-white text-xs font-semibold hover:scale-[1.01] disabled:opacity-50 transition"
                    >
                      {isGenCover ? "Generating..." : "Generate Cover Letter"}
                    </button>
                  )}
                  {(!motivationText || allowRegenerate) && (
                    <button
                      onClick={() => { setActiveTab("Motivation Letter"); generateMotivationLetter(); }}
                      disabled={isGenMotivation}
                      className="w-full py-2.5 rounded-xl bg-purple-500 text-white text-xs font-semibold hover:scale-[1.01] disabled:opacity-50 transition"
                    >
                      {isGenMotivation ? "Generating..." : "Generate Motivation Letter"}
                    </button>
                  )}
                  {/* Once everything is generated and regenerate isn't allowed,
                      show a small hint so the panel isn't empty. */}
                  {!allowRegenerate && optimizedResume && coverLetterText && motivationText && (
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      All documents generated for this job. Use the tabs to view and
                      download them.
                    </p>
                  )}
                </div>
              </div>

              {/* ATS SCORES */}
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-500/10 to-emerald-500/10 p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-sm">ATS Score</h3>
                  <div className="text-xl font-bold text-emerald-300">
                    {optimizeResult ? `${optimizeResult.ats_score_after}%` : `${job?.match || 0}%`}
                  </div>
                </div>

                {optimizeResult ? (
                  <div className="space-y-2.5">
                    {[
                      { label: "Before",               val: optimizeResult.ats_score_before,   color: "#f87171" },
                      { label: "After",                val: optimizeResult.ats_score_after,    color: "#4ade80" },
                      { label: "Interview Probability", val: optimizeResult.interview_probability_pct,
                        color: optimizeResult.interview_probability_color === "green" ? "#4ade80" :
                               optimizeResult.interview_probability_color === "orange" ? "#fbbf24" : "#f87171",
                        label2: ` (${optimizeResult.interview_probability_after})` },
                    ].map(({ label, val, color, label2 }) => (
                      <div key={label}>
                        <div className="flex justify-between text-[11px] mb-1">
                          <span className="text-slate-400">{label}</span>
                          <span style={{ color }}>{val}%{label2 || ""}</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full">
                          <div className="h-full rounded-full transition-all duration-700"
                               style={{ width: `${val}%`, background: color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-slate-400">Current ATS</span>
                      <span className="text-emerald-300">{job?.match || 0}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full">
                      <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${job?.match || 0}%` }} />
                    </div>
                  </div>
                )}
              </div>

              {/* SKILLS ANALYSIS */}
              {optimizeResult && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Skills After Optimization</h3>
                  {[
                    { label: "Strong",  data: optimizeResult.strong_skills,  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                    { label: "Weak",    data: optimizeResult.weak_skills,    color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/20" },
                    { label: "Missing", data: optimizeResult.missing_skills, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
                  ].map(({ label, data, color, bg }) => data?.length > 0 && (
                    <div key={label}>
                      <p className={`text-[10px] uppercase tracking-wider ${color} mb-1.5`}>
                        {label} ({data.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.map((s, i) => (
                          <span key={i} className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${bg} ${color}`}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* PIPELINE STEPS */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-[10px] uppercase tracking-wider text-slate-400 mb-3">AI Pipeline</h3>
                <div className="space-y-3">
                  {[
                    "Extract all resume sections",
                    "ATS gap analysis (missing/weak skills)",
                    "Rewrite each section — inject all gaps",
                    "Assemble & validate gaps addressed",
                    "Re-score optimized resume",
                  ].map((step, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        optimizedResume ? "bg-emerald-400 text-black" :
                        isGenerating    ? "bg-emerald-400/30 animate-pulse text-white/50" :
                                          "bg-white/10 text-white/30"
                      }`}>
                        {optimizedResume ? "✓" : i + 1}
                      </div>
                      <span className="text-slate-300 text-xs leading-relaxed">{step}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </aside>

          {/* MAIN */}
          <main className="flex-1 flex flex-col bg-[#0b1220] overflow-hidden">

            {/* TABS */}
            <div className="px-5 py-3 border-b border-white/10 flex justify-between items-center flex-wrap gap-3">
              <div className="flex gap-2 flex-wrap">
                {tabs.map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                      activeTab === t ? "bg-white text-black" : "bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400">Lang: {language}</div>
            </div>

            {/* WORKSPACE */}
            <div className="flex-1 overflow-y-auto p-5 lg:p-8">

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-400/30 text-red-300 text-sm">
                  {error}
                </div>
              )}

              {/* ── RESUME TAB ── */}
              {activeTab === "Resume" && (
                <div className="max-w-[900px] mx-auto">

                  {/* Optimized */}
                  <div>
                    <div className="flex justify-between mb-3">
                      <h3 className="text-base font-semibold text-white">AI Optimized Resume</h3>
                      {(!optimizedResume || allowRegenerate) && (
                        <button
                          onClick={generatePatches}
                          disabled={isGenerating}
                          className="px-3 py-1 text-xs bg-emerald-500 text-black rounded-lg hover:scale-[1.02] disabled:opacity-50 transition"
                        >
                          {isGenerating ? "Optimizing..." : "Generate AI Resume"}
                        </button>
                      )}
                    </div>

                    <div className="bg-white h-[900px] overflow-y-auto border border-emerald-400/30">
                      <div className="w-full min-h-full px-10 py-8 text-black font-sans text-[13px] leading-relaxed">
                        {!optimizedResume && !isGenerating && (
                          <div className="h-[800px] flex flex-col items-center justify-center text-center text-gray-400 gap-3">
                            <div className="text-4xl">🧠</div>
                            <p className="font-medium">No AI resume generated yet</p>
                            <p className="text-xs max-w-xs">
                              The optimizer will fill all missing skills, strengthen weak ones,
                              and inject all missing keywords to push your interview probability higher.
                            </p>
                          </div>
                        )}
                        {isGenerating && (
                          <div className="h-[800px] flex flex-col items-center justify-center text-center text-gray-400 gap-3">
                            <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                            <p className="font-medium">Optimizing your resume...</p>
                            <p className="text-xs">Filling gaps · Injecting keywords · Strengthening weak skills</p>
                          </div>
                        )}
                        {!isGenerating && optimizedResume && <ResumeContent />}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── COVER LETTER TAB ── */}
              {activeTab === "Cover Letter" && (
                <div className="max-w-[900px] mx-auto">
                  <LetterPreview
                    text={coverLetterText}
                    isGenerating={isGenCover}
                    onGenerate={generateCoverLetter}
                    onDownload={downloadCoverLetterPDF}
                    isDownloading={isDownCover}
                    type="Cover Letter"
                  />
                </div>
              )}

              {/* ── MOTIVATION LETTER TAB ── */}
              {activeTab === "Motivation Letter" && (
                <div className="max-w-[900px] mx-auto">
                  <LetterPreview
                    text={motivationText}
                    isGenerating={isGenMotivation}
                    onGenerate={generateMotivationLetter}
                    onDownload={downloadMotivationPDF}
                    isDownloading={isDownMotivation}
                    type="Motivation Letter"
                  />
                </div>
              )}

              {/* AI SUMMARY + CHANGES */}
              {optimizeResult?.summary && activeTab === "Resume" && (
                <div className="max-w-[1700px] mx-auto mt-6 p-5 rounded-2xl bg-white/[0.03] border border-white/10">
                  <h3 className="text-sm font-semibold text-slate-300 mb-2">🧠 AI Recruiter Assessment (After Optimization)</h3>
                  <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-line">{optimizeResult.summary}</p>
                  {optimizeResult.changes_made?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">What Was Changed</p>
                      <div className="space-y-1">
                        {optimizeResult.changes_made.map((c, i) => (
                          <div key={i} className="flex gap-2 items-start text-xs text-slate-400">
                            <span className="text-emerald-400 shrink-0">•</span>
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* FOOTER — regenerate removed; only downloads remain */}
            <div className="border-t border-white/10 px-5 py-4 flex justify-between items-center flex-wrap gap-3">
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  isGenerating || isGenCover || isGenMotivation
                    ? "bg-emerald-400 animate-pulse"
                    : optimizedResume ? "bg-emerald-400" : "bg-gray-600"
                }`} />
                {isGenerating ? "Optimizing resume..." :
                 isGenCover ? "Generating cover letter..." :
                 isGenMotivation ? "Generating motivation letter..." :
                 optimizedResume ? "Ready to download" : "Ready"}
              </div>
              <div className="flex gap-2">
                {activeTab === "Resume" && (
                  <>
                    {allowRegenerate && (
                      <button onClick={generatePatches} disabled={isGenerating}
                        className="px-4 py-2 text-xs rounded-xl bg-cyan-500 text-black font-semibold disabled:opacity-50">
                        {isGenerating ? "..." : "Regenerate"}
                      </button>
                    )}
                    <button onClick={exportResumePDF} disabled={isExporting || !optimizedResume}
                      className="px-4 py-2 text-xs rounded-xl bg-emerald-400 text-black font-semibold disabled:opacity-50">
                      {isExporting ? "Exporting..." : "Export Resume PDF"}
                    </button>
                  </>
                )}
                {activeTab === "Cover Letter" && coverLetterText && (
                  <button onClick={downloadCoverLetterPDF} disabled={isDownCover}
                    className="px-4 py-2 text-xs rounded-xl bg-emerald-400 text-black font-semibold disabled:opacity-50">
                    {isDownCover ? "Downloading..." : "⬇ Cover Letter PDF"}
                  </button>
                )}
                {activeTab === "Motivation Letter" && motivationText && (
                  <button onClick={downloadMotivationPDF} disabled={isDownMotivation}
                    className="px-4 py-2 text-xs rounded-xl bg-purple-400 text-black font-semibold disabled:opacity-50">
                    {isDownMotivation ? "Downloading..." : "⬇ Motivation Letter PDF"}
                  </button>
                )}
              </div>
            </div>

          </main>
        </div>
      </div>
    </div>
  );
}