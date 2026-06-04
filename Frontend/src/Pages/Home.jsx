import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { T } from "../constants/translations";
import GlobalStyles from "../components/GlobalStyles";
import AuthModal from "../components/AuthModal";
import Navbar from "./home/Navbar";
import HeroSection from "./home/HeroSection";
import {
  HowItWorksSection,
  DailyScrapeSection,
  AITypingSection,
  DashboardSection,
  FeaturesSection,
  PricingSection,
  FooterSection,
} from "./home/Sections";

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [lang, setLang] = useState("en");
  const [menuOpen, setMenuOpen] = useState(false);
  const t = T[lang];

  const howRef = useRef(null);
  const featuresRef = useRef(null);
  const pricingRef = useRef(null);

  useEffect(() => {
    if (user) navigate("/dashboard");
  }, [user]);

  const scrollTo = (ref) => {
    setMenuOpen(false);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ background: "var(--dark)", color: "var(--text)", minHeight: "100vh", overflowX: "hidden" }}>
      <GlobalStyles />

      <Navbar
        t={t} lang={lang} setLang={setLang}
        menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        scrollTo={scrollTo}
        howRef={howRef} featuresRef={featuresRef} pricingRef={pricingRef}
        onAuthOpen={() => setShowAuth(true)}
      />

      <HeroSection t={t} onAuthOpen={() => setShowAuth(true)} scrollToHow={() => scrollTo(howRef)} />

      <HowItWorksSection t={t} sectionRef={howRef} />
      <div className="section-divider" />

      <DailyScrapeSection t={t} />
      <div className="section-divider" />

      <AITypingSection t={t} lang={lang} />
      <div className="section-divider" />

      <DashboardSection t={t} />
      <div className="section-divider" />

      <FeaturesSection t={t} sectionRef={featuresRef} />
      <div className="section-divider" />

      <PricingSection t={t} sectionRef={pricingRef} onAuthOpen={() => setShowAuth(true)} />

      <FooterSection
        t={t} scrollTo={scrollTo}
        howRef={howRef} featuresRef={featuresRef} pricingRef={pricingRef}
        onAuthOpen={() => setShowAuth(true)} navigate={navigate}
      />

      <AuthModal show={showAuth} onClose={() => setShowAuth(false)} t={t} />
    </div>
  );
}
