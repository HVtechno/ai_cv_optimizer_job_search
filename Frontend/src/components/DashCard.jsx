import { useRef, useState } from "react";
import { motion } from "framer-motion";

const BAR_DATA = [28, 40, 33, 56, 44, 60, 48, 71, 55, 94];

export default function DashCard({ t }) {
  const ref = useRef();
  const [tilt, setTilt] = useState({ x: 5, y: -3 });
  const isMobile = window.innerWidth <= 768;

  const onMove = (e) => {
    if (isMobile) return;
    const r = ref.current.getBoundingClientRect();
    setTilt({
      x: -(e.clientY - r.top - r.height / 2) / r.height * 9,
      y: (e.clientX - r.left - r.width / 2) / r.width * 9,
    });
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setTilt({ x: 5, y: -3 })}
      animate={{ rotateX: isMobile ? 0 : tilt.x, rotateY: isMobile ? 0 : tilt.y }}
      transition={{ type: "spring", stiffness: 100, damping: 22 }}
      className="dash-3d"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 22, padding: 24, transformStyle: "preserve-3d", boxShadow: "0 32px 90px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,232,122,0.05), inset 0 1px 0 rgba(255,255,255,0.055)", cursor: "default" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Resume Intelligence Hub</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, fontFamily: "var(--font-body)" }}>{t.dashUpdated}</div>
        </div>
        <motion.div animate={{ opacity: [1, 0.45, 1] }} transition={{ duration: 2, repeat: Infinity }}
          style={{ background: "rgba(0,232,122,0.09)", border: "1px solid rgba(0,232,122,0.22)", color: "var(--g1)", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 100, display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font-body)", flexShrink: 0 }}>
          <span className="live-dot" style={{ width: 6, height: 6 }} />Live
        </motion.div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18 }}>
        {t.dashStats.map(([num, lbl], i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.1 }}
            style={{ background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 8px" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, background: "linear-gradient(130deg,var(--g1),var(--g2))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{num}</div>
            <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2, fontFamily: "var(--font-body)" }}>{lbl}</div>
          </motion.div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40, marginBottom: 18 }}>
        {BAR_DATA.map((h, i) => (
          <motion.div key={i} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.06 * i, duration: 0.45 }}
            style={{ flex: 1, borderRadius: "3px 3px 0 0", height: `${h}%`, background: i === BAR_DATA.length - 1 ? "linear-gradient(180deg,var(--g1),rgba(0,232,122,0.3))" : "rgba(255,255,255,0.07)", transformOrigin: "bottom" }} />
        ))}
      </div>

      {t.dashJobs.map((j, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i === 0 ? 8 : 0, background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.065)", borderRadius: 10, padding: "9px 12px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.role} · {j.co}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, fontFamily: "var(--font-body)" }}>{j.note}</div>
          </div>
          <div style={{ position: "relative", width: 34, height: 34, flexShrink: 0 }}>
            <svg viewBox="0 0 34 34" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
              <circle cx="17" cy="17" r="13" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
              <motion.circle cx="17" cy="17" r="13" fill="none" stroke={i === 0 ? "var(--g1)" : "var(--g2)"} strokeWidth="3" strokeLinecap="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: [96, 93][i] / 100 }}
                transition={{ delay: 0.7 + i * 0.15, duration: 1.1, ease: "easeOut" }}
                strokeDasharray={`${[96, 93][i] * 0.816} 81.6`} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: i === 0 ? "var(--g1)" : "var(--g2)", fontFamily: "var(--font-display)" }}>{[96, 93][i]}</div>
          </div>
        </div>
      ))}
    </motion.div>
  );
}
