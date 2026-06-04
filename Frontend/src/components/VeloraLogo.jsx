export default function VeloraLogo({ size = 20 }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <svg width={size + 2} height={size + 2} viewBox="0 0 26 26" fill="none">
        <defs>
          <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00E87A" />
            <stop offset="100%" stopColor="#00C9FF" />
          </linearGradient>
        </defs>
        <polygon points="13,3 3,8 13,13 23,8" fill="url(#lg)" opacity="0.95" />
        <polyline points="3,13 13,18 23,13" stroke="url(#lg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.65" />
        <polyline points="3,18 13,23 23,18" stroke="url(#lg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.3" />
      </svg>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: size, background: "linear-gradient(130deg,#00E87A,#00C9FF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-0.4px" }}>
        Resuviq<span style={{ WebkitTextFillColor: "rgba(237,246,242,0.28)", fontWeight: 500 }}>AI</span>
      </span>
    </span>
  );
}
