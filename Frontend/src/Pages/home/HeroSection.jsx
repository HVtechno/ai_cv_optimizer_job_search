import { motion, useScroll, useTransform } from "framer-motion";
import Scene3D from "../../components/Scene3D";

export default function HeroSection({ t, onAuthOpen, scrollToHow }) {
  const { scrollYProgress } = useScroll();
  const heroY = useTransform(scrollYProgress, [0, 0.28], [0, -72]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.22], [1, 0]);

  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", display: window.innerWidth > 768 ? "block" : "none" }}>
        <Scene3D />
      </div>
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: "radial-gradient(ellipse 80% 60% at 10% 20%, rgba(0,232,122,0.09) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 90% 80%, rgba(0,201,255,0.07) 0%, transparent 60%)" }} />
      <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,232,122,0.01) 2px,rgba(0,232,122,0.01) 4px)" }} />

      <motion.div style={{ y: heroY, opacity: heroOpacity, zIndex: 2, textAlign: "center", padding: "0 20px", maxWidth: 780, width: "100%" }}>
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "rgba(0,232,122,0.07)", border: "1px solid rgba(0,232,122,0.18)", borderRadius: 100, padding: "6px 16px", fontSize: 12, color: "var(--g1)", marginBottom: 28, fontWeight: 600, fontFamily: "var(--font-body)" }}>
          <span className="live-dot" />{t.heroBadge}
        </motion.div>

        <motion.h1 initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.65 }}
          className="hero-title display-heading" style={{ fontSize: "clamp(36px, 7vw, 72px)", marginBottom: 22 }}>
          {t.heroH1[0]}<br />
          {t.heroH1[1]}<span className="grad-text">{t.heroH1[2]}</span><br />
          <span style={{ color: "rgba(237,246,242,0.5)", fontWeight: 500 }}>{t.heroH1[3]}</span>
        </motion.h1>

        <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="hero-sub" style={{ fontSize: 17, lineHeight: 1.72, color: "var(--muted)", maxWidth: 520, margin: "0 auto 40px" }}>
          {t.heroSub}
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.58 }}
          className="hero-btns" style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={onAuthOpen}>{t.heroCta1}</button>
          <button className="btn-ghost" onClick={scrollToHow}>{t.heroCta2}</button>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
          style={{ fontSize: 11, color: "rgba(237,246,242,0.27)", marginTop: 24, fontFamily: "var(--font-body)" }}>
          {t.heroProof}
        </motion.p>
      </motion.div>

      <motion.div animate={{ y: [0, 9, 0] }} transition={{ duration: 1.6, repeat: Infinity }}
        style={{ position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 9, color: "rgba(237,246,242,0.2)", letterSpacing: 1.5, fontFamily: "var(--font-body)" }}>SCROLL</span>
        <div style={{ width: 1, height: 32, background: "linear-gradient(180deg,rgba(0,232,122,0.4),transparent)" }} />
      </motion.div>
    </div>
  );
}
