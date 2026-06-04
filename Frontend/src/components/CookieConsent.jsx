import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { startPresence, stopPresence } from "./Presence";

// Self-contained cookie consent banner.
//
// - On "Accept": stores consent and STARTS the presence tracker.
// - On "Necessary only": stores the choice and does NOT track.
// - On a returning visit where consent was already accepted, it auto-starts
//   the tracker and stays hidden.
//
// Persisted in localStorage under "cookieConsent": "accepted" | "necessary".
// This is the same key referenced in the Privacy/Cookie pages.

const CONSENT_KEY = "cookieConsent";

export default function CookieConsent({ t }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const choice = localStorage.getItem(CONSENT_KEY);
    if (choice === "accepted") {
      // Returning visitor who already opted in — resume tracking silently.
      startPresence();
    } else if (!choice) {
      // No decision yet — show the banner.
      setVisible(true);
    }
    // choice === "necessary" -> stay hidden, do not track.
  }, []);

  const acceptAll = () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    setVisible(false);
    startPresence();
  };

  const necessaryOnly = () => {
    localStorage.setItem(CONSENT_KEY, "necessary");
    setVisible(false);
    stopPresence();
  };

  if (!visible) return null;

  // Optional i18n: falls back to English if no `t` prop is passed.
  const text = {
    message:
      (t && t.cookieBannerText) ||
      "We use cookies to keep you logged in and, with your consent, to measure how many visitors are active on the site. See our Cookie Policy for details.",
    accept: (t && t.cookieAccept) || "Accept all",
    necessary: (t && t.cookieNecessary) || "Necessary only",
    link: (t && t.cookieLinkLabel) || "Cookie Policy",
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 300,
        width: "calc(100% - 32px)",
        maxWidth: 640,
        background: "var(--surface, #0C1318)",
        border: "1px solid var(--border, rgba(255,255,255,0.1))",
        borderRadius: 16,
        padding: "18px 20px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 14,
        fontFamily: "var(--font-body)",
      }}
    >
      <p
        style={{
          flex: "1 1 260px",
          margin: 0,
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--muted, rgba(237,246,242,0.7))",
        }}
      >
        {text.message}{" "}
        <Link
          to="/cookies"
          style={{ color: "var(--g1)", textDecoration: "underline", fontWeight: 600 }}
        >
          {text.link}
        </Link>
      </p>

      <div style={{ display: "flex", gap: 10, flex: "0 0 auto" }}>
        <button
          onClick={necessaryOnly}
          style={{
            padding: "9px 16px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-body)",
            background: "transparent",
            color: "var(--text, #EDF6F2)",
            border: "1px solid var(--border, rgba(255,255,255,0.14))",
            cursor: "pointer",
          }}
        >
          {text.necessary}
        </button>
        <button
          onClick={acceptAll}
          style={{
            padding: "9px 18px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "var(--font-body)",
            background: "linear-gradient(135deg,var(--g1),var(--g2))",
            color: "var(--dark, #0C1318)",
            border: "none",
            cursor: "pointer",
          }}
        >
          {text.accept}
        </button>
      </div>
    </div>
  );
}