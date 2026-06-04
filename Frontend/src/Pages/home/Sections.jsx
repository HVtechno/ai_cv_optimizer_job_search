import { motion } from "framer-motion";
import { TypeAnimation } from "react-type-animation";
import Reveal from "../../components/Reveal";
import CrawlWindow from "../../components/CrawlWindow";
import DashCard from "../../components/DashCard";
import VeloraLogo from "../../components/VeloraLogo";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { startCheckout } from "../../components/Billing";

// Your sales inbox for Enterprise "Contact sales".
const ENTERPRISE_EMAIL = "support@resuviq-ai.nl";

/* ── HOW IT WORKS ── */
export function HowItWorksSection({ t, sectionRef }) {
  return (
    <div ref={sectionRef} className="section-wrap" style={{ paddingTop: 100 }}>
      <Reveal>
        <div className="eyebrow">{t.howEyebrow}</div>
        <h2 className="section-h2 display-heading" style={{ fontSize: "clamp(26px,5vw,46px)", marginBottom: 14 }}>
          {t.howH2[0]}<span className="grad-text">{t.howH2[1]}</span>
        </h2>
        <p className="body-text" style={{ maxWidth: 480, marginBottom: 44 }}>{t.howSub}</p>
      </Reveal>
      <div className="grid-2-equal">
        {t.steps.map((step, i) => (
          <Reveal key={i} delay={i * 0.08}>
            <motion.div whileHover={{ y: -3, borderColor: "var(--border-hover)" }} className="velora-card" style={{ padding: "22px 20px" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700, color: "var(--g1)", letterSpacing: 2, marginBottom: 10, opacity: 0.7 }}>{step.n}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{step.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7, fontFamily: "var(--font-body)" }}>{step.desc}</div>
            </motion.div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* ── DAILY SCRAPE ── */
export function DailyScrapeSection({ t }) {
  return (
    <div className="section-wrap">
      <div className="grid-2">
        <Reveal>
          <div className="eyebrow">{t.crawlEyebrow}</div>
          <h2 className="section-h2 display-heading" style={{ fontSize: "clamp(24px,4vw,40px)", marginBottom: 14 }}>
            {t.crawlH2[0]}<br /><span className="grad-text">{t.crawlH2[1]}</span>
          </h2>
          <p className="body-text" style={{ marginBottom: 24 }}>{t.crawlBody}</p>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {t.crawlBullets.map(b => (
              <li key={b} style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 10, fontFamily: "var(--font-body)" }}>
                <span style={{ color: "var(--g1)", fontWeight: 700, flexShrink: 0 }}>✓</span>{b}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1}><CrawlWindow t={t} /></Reveal>
      </div>
    </div>
  );
}

/* ── AI TYPING ── */
export function AITypingSection({ t, lang }) {
  return (
    <div className="section-wrap">
      <Reveal>
        <div className="eyebrow">{t.aiEyebrow}</div>
        <h2 className="section-h2 display-heading" style={{ fontSize: "clamp(24px,4vw,40px)", marginBottom: 14 }}>
          {t.aiH2[0]}<br /><span className="grad-text">{t.aiH2[1]}</span>
        </h2>
        <p className="body-text" style={{ maxWidth: 460, marginBottom: 32 }}>{t.aiBody}</p>
      </Reveal>
      <Reveal delay={0.1}>
        <div className="velora-card" style={{ overflow: "hidden" }}>
          <div style={{ background: "rgba(0,201,255,0.04)", borderBottom: "1px solid var(--border)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,var(--g1),var(--g2))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "var(--dark)", fontFamily: "var(--font-display)", flexShrink: 0 }}>V</div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-display)" }}>Resuviq AI</span>
            <motion.span animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.3, repeat: Infinity }}
              style={{ marginLeft: "auto", fontSize: 11, color: "var(--g1)", fontWeight: 700, fontFamily: "var(--font-body)", whiteSpace: "nowrap" }}>
              {t.aiAnalyzing}
            </motion.span>
          </div>
          <div style={{ padding: "22px 20px 18px" }}>
            <TypeAnimation key={lang} sequence={[1000, t.aiTyping]} wrapper="p" speed={68}
              style={{ fontSize: 13, lineHeight: 1.88, color: "rgba(237,246,242,0.72)", whiteSpace: "pre-line", fontFamily: "var(--font-body)" }} cursor />
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 7, fontFamily: "var(--font-body)" }}>
                <span style={{ color: "var(--muted)" }}>{t.atsLabel}</span>
                <span style={{ color: "var(--g1)", fontWeight: 700, fontFamily: "var(--font-display)" }}>96 / 100</span>
              </div>
              <div style={{ height: 7, background: "rgba(255,255,255,0.05)", borderRadius: 100, overflow: "hidden" }}>
                <motion.div initial={{ width: 0 }} whileInView={{ width: "96%" }} viewport={{ once: true }} transition={{ delay: 0.4, duration: 1.5, ease: "easeOut" }}
                  style={{ height: "100%", background: "linear-gradient(90deg,var(--g1),var(--g2))", borderRadius: 100 }} />
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* ── DASHBOARD PREVIEW ── */
export function DashboardSection({ t }) {
  return (
    <div className="section-wrap">
      <Reveal>
        <div className="eyebrow">{t.dashEyebrow}</div>
        <h2 className="section-h2 display-heading" style={{ fontSize: "clamp(24px,4vw,40px)", marginBottom: 14 }}>
          {t.dashH2[0]}<br /><span className="grad-text">{t.dashH2[1]}</span>
        </h2>
        <p className="body-text" style={{ maxWidth: 460, marginBottom: 36 }}>{t.dashBody}</p>
      </Reveal>
      <Reveal delay={0.1}>
        <div style={{ perspective: "1100px" }}><DashCard t={t} /></div>
      </Reveal>
    </div>
  );
}

/* ── FEATURES ── */
export function FeaturesSection({ t, sectionRef }) {
  return (
    <div ref={sectionRef} className="section-wrap">
      <Reveal>
        <div className="eyebrow">{t.featEyebrow}</div>
        <h2 className="section-h2 display-heading" style={{ fontSize: "clamp(24px,4vw,40px)", marginBottom: 14 }}>
          {t.featH2[0]}<br /><span className="grad-text">{t.featH2[1]}</span>
        </h2>
        <p className="body-text" style={{ maxWidth: 440, marginBottom: 40 }}>{t.featBody}</p>
      </Reveal>
      <div className="grid-3">
        {t.features.map((f, i) => (
          <Reveal key={i} delay={i * 0.07}>
            <motion.div whileHover={{ y: -4, borderColor: "var(--border-hover)" }} className="velora-card" style={{ padding: "20px 18px" }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, marginBottom: 12, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", background: `rgba(${f.accent === "var(--g1)" ? "0,232,122" : "0,201,255"},0.09)` }}>{f.icon}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 7 }}>{f.label}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7, fontFamily: "var(--font-body)" }}>{f.desc}</div>
            </motion.div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}


/* ── PRICING ──*/
export function PricingSection({ t, sectionRef, onAuthOpen }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  // Resolve a plan's id robustly (explicit id, else infer from the name).
  const planId = (plan) =>
    (plan.id || plan.name || "").toString().toLowerCase().includes("pro")
      ? "pro"
      : (plan.id || plan.name || "").toString().toLowerCase().includes("enterprise")
      ? "enterprise"
      : "basic";

  // Decide what each button does.
  const handlePlanClick = async (plan) => {
    const id = planId(plan);

    if (id === "enterprise") {
      const subject = encodeURIComponent("Resuviq Enterprise — Inquiry");
      const body = encodeURIComponent(
        "Hi Resuviq team,\n\nWe're interested in Resuviq Enterprise. Here are some details:\n\n" +
        "- Organization:\n- Number of seats:\n- Timeline:\n\nThanks!"
      );
      window.location.href = `mailto:${ENTERPRISE_EMAIL}?subject=${subject}&body=${body}`;
      return;
    }

    if (id === "pro") {
      if (!user) { onAuthOpen(); return; }       // must be signed in to subscribe
      try {
        setBusy(true);
        await startCheckout("monthly");
      } catch (e) {
        console.error("Checkout failed", e);
        setBusy(false);
      }
      return;
    }

    // Free / Basic
    onAuthOpen();
  };

  // Per-plan price label. Pro is fixed monthly; Free/Enterprise use translations.
  const priceFor = (plan) => {
    const id = planId(plan);
    if (id === "pro") {
      return { price: "€29", period: "/month" };
    }
    return { price: plan.price, period: plan.period };
  };

  return (
    <div ref={sectionRef} className="section-wrap">
      <Reveal>
        <div className="eyebrow">{t.pricingEyebrow}</div>
        <h2 className="section-h2 display-heading" style={{ fontSize: "clamp(24px,4vw,40px)", marginBottom: 14 }}>
          {t.pricingH2[0]} <span className="grad-text">{t.pricingH2[1]}</span>
        </h2>
        <p className="body-text" style={{ maxWidth: 400, marginBottom: 44 }}>{t.pricingSub}</p>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="grid-pricing">
          {t.plans.map((plan, i) => {
            const id = planId(plan);
            const { price, period: periodLabel } = priceFor(plan);
            const isProBusy = busy && id === "pro";

            return (
              <motion.div key={i} whileHover={{ y: -4 }} style={{ position: "relative" }}>
                {plan.tag && (
                  <div style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,var(--g1),var(--g2))", color: "var(--dark)", fontSize: 11, fontWeight: 800, padding: "3px 16px", borderRadius: 100, whiteSpace: "nowrap", fontFamily: "var(--font-body)" }}>
                    {plan.tag} ✦
                  </div>
                )}
                <div style={{ background: plan.featured ? "rgba(0,232,122,0.045)" : "var(--surface)", border: `1px solid ${plan.featured ? "rgba(0,232,122,0.28)" : "var(--border)"}`, borderRadius: 18, padding: 22, height: "100%", display: "flex", flexDirection: "column" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{plan.name}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 20 }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, background: "linear-gradient(130deg,var(--g1),var(--g2))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{price}</span>
                    <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--font-body)" }}>{periodLabel}</span>
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9, marginBottom: 22 }}>
                    {plan.perks.map((p, j) => (
                      <div key={j} style={{ fontSize: 12.5, color: "var(--muted)", display: "flex", gap: 8, fontFamily: "var(--font-body)" }}>
                        <span style={{ color: "var(--g1)", fontWeight: 700, flexShrink: 0, fontSize: 11 }}>✓</span>{p}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => handlePlanClick(plan)}
                    disabled={isProBusy}
                    style={{ width: "100%", padding: "11px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)", cursor: isProBusy ? "wait" : "pointer", background: plan.featured ? "linear-gradient(135deg,var(--g1),var(--g2))" : "transparent", color: plan.featured ? "var(--dark)" : "var(--muted)", border: plan.featured ? "none" : "1px solid var(--border)", transition: "opacity .15s", opacity: isProBusy ? 0.7 : 1 }}
                    onMouseEnter={e => !isProBusy && (e.target.style.opacity = "0.82")}
                    onMouseLeave={e => !isProBusy && (e.target.style.opacity = "1")}
                  >
                    {isProBusy ? "Redirecting…" : `${plan.cta} →`}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Reveal>
    </div>
  );
}

/* ── FOOTER CTA BANNER + FOOTER ── */
export function FooterSection({ t, scrollTo, howRef, featuresRef, pricingRef, onAuthOpen, navigate }) {
  return (
    <>
      <div className="section-wrap" style={{ paddingBottom: 60 }}>
        <Reveal>
          <div style={{ textAlign: "center", padding: "56px 32px", background: "linear-gradient(135deg,rgba(0,232,122,0.07),rgba(0,201,255,0.05))", border: "1px solid rgba(0,232,122,0.14)", borderRadius: 22 }}>
            <VeloraLogo size={20} />
            <h3 className="display-heading" style={{ fontSize: "clamp(22px,3.5vw,38px)", margin: "20px 0 12px" }}>{t.footerH}</h3>
            <p className="body-text" style={{ maxWidth: 380, margin: "0 auto 28px" }}>{t.footerSub}</p>
            <button className="btn-primary" style={{ fontSize: 15 }} onClick={onAuthOpen}>{t.footerCta}</button>
          </div>
        </Reveal>
      </div>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.055)", background: "rgba(0,0,0,0.22)", padding: "40px 48px 28px" }}>
        <div style={{ maxWidth: "var(--max-w)", margin: "0 auto" }}>
          <div className="footer-top" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 24 }}>
            <div>
              <VeloraLogo size={17} />
              <p style={{ fontSize: 12, color: "rgba(237,246,242,0.3)", marginTop: 10, maxWidth: 210, fontFamily: "var(--font-body)", lineHeight: 1.65 }}>{t.footerTagline}</p>
            </div>
            <div className="footer-cols" style={{ display: "flex", gap: 44, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--g1)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12, fontFamily: "var(--font-body)" }}>Product</div>
                {[{ label: t.nav.how, ref: howRef }, { label: t.nav.features, ref: featuresRef }, { label: t.nav.pricing, ref: pricingRef }].map(({ label, ref }) => (
                  <div key={label} style={{ marginBottom: 8 }}>
                    <span className="footer-link" onClick={() => scrollTo(ref)}>{label}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--g1)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12, fontFamily: "var(--font-body)" }}>Legal</div>
                {t.footerLinks.map(link => (
                  <div key={link.label} style={{ marginBottom: 8 }}>
                    <span className="footer-link" onClick={() => navigate(link.path)}>{link.label}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--g1)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12, fontFamily: "var(--font-body)" }}>Contact</div>
                {[
                  {
                    label: "support@resuviq-ai.nl",
                    href: "mailto:support@resuviq-ai.nl",
                    external: false,
                    icon: (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-10 5L2 7" />
                      </svg>
                    ),
                  },
                  {
                    label: "Amsterdam, The Netherlands",
                    href: null,
                    external: false,
                    icon: (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    ),
                  },
                  {
                    label: "LinkedIn",
                    href: "https://www.linkedin.com/company/resuviq-ai",
                    external: true,
                    icon: (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
                      </svg>
                    ),
                  },
                ].map(({ label, href, external, icon }) => (
                  <div key={label} style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "var(--g1)", display: "inline-flex" }}>{icon}</span>
                    {href
                      ? <a href={href} className="footer-link" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{label}</a>
                      : <span style={{ fontSize: 12, color: "rgba(237,246,242,0.3)", fontFamily: "var(--font-body)" }}>{label}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="footer-bottom" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap", gap: 12 }}>
            <p style={{ fontSize: 12, color: "rgba(237,246,242,0.26)", fontFamily: "var(--font-body)" }}>{t.footerCopy}</p>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              {t.footerLinks.map(link => (
                <span key={link.label} className="footer-link" onClick={() => navigate(link.path)}>{link.label}</span>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}