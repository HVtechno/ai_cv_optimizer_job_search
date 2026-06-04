import { useRef, useState, useEffect } from "react";
import { Sparkles } from "lucide-react";

export default function JobsTable({
  paginated, sortConfig, setSortConfig,
  page, setPage, totalPages, getVisiblePages,
  onSelectJob, onOpenAI,
}) {
  // Scroll-hint state — mirrors AnalysisPanel. Show a fade + bouncing chevron
  // only when the rows list has more content below the fold (helps small
  // screens where the jobs run past the visible area). Clicking scrolls down.
  const scrollRef = useRef(null);
  const [showFade, setShowFade] = useState(false);

  const updateFade = () => {
    const el = scrollRef.current;
    if (!el) return;
    const moreBelow = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
    setShowFade(moreBelow);
  };

  // Re-check on mount and whenever the visible rows / page change (these change
  // the scrollable height). Small timeout lets layout settle before measuring.
  useEffect(() => {
    const t = setTimeout(updateFade, 50);
    window.addEventListener("resize", updateFade);
    return () => { clearTimeout(t); window.removeEventListener("resize", updateFade); };
  }, [paginated, page]);

  return (
    <div className="flex-[1.5] min-w-0 bg-white/5 rounded-xl flex flex-col">
      {/* Header */}
      <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_0.7fr_0.5fr] gap-4 p-4 border-b border-gray-700 font-bold text-sm uppercase tracking-wide text-gray-400">
        <div>Title</div>
        <div>Company</div>
        <div>Link</div>

        <div className="flex items-center gap-2 cursor-pointer select-none hover:text-white transition"
          onClick={() => setSortConfig(prev => ({ key: "expiry", direction: prev.key === "expiry" && prev.direction === "asc" ? "desc" : "asc" }))}>
          Expiry
          <span className={`text-sm transition ${sortConfig.key === "expiry" ? "text-green-400" : "text-gray-500"}`}>
            {sortConfig.key === "expiry" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </div>

        <div className="flex items-center gap-2 cursor-pointer select-none hover:text-white transition"
          onClick={() => setSortConfig(prev => ({ key: "match", direction: prev.key === "match" && prev.direction === "asc" ? "desc" : "asc" }))}>
          Match
          <span className={`text-sm transition ${sortConfig.key === "match" ? "text-green-400" : "text-gray-500"}`}>
            {sortConfig.key === "match" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </div>

        <div>Align</div>
      </div>

      {/* Rows — wrapper is relative so the fade overlay can pin to the bottom edge */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          onScroll={updateFade}
          className="h-full overflow-y-auto pr-1 scrollbar-thin"
        >
          {paginated.length > 0 ? (
            paginated.map((job) => (
              <div key={job.id}
                className="grid grid-cols-[2fr_1.5fr_1fr_1fr_0.7fr_0.5fr] gap-4 p-4 border-b border-gray-800 hover:bg-gray-800/70 cursor-pointer text-sm transition-all duration-200 items-center h-[56px]"
                onClick={() => onSelectJob(job)}>
                <div className="truncate font-medium text-white">{job.title}</div>
                <div className="truncate text-gray-300">{job.company}</div>
                <div>
                  {job.link
                    ? <a href={job.link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline" onClick={e => e.stopPropagation()}>View</a>
                    : <span className="text-gray-500">No link</span>}
                </div>
                <div className="text-gray-400 whitespace-nowrap">{job.expiry}</div>
                <div className="text-green-400 font-semibold">{job.match}%</div>
                <div>
                  <button onClick={e => { e.stopPropagation(); onSelectJob(job); onOpenAI(); }}
                    className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition">
                    <Sparkles size={16} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">No analysis available</div>
          )}
        </div>

        {/* Scroll hint — only when there's more content below the fold.
            A gentle fade plus a bouncing chevron; both disappear at the bottom.
            Clicking the chevron scrolls the rows list down. */}
        {showFade && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-1 h-16 bg-gradient-to-t from-gray-950/90 to-transparent flex items-end justify-center pb-1">
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

      {/* Pagination */}
      <div className="flex items-center justify-center gap-3 p-4">
        {page > 1 && (
          <button onClick={() => setPage(page - 1)} className="px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 transition text-sm">←</button>
        )}
        {getVisiblePages().map((p, idx) => {
          if (p === "prev" || p === "next") return null;
          return (
            <button key={idx} onClick={() => setPage(p)}
              className={`w-9 h-9 rounded-full text-sm font-medium transition-all duration-200 ${page === p ? "bg-green-500 text-black scale-110 shadow-lg shadow-green-500/30" : "bg-gray-800 hover:bg-gray-700 text-gray-300"}`}>
              {p}
            </button>
          );
        })}
        {page < totalPages && (
          <button onClick={() => setPage(page + 1)} className="px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 transition text-sm">→</button>
        )}
      </div>
    </div>
  );
}