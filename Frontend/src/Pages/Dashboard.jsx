import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { useAuth } from "../context/AuthContext";
import api from "../components/api";
import AIApplicationModalPreview from "../components/AIApplicationModel";
import ResumeFilterModal from "../components/ResumeFilterModal";
import UpgradeModal from "../components/UpgradeModal";
import FeedbackModal from "../components/Feedbackmodal";
import { getUpgradeInfo, shouldPromptFeedback } from "../components/Billing";
import Sidebar from "./dashboard/Sidebar";
import ResumeHeader from "./dashboard/ResumeHeader";
import JobsTable from "./dashboard/JobsTable";
import AnalysisPanel from "./dashboard/AnalysisPanel";
import SettingsPanel from "./dashboard/SettingsPanel";
import AdminPanel from "./dashboard/AdminPanel";
import BatchPanel from "./Batchpanel";   // NEW: enterprise batch jobs panel
import TokenMeter from "./TokenMeter";   // NEW: admin token-o-meter
import TeamPanel from "./TeamPanel";     // NEW: admin team / contributor management
import { normalizeJob, startFakeProgress } from "./dashboard/dashboardUtils";

export default function Dashboard() {
  const { user, limits } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "null", direction: "null" });
  const [page, setPage] = useState(1);
  const [activeTopN, setActiveTopN] = useState(20); // tracks confirmed top_n from filter modal
  // Page size is the number of rows shown PER PAGE — fixed, and intentionally
  // decoupled from top_n (which controls how many jobs get scored, not how many
  // display at once). This restores multi-page pagination with prev/next: e.g.
  // top_n=50 → 5 pages of 10. Change this one constant to adjust rows per page.
  const PAGE_SIZE = 10;
  const pageSize = PAGE_SIZE;
  const [mode, setMode] = useState("strong");

  const [savedResumes, setSavedResumes] = useState([]);
  const [activeResume, setActiveResume] = useState(null);
  const [showResumeSwitcher, setShowResumeSwitcher] = useState(false);
  const [processingType, setProcessingType] = useState("upload");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activePage, setActivePage] = useState(() => {
    // Open Settings directly when arriving via ?view=settings (used by the
    // upgrade/resubscribe buttons so they land on the iDEAL payment panel).
    if (typeof window !== "undefined") {
      const v = new URLSearchParams(window.location.search).get("view");
      if (v === "settings") return "Settings";
    }
    return "Dashboard";
  });
  const [showAIModal, setShowAIModal] = useState(false);

  // Upgrade modal — opened when a gated (Pro-only) endpoint returns a 403, or
  // when an upload/refresh hits a plan limit. `null` = hidden.
  const [upgradeInfo, setUpgradeInfo] = useState(null);

  // Brief loader shown while we check a picked file (cap + duplicate) before the
  // filter modal opens, so the few-second gap isn't dead air.
  const [checkingUpload, setCheckingUpload] = useState(false);

  // Periodic feedback prompt (shown after an optimization, max once / 30 days).
  const [showFeedback, setShowFeedback] = useState(false);

  // Called by the AI modal after a successful optimization. Checks the 30-day
  // cooldown server-side; opens the feedback prompt only if due.
  const handleOptimized = useCallback(async () => {
    try {
      const due = await shouldPromptFeedback();
      if (due) setShowFeedback(true);
    } catch {
      /* never block on feedback */
    }
  }, []);

  // Filter modal state
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [pendingFile, setPendingFile] = useState(null); // holds file while modal is open

  // Edit-filters modal (opened by the Agent button before a refresh)
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [refreshInitialFilters, setRefreshInitialFilters] = useState(null);
  const [refreshModalKey, setRefreshModalKey] = useState(0); // remount to reset state

  // Toast (used e.g. when a duplicate resume is selected)
  const [toast, setToast] = useState(null); // { message, type }
  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fileInputRef = useRef(null);
  const didInitRef = useRef(false);
  // Load last refresh time whenever active resume changes (including on page load).
  // FIX (bugs 2 & 3): always set a value — null when there is no history — so a
  // newly-activated resume never inherits the previous resume's refresh time.
  useEffect(() => {
    if (!activeResume?.id) return;
    api.get(`/resume-refresh-history/${activeResume.id}`)
      .then(res => {
        const history = res.data?.history || [];
        setLastRefreshedAt(history.length > 0 ? history[0].refreshed_at : null);
      })
      .catch(() => setLastRefreshedAt(null));
  }, [activeResume?.id]);

  useEffect(() => {
    setShowResumeSwitcher(false);
  }, [activePage]);

  /* ── Status messages based on progress ── */
  useEffect(() => {
    const msgs = processingType === "upload"
      ? { 25: "Uploading resume...", 50: "Generating AI profile...", 75: "Matching jobs...", 95: "Computing ATS Analysis...", 100: "Finalizing results..." }
      : { 25: "Refreshing jobs...", 50: "Updating job matches...", 75: "Re-evaluating matches...", 95: "Computing ATS Analysis...", 100: "Finalizing results..." };

    const key = Object.keys(msgs).reverse().find(k => progress >= Number(k));
    if (key) setStatus(msgs[key]);
  }, [progress, processingType]);

  /* ── Derived values ── */
  const sortedJobs = [...jobs].sort((a, b) => {
    if (!sortConfig.key || sortConfig.key === "null") return 0;
    if (sortConfig.key === "title") return sortConfig.direction === "asc" ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title);
    if (sortConfig.key === "expiry") return sortConfig.direction === "asc" ? new Date(a.expiry) - new Date(b.expiry) : new Date(b.expiry) - new Date(a.expiry);
    if (sortConfig.key === "match") return sortConfig.direction === "asc" ? a.match - b.match : b.match - a.match;
    return 0;
  });

  const totalPages = Math.ceil(sortedJobs.length / pageSize);
  const paginated = sortedJobs.slice((page - 1) * pageSize, page * pageSize);

  const getVisiblePages = () => {
    const pages = [];
    if (totalPages <= 3) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else {
      if (page > 1) pages.push("prev");
      pages.push(page);
      if (page + 1 <= totalPages) pages.push(page + 1);
      if (page + 2 <= totalPages) pages.push(page + 2);
      if (page < totalPages) pages.push("next");
    }
    return pages;
  };

  const hasAnalysis = selectedJob && (selectedJob.summary || selectedJob.match || selectedJob.strong_skills?.length || selectedJob.weak_skills?.length || selectedJob.missing_skills?.length);
  const strongSkills = hasAnalysis ? selectedJob?.strong_skills || [] : [];
  const weakSkills = hasAnalysis ? selectedJob?.weak_skills || [] : [];
  const missingSkills = hasAnalysis ? selectedJob?.missing_skills || [] : [];
  const careerSummary = useMemo(() => selectedJob?.summary || "No analysis available.", [selectedJob]);

  /* ── Fetch jobs for resume ── */
  const fetchJobsForResume = useCallback(async (resumeId) => {
    if (!resumeId) return;
    try {
      setLoading(true);
      const res = await api.get(`/resume-jobs/${resumeId}`);
      const sorted = [...res.data.results.map(normalizeJob)].sort((a, b) => b.match - a.match);
      setJobs(sorted);
      if (sorted.length > 0) setSelectedJob(sorted[0]);
      else setSelectedJob(null);   // no matches → clear stale selection/gauge
    } catch (err) {
      console.error("Failed to fetch jobs", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load last refresh time from history on mount.
  // FIX (bugs 2 & 3): always set — null when no history — never leave stale value.
  const loadLastRefreshTime = useCallback(async (resumeId) => {
    if (!resumeId) return;
    try {
      const res = await api.get(`/resume-refresh-history/${resumeId}`);
      const history = res.data.history || [];
      setLastRefreshedAt(history.length > 0 ? history[0].refreshed_at : null);
    } catch (err) {
      setLastRefreshedAt(null);
    }
  }, []);

  /* ── Init: load resumes ── */
  useEffect(() => {
    if (!user?.sub || didInitRef.current) return;
    didInitRef.current = true;
    const fetchResumes = async () => {
      try {
        const res = await api.get(`/resumes`);
        const formatted = res.data.resumes.map(r => ({
          id: r.resume_id,
          name: r.file_name,
          candidate_name: r.candidate_name || null,   // NEW: user-set display name
          uploadedAt: new Date(r.uploaded_at).toLocaleString(),
          size: "—",
          status: r.has_embedding ? "cached" : "processing",
          filters: r.filters || null,
        }));
        setSavedResumes(formatted);
        if (formatted.length === 0) return;
        const savedId = localStorage.getItem("active_resume_id");
        const resumeToActivate = formatted.find(r => r.id === savedId) || formatted[0];
        setActiveResume(resumeToActivate);
        await fetchJobsForResume(resumeToActivate.id);
        await loadLastRefreshTime(resumeToActivate.id);
      } catch (err) {
        console.error("Failed to load resumes", err);
      }
    };
    fetchResumes();
  }, [user?.sub, loadLastRefreshTime]);

  /* ── Refresh jobs (optionally with edited filters) ── */
  const refreshJobsForResume = async (resumeId, filters = null) => {
    try {
      setProcessingType("refresh");
      setLoading(true);
      setProgress(10);
      const interval = startFakeProgress(setProgress);
      // Send edited filters in the body when provided; backend persists them.
      const body = filters ? { filters } : undefined;
      const res = await api.post(`/resume-jobs/refresh/${resumeId}`, body);
      clearInterval(interval);
      setProgress(100);
      const sorted = [...res.data.results.map(normalizeJob)].sort((a, b) => b.match - a.match);
      setJobs(sorted);
      setPage(1);
      if (sorted.length > 0) setSelectedJob(sorted[0]);
      else setSelectedJob(null);   // no matches → clear stale selection/gauge
      setLastRefreshedAt(res.data.refreshed_at || new Date().toISOString());

      // Keep page size in sync and store the applied filters back on the resume
      const applied = res.data.filters_applied;
      if (applied) {
        if (applied.top_n) setActiveTopN(applied.top_n);
        setSavedResumes(prev => prev.map(r =>
          r.id === resumeId
            ? { ...r, filters: applied, candidate_name: res.data.candidate_name ?? r.candidate_name }
            : r
        ));
        setActiveResume(prev =>
          prev && prev.id === resumeId
            ? { ...prev, filters: applied, candidate_name: res.data.candidate_name ?? prev.candidate_name }
            : prev
        );
      }
    } catch (err) {
      // A refresh can hit the free-tier monthly cap — show the upgrade modal
      // instead of failing silently.
      const info = getUpgradeInfo(err);
      if (info) setUpgradeInfo(info);
      else console.error("Refresh failed", err);
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  /* ── Agent button → open editable filter modal pre-filled with saved filters ── */
  const handleAgentClick = () => {
    if (!activeResume?.id) return;
    // Pre-fill the modal with saved filters PLUS the saved candidate name.
    setRefreshInitialFilters({
      ...(activeResume.filters || {}),
      candidate_name: activeResume.candidate_name || null,   // NEW: pre-fill name field
    });
    setRefreshModalKey(k => k + 1);   // force remount so fields reflect current values
    setShowRefreshModal(true);
  };

  /* ── Confirm from the edit-filters modal → refresh with the chosen filters ── */
  const handleRefreshConfirm = async (filters) => {
    setShowRefreshModal(false);
    if (!activeResume?.id) return;
    await refreshJobsForResume(activeResume.id, filters);
  };

  /* ── Upload resume — cap check first (instant), then duplicate, then modal ── */
  const handleFile = async (file) => {
    if (!file) return;

    // 1) INSTANT cap check — no file upload, no text extraction. If uploading a
    // NEW resume would exceed the plan limit, show the upgrade modal immediately
    // and stop. (Basic = 1 resume, so a second file pick is blocked at once.)
    try {
      const { data: cap } = await api.get("/can-upload-resume");
      if (cap && cap.allowed === false) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        setUpgradeInfo({
          kind: "plan_limit_reached",
          limit: "max_resumes",
          currentPlan: cap.current_plan || "basic",
          message: cap.message || "Upgrade to Pro to upload more resumes.",
        });
        return;
      }
    } catch (err) {
      // If the cap check fails, don't hard-block — fall through (backend still
      // enforces the cap on the actual upload as a safety net).
      console.error("Upload-allowance check failed", err);
    }

    // 2) Allowed — now run the duplicate check. Show a brief loader so the
    // few-second gap (upload + text extraction) isn't dead air.
    setCheckingUpload(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/check-resume-duplicate", fd);

      if (data?.is_duplicate) {
        // Reset the input so the same file can be picked again later
        if (fileInputRef.current) fileInputRef.current.value = "";

        // Make sure the existing resume is active so the Agent button targets it
        const existing =
          savedResumes.find(r => r.id === data.resume_id) || {
            id: data.resume_id,
            name: data.file_name,
            candidate_name: data.candidate_name || null,   // NEW
            uploadedAt: data.uploaded_at ? new Date(data.uploaded_at).toLocaleString() : new Date().toLocaleString(),
            status: "cached",
            size: "—",
          };
        setSavedResumes(prev =>
          prev.some(r => r.id === existing.id) ? prev : [existing, ...prev]
        );
        setActiveResume(existing);
        localStorage.setItem("active_resume_id", existing.id);

        showToast("Resume already uploaded — please use Agent to refresh and get new ATS analysis.", "info");
        return;
      }
    } catch (err) {
      // If the pre-check fails, don't block upload — fall through to the modal.
      console.error("Duplicate pre-check failed", err);
    } finally {
      setCheckingUpload(false);
    }

    setPendingFile(file);
    setShowFilterModal(true);
  };

  /* ── Called when user confirms filters in modal ── */
  const handleFilterConfirm = async (filters) => {
    setShowFilterModal(false);
    const file = pendingFile;
    setPendingFile(null);
    if (!file) return;

    setActiveTopN(filters.topN || 20);
    setProcessingType("upload");
    setLoading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("user_id", user.sub);
    // Pass filters to backend
    formData.append("languages", (filters.languages || ["en"]).join(","));
    if (filters.expiryDays) formData.append("expiry_days", filters.expiryDays);
    if (filters.location)   formData.append("location",    filters.location);
    if (filters.radiusKm)   formData.append("radius_km",   filters.radiusKm);
    const topNValue = Number(filters.topN) || 20;
    formData.append("top_n", String(topNValue));
    // NEW: optional user-set candidate name
    if (filters.candidateName) formData.append("candidate_name", filters.candidateName);
    console.log("[Filter] Sending top_n:", topNValue, "filters:", JSON.stringify(filters));

    const progressTimer = startFakeProgress(setProgress);
    try {
      const res = await api.post("/upload-resume", formData, {
        onUploadProgress: (e) => {
          const pct = Math.floor((e.loaded * 20) / e.total);
          setProgress(prev => pct > prev ? pct : prev);
        },
      });
      clearInterval(progressTimer);
      setProgress(100);
      const data = res.data;

      // ── Safety net: duplicate slipped past the pre-check ─────────────────
      // Normally handleFile catches duplicates before the modal opens, so this
      // rarely runs. Keep behavior consistent: activate existing + toast, no
      // duplicate insertion, let the user hit Agent to refresh.
      if (data.is_duplicate) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        const existing =
          savedResumes.find(r => r.id === data.resume_id) || {
            id: data.resume_id,
            name: data.file_name,
            candidate_name: data.candidate_name || null,   // NEW
            uploadedAt: data.uploaded_at ? new Date(data.uploaded_at).toLocaleString() : new Date().toLocaleString(),
            status: "cached",
            size: "—",
          };
        setSavedResumes(prev =>
          prev.some(r => r.id === existing.id) ? prev : [existing, ...prev]
        );
        setActiveResume(existing);
        localStorage.setItem("active_resume_id", existing.id);
        setLoading(false);
        setProgress(0);
        showToast("Resume already uploaded — please use Agent to refresh and get new ATS analysis.", "info");
        return;
      }

      // ── Normal new-upload path ───────────────────────────────────────────
      const resumeData = {
        id: data.resume_id,
        name: data.file_name,
        candidate_name: data.candidate_name || filters.candidateName || null,   // NEW
        uploadedAt: new Date().toLocaleString(),
        status: "cached",
        size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        filters: data.filters_applied || null,   // so Agent can pre-fill later
      };
      setSavedResumes(prev => [resumeData, ...prev]);
      setActiveResume(resumeData);
      localStorage.setItem("active_resume_id", data.resume_id);
      // FIX (bug 2): a fresh upload has no refresh history yet — reset the
      // timestamp so it doesn't show the previously active resume's time.
      setLastRefreshedAt(data.refreshed_at || null);
      const sorted = [...data.results.map(normalizeJob)].sort((a, b) => b.match - a.match);
      const capped  = sorted.slice(0, topNValue); // enforce topN on frontend too
      setJobs(capped);
      setPage(1);
      // FIX: when the new resume has NO matches, clear the selection too.
      // Otherwise selectedJob still holds the PREVIOUS resume's job (and its
      // `match` score), so hasAnalysis stays true and the ATS gauge shows a
      // stale percentage even though the skill panels read as empty.
      if (capped.length > 0) setSelectedJob(capped[0]);
      else setSelectedJob(null);
    } catch (err) {
      // Upload can hit the per-plan resume cap — show upgrade modal if so.
      const info = getUpgradeInfo(err);
      if (info) setUpgradeInfo(info);
      else console.error(err);
    }
    setTimeout(() => setLoading(false), 400);
  };

  /* ── Filter modal cancel ── */
  const handleFilterCancel = () => {
    setShowFilterModal(false);
    setPendingFile(null);
    // reset the file input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /* ── Delete resume ── */
  const deleteResume = async (resumeId) => {
    try {
      await api.delete(`/resume/${resumeId}`);
      const updated = savedResumes.filter(r => r.id !== resumeId);
      setSavedResumes(updated);
      if (activeResume?.id === resumeId) {
        const next = updated[0] || null;
        setActiveResume(next);
        localStorage.setItem("active_resume_id", next?.id || "");
        if (next) await fetchJobsForResume(next.id);
        else { setJobs([]); setSelectedJob(null); setLastRefreshedAt(null); }
      }
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const handleSelectResume = async (resume) => {
    if (activeResume?.id === resume.id) return;
    setActiveResume(resume);
    localStorage.setItem("active_resume_id", resume.id);
    setSelectedJob(null);
    setJobs([]);
    setPage(1);
    await fetchJobsForResume(resume.id);
    await loadLastRefreshTime(resume.id);
  };

  const exportJobsToExcel = () => {
    if (!jobs?.length) return;
    const data = jobs.map(job => ({
      Title: job.title, Company: job.company, Location: job.location, Match: job.match,
      Link: job.link, StrongSkills: job.strong_skills?.join(", "), WeakSkills: job.weak_skills?.join(", "),
      MissingSkills: job.missing_skills?.join(", "), Summary: job.summary,
      InterviewProbability: job.interview_probability, Expiry: job.expiry,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Jobs");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([buf], { type: "application/octet-stream" }), `jobs_export_${Date.now()}.xlsx`);
  };

  return (
    <div className="h-screen flex bg-gray-950 text-white overflow-hidden relative">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} activePage={activePage} setActivePage={setActivePage} />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden pr-1 relative">
        {activePage === "Dashboard" ? (
          <>
            <div className="shrink-0">
              <ResumeHeader
                activeResume={activeResume}
                savedResumes={savedResumes}
                showResumeSwitcher={showResumeSwitcher}
                setShowResumeSwitcher={setShowResumeSwitcher}
                lastRefreshedAt={lastRefreshedAt}
                onRefresh={handleAgentClick}
                onUpload={() => fileInputRef.current?.click()}
                onExport={exportJobsToExcel}
                onDelete={() => setDeleteTarget(activeResume)}
                onSelectResume={handleSelectResume}
                onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                deleteTarget={deleteTarget}
                setDeleteTarget={setDeleteTarget}
                onConfirmDelete={() => { deleteResume(deleteTarget.id); setDeleteTarget(null); }}
                fileInputRef={fileInputRef}
                handleFileChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>

            {/* Loading overlay */}
            {loading && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-[70%] max-w-md flex flex-col items-center gap-4">
                  <div className="w-full flex justify-between text-xs text-gray-300">
                    <span className="animate-pulse">{status}</span>
                    <span className="text-green-400 font-semibold">{progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs text-gray-400">Analyzing resume & matching jobs...</p>
                </div>
              </div>
            )}

            {/* Body */}
            <div className={`flex flex-1 gap-4 px-4 pb-4 min-h-0 overflow-hidden transition-all duration-300 ${loading || isProcessing ? "blur-sm opacity-40" : ""}`}>
              <JobsTable
                paginated={paginated}
                sortConfig={sortConfig}
                setSortConfig={setSortConfig}
                page={page}
                setPage={setPage}
                totalPages={totalPages}
                getVisiblePages={getVisiblePages}
                onSelectJob={setSelectedJob}
                onOpenAI={() => setShowAIModal(true)}
              />

              <AnalysisPanel
                hasAnalysis={hasAnalysis}
                selectedJob={selectedJob}
                mode={mode}
                setMode={setMode}
                strongSkills={strongSkills}
                weakSkills={weakSkills}
                missingSkills={missingSkills}
                careerSummary={careerSummary}
              />

              <AIApplicationModalPreview
                isOpen={showAIModal}
                onClose={() => setShowAIModal(false)}
                job={selectedJob}
                activeResume={activeResume}
                onUpgradeRequired={(info) => setUpgradeInfo(info)}
                allowRegenerate={Boolean(limits?.allow_regenerate)}
                onOptimized={handleOptimized}
              />
            </div>
          </>
        ) : activePage === "Settings" ? (
          <SettingsPanel />
        ) : activePage === "Batch" ? (
          <BatchPanel />
        ) : activePage === "Admin:overview" ? (
          <AdminPanel subpage="overview" />
        ) : activePage === "Admin:payments" ? (
          <AdminPanel subpage="payments" />
        ) : activePage === "Admin:batches" ? (
          <BatchPanel admin={true} />
        ) : activePage === "Admin:usage" ? (
          <TokenMeter />
        ) : activePage === "Admin:team" ? (
          <TeamPanel />
        ) : activePage === "Admin:prompts" ? (
          <AdminPanel subpage="prompts" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-gray-500">{activePage}</div>
        )}
      </div>

      {/* Filter modal — shown when user picks a file (upload flow) */}
      <ResumeFilterModal
        isOpen={showFilterModal}
        resumeName={pendingFile?.name || ""}
        onConfirm={handleFilterConfirm}
        onCancel={handleFilterCancel}
      />

      {/* Edit-filters modal — shown when Agent is clicked (refresh flow).
          key forces a remount so fields reflect the current saved filters. */}
      <ResumeFilterModal
        key={refreshModalKey}
        isOpen={showRefreshModal}
        resumeName={activeResume?.name || ""}
        resumeId={activeResume?.id || null}
        initialFilters={refreshInitialFilters}
        confirmLabel="🔄 Refresh Jobs"
        onConfirm={handleRefreshConfirm}
        onCancel={() => setShowRefreshModal(false)}
      />

      {/* Upgrade modal — opens when a gated feature or plan limit returns 403. */}
      <UpgradeModal info={upgradeInfo} onClose={() => setUpgradeInfo(null)} />

      {/* Periodic feedback prompt — after an optimization, max once / 30 days. */}
      <FeedbackModal
        open={showFeedback}
        source="optimization"
        onClose={() => setShowFeedback(false)}
      />

      {/* Checking-upload loader — shown briefly while we validate a picked file
          (cap + duplicate) before the filter modal opens. */}
      {checkingUpload && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-2xl border border-emerald-400/20 bg-gray-900/80">
            <div className="w-8 h-8 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin" />
            <p className="text-xs text-gray-300">Checking your resume…</p>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-fadeIn">
          <div className={`px-5 py-3 rounded-xl shadow-xl border backdrop-blur-xl text-sm font-medium max-w-md text-center ${
            toast.type === "error"
              ? "bg-red-500/15 border-red-400/30 text-red-200"
              : "bg-emerald-500/15 border-emerald-400/30 text-emerald-100"
          }`}>
            {toast.message}
          </div>
        </div>
      )}

      <style>{`
        .animate-fadeIn { animation: fadeIn 200ms ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        ::-webkit-scrollbar { display: none; }
        /* FIX (bug 4): re-enable a visible scrollbar inside the resume switcher
           dropdown, overriding the global hidden-scrollbar rule above. */
        .resume-switcher-scroll::-webkit-scrollbar { display: block; width: 6px; }
        .resume-switcher-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
        .resume-switcher-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}