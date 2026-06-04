import { useState } from "react";
import { Bot, Upload, Download, Trash2, History } from "lucide-react";
import api from "../../components/api";

function timeAgo(isoStr) {
  if (!isoStr) return "Never";
  // Ensure the string is parsed as UTC if it has no timezone info
  const str = isoStr.endsWith("Z") || isoStr.includes("+") ? isoStr : isoStr + "Z";
  const diff = Math.floor((Date.now() - new Date(str).getTime()) / 1000);
  if (diff < 5)    return "just now";
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatLocalTime(isoStr) {
  if (!isoStr) return "";
  const str = isoStr.endsWith("Z") || isoStr.includes("+") ? isoStr : isoStr + "Z";
  return new Date(str).toLocaleString();
}

export default function ResumeHeader({
  activeResume,
  savedResumes,
  showResumeSwitcher,
  setShowResumeSwitcher,
  lastRefreshedAt,
  onRefresh,
  onUpload,
  onExport,
  onDelete,
  onSelectResume,
  onDrop,
  deleteTarget,
  setDeleteTarget,
  onConfirmDelete,
  fileInputRef,
  handleFileChange,
}) {
  const [showHistory, setShowHistory]   = useState(false);
  const [history,     setHistory]       = useState([]);
  const [histLoading, setHistLoading]   = useState(false);

  const fetchHistory = async () => {
    if (!activeResume?.id) return;
    setHistLoading(true);
    try {
      const res = await api.get(`/resume-refresh-history/${activeResume.id}`);
      setHistory(res.data.history || []);
    } catch (err) {
      console.error("Failed to fetch history", err);
    } finally {
      setHistLoading(false);
    }
  };

  const handleHistoryToggle = () => {
    if (!showHistory) fetchHistory();
    setShowHistory(v => !v);
  };

  return (
    <div className="m-4 space-y-4">
      {/* ── Active Resume Card ── */}
      {activeResume && (
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-400/20 rounded-2xl p-4 backdrop-blur-xl">
          <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/10 blur-3xl rounded-full" />

          <div className="relative flex items-center justify-between">
            {/* Left — resume info */}
            <div className="flex items-center gap-4 w-full">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-cyan-400/20 border border-white/10 flex items-center justify-center text-lg font-bold">
                PDF
              </div>
              <div className="w-full">
                <div className="cursor-pointer" onClick={() => setShowResumeSwitcher(prev => !prev)}>
                  <p className="text-xs uppercase tracking-widest text-emerald-300/70 mb-1">Active Resume ▾</p>
                  <h2 className="text-lg font-semibold text-white">{activeResume.name}</h2>
                </div>

                {/* NEW: candidate name line (only shows when set) */}
                {activeResume.candidate_name && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] uppercase tracking-wider text-cyan-300/70">Candidate</span>
                    <span className="text-sm font-medium text-cyan-100">{activeResume.candidate_name}</span>
                  </div>
                )}

                {/* Last refresh + history toggle */}
                <div
                  className="flex items-center gap-2 mt-1 cursor-pointer group w-fit"
                  onClick={handleHistoryToggle}
                  title="Click to view refresh history"
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${lastRefreshedAt ? "bg-emerald-400" : "bg-gray-600"}`} />
                  <span className="text-[11px] text-gray-400 group-hover:text-gray-200 transition-colors">
                    Last refresh:{" "}
                    <span className="text-gray-300 font-medium">
                      {lastRefreshedAt ? timeAgo(lastRefreshedAt) : "Never"}
                    </span>
                    {lastRefreshedAt && (
                      <span className="text-gray-500 ml-1">
                        ({formatLocalTime(lastRefreshedAt)})
                      </span>
                    )}
                  </span>
                  <History size={11} className="text-gray-500 group-hover:text-emerald-400 transition-colors" />
                </div>

                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-400">Cached Resume</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/20 text-[10px] text-emerald-300">Ready</span>
                </div>
              </div>
            </div>

            {/* Right — action buttons */}
            <div className="flex items-center gap-2">
              <button onClick={onRefresh}
                className="flex flex-col items-center justify-center w-16 h-16 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/20 text-emerald-300 transition-all duration-150 hover:scale-[1.03]">
                <Bot size={20} /><span className="text-[10px] mt-1">Agent</span>
              </button>
              <button onClick={onUpload}
                className="flex flex-col items-center justify-center w-16 h-16 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-gray-200 transition-all duration-150 hover:scale-[1.03]">
                <Upload size={20} /><span className="text-[10px] mt-1">Upload</span>
              </button>
              <button onClick={onExport}
                className="flex flex-col items-center justify-center w-16 h-16 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/20 text-blue-300 transition-all duration-150 hover:scale-[1.03]">
                <Download size={20} /><span className="text-[10px] mt-1">Export</span>
              </button>
              <button onClick={() => setDeleteTarget(activeResume)}
                className="flex flex-col items-center justify-center w-16 h-16 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-400/20 text-red-300 transition-all duration-150 hover:scale-[1.03]">
                <Trash2 size={20} /><span className="text-[10px] mt-1">Delete</span>
              </button>
            </div>
          </div>

          {/* ── Refresh History Panel ── */}
          {showHistory && (
            <div className="mt-4 border-t border-white/[0.06] pt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] uppercase tracking-widest text-emerald-300/70 font-semibold">
                  Refresh History
                </p>
                <button
                  onClick={fetchHistory}
                  className="text-[10px] text-gray-500 hover:text-emerald-400 transition-colors"
                >
                  ↻ Reload
                </button>
              </div>

              {histLoading ? (
                <div className="flex items-center gap-2 py-3">
                  <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-500">Loading history...</span>
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-gray-600 py-2">No refresh history yet. Hit Agent to run your first refresh.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {history.map((entry, i) => (
                    <div key={i}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex items-center gap-3">
                        {/* index badge */}
                        <span className="text-[9px] font-bold text-gray-600 w-4 text-right flex-shrink-0">
                          #{history.length - i}
                        </span>
                        <div>
                          <p className="text-[12px] text-gray-300 font-medium">
                            {formatLocalTime(entry.refreshed_at)}
                          </p>
                          {entry.filters && (
                            <p className="text-[10px] text-gray-600 mt-0.5">
                              {[
                                entry.filters.languages?.join("+")?.toUpperCase() || entry.filters.language?.toUpperCase(),
                                entry.filters.location ? `${entry.filters.location} · ${entry.filters.radius_km || entry.filters.radiusKm}km` : null,
                                entry.filters.expiry_days ? `≤${entry.filters.expiry_days}d` : "All dates",
                                `Top ${entry.filters.top_n || 20}`,
                              ].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[11px] font-semibold text-emerald-400">{entry.total_jobs} jobs</span>
                        <span className="text-[10px] text-gray-600">{timeAgo(entry.refreshed_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Resume Switcher Dropdown ── */}
          {/* FIX (bug 4): taller max height, contained overscroll, wheel events
              kept inside the dropdown, and a visible scrollbar via the
              resume-switcher-scroll class (defined in Dashboard's <style>). */}
          {showResumeSwitcher && savedResumes.length > 1 && (
            <div
              className="mt-4 grid gap-2 max-h-72 overflow-y-auto overscroll-contain pr-1 resume-switcher-scroll"
              onWheel={(e) => e.stopPropagation()}
            >
              {savedResumes.map((resume) => (
                <div key={resume.id} onClick={() => onSelectResume(resume)}
                  className={`p-3 rounded-lg cursor-pointer border transition-all ${activeResume.id === resume.id ? "border-emerald-400/40 bg-emerald-400/10" : "border-gray-700 hover:border-gray-500 bg-white/5"}`}>
                  <p className="text-sm text-white">{resume.name}</p>
                  {resume.candidate_name && (
                    <p className="text-[11px] text-cyan-300/70">{resume.candidate_name}</p>
                  )}
                  <p className="text-xs text-gray-500">{resume.uploadedAt}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── First-time upload ── */}
      {savedResumes.length === 0 && (
        <div
          className="relative overflow-hidden p-6 rounded-2xl border border-gray-700/70 bg-white/[0.03] hover:bg-white/[0.05] transition-all duration-300 cursor-pointer group backdrop-blur-xl"
          onClick={onUpload} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-emerald-500/5 via-cyan-500/5 to-transparent" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 flex items-center justify-center text-2xl shadow-xl">↑</div>
              <div>
                <h2 className="font-semibold text-lg text-white">Upload Resume</h2>
                <p className="text-sm text-gray-400 mt-1">Drag & Drop or click to upload</p>
              </div>
            </div>
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs text-gray-500">PDF • DOCX</span>
              <span className="text-[10px] text-emerald-400 mt-1">AI Embedding Enabled</span>
            </div>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />

      {/* ── Delete Confirm Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-[360px] shadow-xl">
            <h2 className="text-white text-lg font-semibold mb-2">Delete Resume</h2>
            <p className="text-gray-400 text-sm mb-5">
              Do you really want to delete <span className="text-white font-medium">{deleteTarget.name}</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm">Cancel</button>
              <button onClick={onConfirmDelete} className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-300 text-sm">Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}