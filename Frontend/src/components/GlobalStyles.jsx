export default function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap');

      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      :root {
        --g1: #00E87A; --g2: #00C9FF;
        --dark: #03080D;
        --surface: rgba(255,255,255,0.035);
        --border: rgba(255,255,255,0.075);
        --border-hover: rgba(0,232,122,0.25);
        --text: #EDF6F2; --muted: rgba(237,246,242,0.42);
        --font-display: 'Space Grotesk', sans-serif;
        --font-body: 'Plus Jakarta Sans', sans-serif;
        --section-px: 48px;
        --section-py: 90px;
        --max-w: 920px;
      }

      html { scroll-behavior: smooth; }
      body { background: var(--dark); color: var(--text); font-family: var(--font-body); overflow-x: hidden; -webkit-font-smoothing: antialiased; }
      ::-webkit-scrollbar { width: 5px; }
      ::-webkit-scrollbar-track { background: var(--dark); }
      ::-webkit-scrollbar-thumb { background: rgba(0,232,122,0.18); border-radius: 3px; }

      .btn-primary {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 13px 30px; border-radius: 12px;
        font-family: var(--font-body); font-size: 14px; font-weight: 700;
        background: linear-gradient(135deg, var(--g1), var(--g2));
        color: #03080D; border: none; cursor: pointer; letter-spacing: 0.1px;
        transition: transform .18s, box-shadow .18s; white-space: nowrap;
      }
      .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 14px 36px rgba(0,232,122,0.28); }
      .btn-ghost {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 13px 26px; border-radius: 12px;
        font-family: var(--font-body); font-size: 14px; font-weight: 600;
        background: transparent; border: 1px solid var(--border);
        color: var(--muted); cursor: pointer; transition: border-color .18s, color .18s; white-space: nowrap;
      }
      .btn-ghost:hover { border-color: rgba(255,255,255,0.22); color: var(--text); }

      .display-heading { font-family: var(--font-display); font-weight: 700; letter-spacing: -1.4px; line-height: 1.08; color: var(--text); }
      .grad-text { background: linear-gradient(130deg, var(--g1) 0%, var(--g2) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 2.2px; text-transform: uppercase; color: var(--g1); display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
      .body-text { font-family: var(--font-body); font-size: 15px; font-weight: 400; line-height: 1.75; color: var(--muted); }

      .velora-card { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; transition: border-color .2s, transform .2s; }
      .velora-card:hover { border-color: var(--border-hover); }

      .section-divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent); margin: 0 var(--section-px); }

      .animate-iosModal { animation: iosPop 0.32s cubic-bezier(0.34,1.56,0.64,1); }
      @keyframes iosPop { from { opacity:0; transform:translateY(24px) scale(0.95); } to { opacity:1; transform:translateY(0) scale(1); } }
      @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-7px)} 40%{transform:translateX(7px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
      .animate-shake { animation: shake 0.4s ease-in-out; }
      .auth-input { width:100%; padding:11px 14px; border-radius:10px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); color:#EDF6F2; font-size:14px; font-family:var(--font-body); outline:none; transition:border-color .15s; }
      .auth-input:focus { border-color: rgba(0,232,122,0.45); }
      .auth-input::placeholder { color: rgba(237,246,242,0.3); }

      @keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.45;transform:scale(1.5)} }
      .live-dot { width:7px; height:7px; border-radius:50%; background:var(--g1); animation:livePulse 1.6s ease infinite; display:inline-block; flex-shrink:0; }

      .lang-toggle { display:flex; align-items:center; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
      .lang-btn { padding:6px 11px; font-size:12px; font-weight:700; font-family:var(--font-body); cursor:pointer; border:none; background:transparent; color:var(--muted); transition:background .15s, color .15s; letter-spacing:0.5px; }
      .lang-btn.active { background:linear-gradient(135deg,var(--g1),var(--g2)); color:#03080D; }

      .footer-link { font-size:12px; color:rgba(237,246,242,0.38); text-decoration:none; font-family:var(--font-body); cursor:pointer; transition:color .15s; }
      .footer-link:hover { color: var(--g1); }

      .section-wrap { max-width:var(--max-w); margin:0 auto; padding:var(--section-py) var(--section-px); }

      .grid-2 { display:grid; grid-template-columns:1fr 1.15fr; gap:56px; align-items:center; }
      .grid-2-equal { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
      .grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
      .grid-pricing { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }

      .hamburger { display:none; flex-direction:column; gap:5px; cursor:pointer; padding:4px; }
      .hamburger span { display:block; width:22px; height:2px; background:var(--muted); border-radius:2px; transition:all .25s; }

      .mobile-menu {
        position:fixed; top:0; left:0; right:0; bottom:0; z-index:200;
        background:rgba(3,8,13,0.98); backdrop-filter:blur(20px);
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:32px;
      }
      .mobile-nav-link { font-size:22px; font-weight:600; color:var(--muted); font-family:var(--font-display); cursor:pointer; transition:color .18s; }
      .mobile-nav-link:hover { color:var(--text); }

      @media (max-width: 768px) {
        :root { --section-px: 20px; --section-py: 60px; }
        .nav-links { display: none !important; }
        .hamburger { display: flex; }
        .hero-title { font-size: clamp(32px, 9vw, 48px) !important; letter-spacing: -1px !important; }
        .hero-sub { font-size: 15px !important; }
        .hero-btns { flex-direction: column !important; align-items: center; }
        .hero-btns .btn-primary, .hero-btns .btn-ghost { width: 100%; justify-content: center; }
        .grid-2 { grid-template-columns: 1fr !important; gap: 32px !important; }
        .grid-2-equal { grid-template-columns: 1fr !important; gap: 14px !important; }
        .grid-3 { grid-template-columns: 1fr 1fr !important; gap: 12px !important; }
        .grid-pricing { grid-template-columns: 1fr !important; gap: 40px !important; }
        .section-h2 { font-size: clamp(22px, 6vw, 32px) !important; }
        .dash-3d { transform: none !important; }
        .footer-top { flex-direction: column !important; gap: 28px !important; }
        .footer-cols { flex-direction: column !important; gap: 24px !important; }
        .footer-bottom { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
        .legal-content { padding: 80px 20px 40px !important; }
        .legal-h1 { font-size: 28px !important; }
      }

      @media (max-width: 480px) {
        .grid-3 { grid-template-columns: 1fr !important; }
        .hero-title { font-size: clamp(28px, 8vw, 38px) !important; }
      }
    `}</style>
  );
}
