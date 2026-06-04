import { useRef, useState, useEffect } from "react";
import Speedometer from "../../components/Speedometer";

const probabilityConfig = {
  high: {
    label: "High",
    gradient: "from-emerald-500/20 to-green-400/10",
    border: "border-green-400/30",
    text: "text-green-300",
    iconBg: "bg-green-400/20",
    iconBorder: "border-green-400/30",
    icon: "↑",
    message: "Recruiters are likely to shortlist this profile.",
  },
  medium: {
    label: "Medium",
    gradient: "from-yellow-500/20 to-amber-400/10",
    border: "border-yellow-400/30",
    text: "text-yellow-300",
    iconBg: "bg-yellow-400/20",
    iconBorder: "border-yellow-400/30",
    icon: "•",
    message: "Profile matches several core requirements.",
  },
  low: {
    label: "Low",
    gradient: "from-red-500/20 to-rose-400/10",
    border: "border-red-400/30",
    text: "text-red-300",
    iconBg: "bg-red-400/20",
    iconBorder: "border-red-400/30",
    icon: "↓",
    message: "Resume requires stronger alignment with the role.",
  },
};

export default function AnalysisPanel({
  hasAnalysis, selectedJob, mode, setMode,
  strongSkills, weakSkills, missingSkills, careerSummary,
}) {
  const probability = selectedJob?.interview_probability?.toLowerCase() || "low";
  const probabilityUI = probabilityConfig[probability] || probabilityConfig.low;
  const atsScore = hasAnalysis ? selectedJob?.match || 0 : null;

  const getSkills = () => {
    if (mode === "strong") return strongSkills;
    if (mode === "weak") return weakSkills;
    if (mode === "gaps") return missingSkills;
    return [];
  };

  // Track whether the panel has more content below the fold, so we can show a
  // fade hint only when it's actually scrollable and not yet at the bottom.
  const scrollRef = useRef(null);
  const [showFade, setShowFade] = useState(false);

  const updateFade = () => {
    const el = scrollRef.current;
    if (!el) return;
    const moreBelow = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
    setShowFade(moreBelow);
  };

  // Re-check on mount and whenever the analysis content changes (it changes the
  // panel height). A small timeout lets layout settle before measuring.
  useEffect(() => {
    const t = setTimeout(updateFade, 50);
    window.addEventListener("resize", updateFade);
    return () => { clearTimeout(t); window.removeEventListener("resize", updateFade); };
  }, [hasAnalysis, careerSummary, mode, strongSkills, weakSkills, missingSkills]);

  return (
    // Wrapper is relative so the fade overlay can pin to the bottom edge.
    <div className="flex-1 h-full min-h-0 relative">
      <div
        ref={scrollRef}
        onScroll={updateFade}
        className="h-full flex flex-col gap-3 min-h-0 overflow-y-auto pr-1"
      >
      {/* Interview Probability — fixed height (shrink-0 stops it being squeezed) */}
      <div className={`shrink-0 relative overflow-hidden rounded-xl border p-3 bg-gradient-to-r ${probabilityUI.gradient} ${probabilityUI.border} transition-all duration-500`}>
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-gray-400">Interview Probability</p>
            <h2 className={`mt-2 text-2xl font-bold ${probabilityUI.text}`}>
              {hasAnalysis ? probabilityUI.label : "No Analysis"}
            </h2>
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
              {hasAnalysis ? probabilityUI.message : "Upload a resume to generate interview insights."}
            </p>
          </div>
          <div className={`relative w-12 h-12 rounded-full flex items-center justify-center border text-lg font-bold backdrop-blur-sm transition-all duration-500 ${probabilityUI.iconBg} ${probabilityUI.iconBorder} ${probabilityUI.text}`}>
            {hasAnalysis ? probabilityUI.icon : "?"}
          </div>
        </div>
      </div>

      {/* ATS Speedometer — fixed height */}
      <div className="shrink-0 bg-white/5 rounded-xl p-3 flex flex-col items-center gap-2">
        <div className="relative">
          {hasAnalysis ? (
            <>
              <Speedometer value={atsScore} />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[12px] uppercase tracking-widest text-gray-400">ATS</span>
              </div>
            </>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-gray-500 text-sm">No analysis available</div>
          )}
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => setMode("strong")} className={`px-2 py-1 rounded ${mode === "strong" ? "bg-green-500/20 text-green-300" : "text-gray-400"}`}>Strong</button>
          <button onClick={() => setMode("weak")} className={`px-2 py-1 rounded ${mode === "weak" ? "bg-yellow-500/20 text-yellow-300" : "text-gray-400"}`}>Weak</button>
          <button onClick={() => setMode("gaps")} className={`px-2 py-1 rounded ${mode === "gaps" ? "bg-red-500/20 text-red-300" : "text-gray-400"}`}>Gaps</button>
        </div>
      </div>

      {/* Skills — fixed height with internal scroll (shrink-0 keeps it from collapsing) */}
      <div className="shrink-0 bg-white/5 rounded-xl p-3 h-32 flex flex-col">
        <h3 className="font-bold mb-2 shrink-0">
          {mode === "strong" && `Strong Skills (${strongSkills.length})`}
          {mode === "weak" && `Weak Skills (${weakSkills.length})`}
          {mode === "gaps" && `Missing Skills (${missingSkills.length})`}
        </h3>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {getSkills().length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-sm text-gray-300">
              {getSkills().map((s, i) => (
                <li key={i} className="px-2 py-1 rounded bg-gray-800 text-gray-200 text-xs">{s}</li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">No analysis available</div>
          )}
        </div>
      </div>

      {/* Career Feedback — fills remaining space on tall screens; on short
          screens the panel scrolls and this keeps a comfortable min height. */}
      <div className="flex-1 min-h-[11rem] bg-white/5 rounded-xl p-3 flex flex-col overflow-hidden">
        <h3 className="font-bold mb-2 shrink-0">AI Career Feedback</h3>
        <div className="flex-1 min-h-0 overflow-y-auto text-sm text-gray-300 pr-1 whitespace-pre-line">
          {careerSummary}
        </div>
      </div>
      </div>

      {/* Scroll hint — only when there's more content below the fold.
          A gentle fade plus a bouncing chevron; both disappear at the bottom.
          Clicking the chevron scrolls the panel down. */}
      {showFade && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-1 h-16 rounded-b-xl bg-gradient-to-t from-gray-950/90 to-transparent flex items-end justify-center pb-1">
          <button
            onClick={() => scrollRef.current?.scrollBy({ top: 240, behavior: "smooth" })}
            className="pointer-events-auto mb-1 w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 flex items-center justify-center animate-bounce hover:bg-emerald-500/30 transition"
            title="Scroll for more"
            aria-label="Scroll down for more"
          >
            ↓
          </button>
        </div>
      )}
    </div>
  );
}