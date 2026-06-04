import { useNavigate } from "react-router-dom";
import GlobalStyles from "./GlobalStyles";
import VeloraLogo from "./VeloraLogo";

export function LegalPage({ title, children }) {
  const navigate = useNavigate();
  return (
    <div style={{ background: "var(--dark)", minHeight: "100vh", color: "var(--text)" }}>
      <GlobalStyles />
      <nav style={{ position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 48px", background: "rgba(3,8,13,0.92)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
        <span onClick={() => navigate("/")} style={{ cursor: "pointer" }}><VeloraLogo size={18} /></span>
        <button className="btn-ghost" style={{ padding: "8px 18px", fontSize: 13 }} onClick={() => navigate("/")}>← Back</button>
      </nav>
      <div className="legal-content" style={{ maxWidth: 760, margin: "0 auto", padding: "80px 48px 80px" }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Legal</div>
        <h1 className="legal-h1 display-heading" style={{ fontSize: 38, marginBottom: 10 }}>{title}</h1>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 48, fontFamily: "var(--font-body)" }}>
          Last updated: {new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })} · Resuviq AI B.V., Amsterdam, The Netherlands
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>{children}</div>
      </div>
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.055)", padding: "24px 48px", textAlign: "center" }}>
        <p style={{ fontSize: 12, color: "rgba(237,246,242,0.28)", fontFamily: "var(--font-body)" }}>
          © {new Date().getFullYear()} Resuviq AI B.V. ·{" "}
          <span className="footer-link" onClick={() => navigate("/privacy")}>Privacy Policy</span> ·{" "}
          <span className="footer-link" onClick={() => navigate("/terms")}>Terms of Service</span> ·{" "}
          <span className="footer-link" onClick={() => navigate("/cookies")}>Cookie Policy</span>
        </p>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }) {
  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12, letterSpacing: "-0.3px" }}>{title}</h2>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.8, color: "var(--muted)" }}>{children}</div>
    </div>
  );
}

export function LP({ children }) {
  return <p style={{ marginBottom: 10 }}>{children}</p>;
}

export function LU({ items }) {
  return (
    <ul style={{ paddingLeft: 20, marginBottom: 10 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 6 }}>{it}</li>)}
    </ul>
  );
}
