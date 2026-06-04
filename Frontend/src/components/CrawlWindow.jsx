import { useState, useEffect } from "react";
import { motion } from "framer-motion";

const MOCK_JOBS = [
  { role: "Senior AI/ML Engineer", company: "Anthropic", loc: "SF · Remote", score: 96 },
  { role: "ML Research Engineer", company: "OpenAI", loc: "NYC · Hybrid", score: 93 },
  { role: "AI Product Lead", company: "Google DeepMind", loc: "London · On-site", score: 88 },
  { role: "LLM Platform Engineer", company: "Mistral AI", loc: "Paris · Hybrid", score: 84 },
  { role: "AI Safety Researcher", company: "Cohere", loc: "Toronto · Remote", score: 81 },
];

export default function CrawlWindow({ t }) {
  const [shown, setShown] = useState(0);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    if (shown >= MOCK_JOBS.length) return;
    const timer = setTimeout(() => setShown(s => s + 1), 650);
    return () => clearTimeout(timer);
  }, [shown]);

  const handleRefresh = () => {
    setSpinning(true);
    setShown(0);
    setTimeout(() => setSpinning(false), 600);
  };

  return (
    <div className="velora-card" style={{ overflow: "hidden" }}>
      <div style={{ background: "rgba(0,232,122,0.04)", borderBottom: "1px solid var(--border)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 7 }}>
        {["#FF5F57", "#FFBD2E", "#28C840"].map(c => (
          <div key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />
        ))}
        <div style={{ flex: 1, marginLeft: 8, background: "rgba(255,255,255,0.05)", borderRadius: 5, padding: "3px 10px", fontFamily: "monospace", fontSize: 10, color: "rgba(237,246,242,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <motion.span animate={{ opacity: [0.35, 0.8, 0.35] }} transition={{ duration: 2.5, repeat: Infinity }}>
            resuviq-ai · scraper · last_24h_jobs.json
          </motion.span>
        </div>
        <motion.button onClick={handleRefresh} whileTap={{ scale: 0.9 }}
          animate={spinning ? { rotate: 360 } : { rotate: 0 }}
          transition={{ duration: 0.55 }}
          style={{ background: "rgba(0,232,122,0.1)", border: "1px solid rgba(0,232,122,0.22)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: "var(--g1)", fontWeight: 700, fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
        >↻ Refresh</motion.button>
      </div>

      <div style={{ padding: "8px 14px 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <motion.span animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 2, repeat: Infinity }}
          style={{ fontSize: 10, fontWeight: 700, color: "var(--g1)", letterSpacing: 0.8 }}>
          ● {t.crawlBadge}
        </motion.span>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>· {new Date().toLocaleDateString()}</span>
      </div>

      <div style={{ padding: "4px 14px 6px" }}>
        {MOCK_JOBS.slice(0, shown).map((job, i) => (
          <motion.div key={`${i}-${shown}`} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", marginBottom: 7, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}>
            <div style={{ width: 28, height: 28, background: "#0077B5", borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", fontFamily: "sans-serif" }}>in</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.role}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{job.company} · {job.loc}</div>
            </div>
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.25, type: "spring", stiffness: 220 }}
              style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: job.score >= 90 ? "rgba(0,232,122,0.1)" : "rgba(0,201,255,0.1)", border: `1px solid ${job.score >= 90 ? "rgba(0,232,122,0.25)" : "rgba(0,201,255,0.25)"}`, color: job.score >= 90 ? "var(--g1)" : "var(--g2)", whiteSpace: "nowrap", flexShrink: 0 }}>
              {job.score}%
            </motion.div>
          </motion.div>
        ))}
      </div>

      <div style={{ padding: "4px 14px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 100, overflow: "hidden" }}>
          <motion.div animate={{ width: `${(shown / MOCK_JOBS.length) * 100}%` }} transition={{ duration: 0.45 }}
            style={{ height: "100%", background: "linear-gradient(90deg,var(--g1),var(--g2))", borderRadius: 100 }} />
        </div>
        <span style={{ fontSize: 10, color: "rgba(237,246,242,0.3)", whiteSpace: "nowrap", fontFamily: "var(--font-body)" }}>{shown}/{MOCK_JOBS.length} {t.crawlFooter}</span>
      </div>
    </div>
  );
}
