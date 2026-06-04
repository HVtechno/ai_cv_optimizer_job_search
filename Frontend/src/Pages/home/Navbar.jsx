import { motion, AnimatePresence } from "framer-motion";
import VeloraLogo from "../../components/VeloraLogo";

export default function Navbar({ t, lang, setLang, menuOpen, setMenuOpen, scrollTo, howRef, featuresRef, pricingRef, onAuthOpen }) {
  const navItems = [
    { label: t.nav.how, ref: howRef },
    { label: t.nav.features, ref: featuresRef },
    { label: t.nav.pricing, ref: pricingRef },
  ];

  return (
    <>
      {/* Mobile Menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mobile-menu">
            <div style={{ position: "absolute", top: 20, right: 20, cursor: "pointer", fontSize: 24, color: "var(--muted)" }} onClick={() => setMenuOpen(false)}>✕</div>
            <VeloraLogo size={22} />
            {navItems.map(({ label, ref }) => (
              <span key={label} className="mobile-nav-link" onClick={() => scrollTo(ref)}>{label}</span>
            ))}
            <div className="lang-toggle" style={{ marginTop: 8 }}>
              <button className={`lang-btn${lang === "en" ? " active" : ""}`} onClick={() => setLang("en")}>EN</button>
              <button className={`lang-btn${lang === "nl" ? " active" : ""}`} onClick={() => setLang("nl")}>NL</button>
            </div>
            <button className="btn-primary" style={{ fontSize: 15, padding: "14px 36px" }} onClick={() => { setMenuOpen(false); onAuthOpen(); }}>{t.nav.cta} →</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky Nav */}
      <motion.nav
        initial={{ y: -56, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.55, ease: "easeOut" }}
        style={{ position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 48px", background: "rgba(3,8,13,0.88)", backdropFilter: "blur(18px)", borderBottom: "1px solid rgba(255,255,255,0.055)" }}
      >
        <VeloraLogo size={19} />
        <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {navItems.map(({ label, ref }) => (
            <span key={label} onClick={() => scrollTo(ref)}
              style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", cursor: "pointer", fontFamily: "var(--font-body)", transition: "color .18s" }}
              onMouseEnter={e => e.target.style.color = "var(--text)"} onMouseLeave={e => e.target.style.color = "var(--muted)"}>
              {label}
            </span>
          ))}
          <div className="lang-toggle">
            <button className={`lang-btn${lang === "en" ? " active" : ""}`} onClick={() => setLang("en")}>EN</button>
            <button className={`lang-btn${lang === "nl" ? " active" : ""}`} onClick={() => setLang("nl")}>NL</button>
          </div>
          <button className="btn-primary" style={{ padding: "9px 20px", fontSize: 13 }} onClick={onAuthOpen}>{t.nav.cta} →</button>
        </div>
        <div className="hamburger" onClick={() => setMenuOpen(true)}>
          <span /><span /><span />
        </div>
      </motion.nav>
    </>
  );
}
