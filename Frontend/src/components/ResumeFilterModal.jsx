import { useState, useRef, useEffect } from "react";
import api from "./api";

const NL_CITIES = [
  "Amsterdam", "Rotterdam", "Utrecht", "The Hague",
  "Eindhoven", "Groningen", "Tilburg", "Breda",
  "Nijmegen", "Leiden", "Remote",
];

const EXPIRY_PRESETS = [
  { label: "2d",  value: 2 },
  { label: "7d",  value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "60d", value: 60 },
  { label: "All", value: 999 },
];

const RADIUS_STEPS = [10, 20, 50, 100, 200];
const TOP_N_OPTIONS = [5, 10, 20, 50, 100];

export default function ResumeFilterModal({
  isOpen,
  resumeName,
  onConfirm,
  onCancel,
  initialFilters = null,   // pre-fill values (e.g. when editing before a refresh)
  confirmLabel,            // optional override for the confirm button text
  resumeId = null,         // when present (refresh flow), enables the live job-count preview
}) {
  // ── Derive initial UI state from saved filters (or fall back to defaults) ──
  // Saved-filter shape comes from the backend: { languages, expiry_days,
  // location, radius_km, remote_only, top_n }. Map those back to UI state,
  // reversing the transforms handleConfirm applies (null expiry -> 999, etc.).
  const f = initialFilters || {};

  const initLanguages = Array.isArray(f.languages) && f.languages.length ? f.languages : ["en"];
  const initExpiry     = (f.expiry_days === null || f.expiry_days === undefined) ? 999 : f.expiry_days;
  const initRemote     = f.remote_only === true;
  const initCity       = initRemote ? "Remote" : (f.location || "Amsterdam");
  // useLocation is on if we have a city filter OR remote-only; for a brand-new
  // upload (no initialFilters) default it on, matching the original behavior.
  const initUseLocation = initRemote || !!f.location || initialFilters === null;
  // Map saved radius_km back to the nearest preset index (default index 1 = 20km)
  const savedRadius = f.radius_km;
  const initRadiusIdx = (() => {
    if (savedRadius == null) return 1;
    const exact = RADIUS_STEPS.indexOf(savedRadius);
    if (exact !== -1) return exact;
    let nearest = 0, best = Infinity;
    RADIUS_STEPS.forEach((r, i) => {
      const d = Math.abs(r - savedRadius);
      if (d < best) { best = d; nearest = i; }
    });
    return nearest;
  })();
  const initTopN = f.top_n || 20;
  // NEW: candidate name pre-fill (saved filters may carry it)
  const initCandidateName = f.candidate_name || "";

  const [languages,   setLanguages]   = useState(initLanguages);
  const [expiryDays,  setExpiryDays]  = useState(initExpiry);
  const [city,        setCity]        = useState(initCity);
  const [radiusIdx,   setRadiusIdx]   = useState(initRadiusIdx);
  const [useLocation, setUseLocation] = useState(initUseLocation);
  const [topN,        setTopN]        = useState(initTopN);
  // NEW: candidate name state
  const [candidateName, setCandidateName] = useState(initCandidateName);

  // Scroll-hint for the modal body — same pattern as JobsTable/AnalysisPanel.
  // On small screens the filter list scrolls past the fold; show a fade +
  // bouncing chevron when there's more below, and scroll down on click.
  const bodyRef = useRef(null);
  const [showFade, setShowFade] = useState(false);

  const updateFade = () => {
    const el = bodyRef.current;
    if (!el) return;
    const moreBelow = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
    setShowFade(moreBelow);
  };

  // Re-measure on open and whenever content that changes the body height toggles
  // (location section expand/collapse, remote vs city). Timeout lets layout settle.
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(updateFade, 60);
    window.addEventListener("resize", updateFade);
    return () => { clearTimeout(t); window.removeEventListener("resize", updateFade); };
  }, [isOpen, useLocation, city]);

  // ── Live job-count preview ──────────────────────────────────────────────────
  // Only when we have a resumeId (refresh flow) — the count needs an existing
  // resume embedding to run vector search. Debounced so toggling filters doesn't
  // spam the backend. This endpoint does NO scoring and costs no OpenAI.
  // States: null = idle/not-applicable, "loading", a number, or "error".
  const [jobCount, setJobCount] = useState(null);
  const countReqId = useRef(0);

  useEffect(() => {
    if (!isOpen || !resumeId) { setJobCount(null); return; }

    const radiusVal = RADIUS_STEPS[radiusIdx];
    const filters = {
      languages,
      expiryDays: expiryDays === 999 ? null : expiryDays,
      location:   useLocation && city !== "Remote" ? city      : null,
      radiusKm:   useLocation && city !== "Remote" ? radiusVal : null,
      remoteOnly: city === "Remote",
    };

    setJobCount("loading");
    const myId = ++countReqId.current;   // guard against out-of-order responses
    const t = setTimeout(async () => {
      try {
        const res = await api.post(`/resume-jobs/count/${resumeId}`, { filters });
        if (myId !== countReqId.current) return;  // a newer request superseded this one
        setJobCount(typeof res.data?.count === "number" ? res.data.count : "error");
      } catch (err) {
        if (myId !== countReqId.current) return;
        setJobCount("error");
      }
    }, 400);

    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, resumeId, languages, expiryDays, useLocation, city, radiusIdx]);

  // Whether the Run button is allowed to fire. Name is always required; when the
  // live count is active and resolves to 0, also block (no jobs to analyse).
  const noJobs = resumeId && jobCount === 0;

  if (!isOpen) return null;

  const radius = RADIUS_STEPS[radiusIdx];

  // Candidate name is now MANDATORY — analysis can't run without it.
  const nameValid = candidateName.trim().length > 0;

  const toggleLanguage = (code) => {
    setLanguages(prev =>
      prev.includes(code)
        ? prev.length > 1 ? prev.filter(x => x !== code) : prev
        : [...prev, code]
    );
  };

  const handleConfirm = () => {
    // Hard guard: never proceed without a candidate name, and (refresh flow)
    // never proceed when the live count says zero jobs match the filters.
    if (!nameValid) return;
    if (noJobs) return;
    onConfirm({
      languages,
      expiryDays: expiryDays === 999 ? null : expiryDays,
      location:   useLocation && city !== "Remote" ? city   : null,
      radiusKm:   useLocation && city !== "Remote" ? radius : null,
      remoteOnly: city === "Remote",
      topN,
      // Candidate name is mandatory now, so this is always a real value.
      candidateName: candidateName.trim(),
    });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      background: "rgba(3,8,13,0.55)",
      padding: "12px 16px",
    }}>
      <style>{`
        @keyframes rfmBounce {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-5px); }
        }
        @keyframes rfmSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{
        width: "100%",
        maxWidth: 780,
        maxHeight: "calc(100vh - 24px)",
        background: "linear-gradient(145deg,#0d1a14,#091118)",
        border: "1px solid rgba(0,232,122,0.2)",
        borderRadius: 20,
        boxShadow: "0 32px 80px rgba(0,0,0,0.55)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-body,'Plus Jakarta Sans',sans-serif)",
      }}>

        {/* ── Header (fixed) ── */}
        <div style={{
          padding: "16px 20px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(0,232,122,0.04)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00E87A", display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#00E87A" }}>
                Configure Analysis
              </span>
            </div>
            <button onClick={onCancel} style={{
              width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer",
              background: "rgba(255,255,255,0.07)", color: "rgba(237,246,242,0.5)",
              fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>✕</button>
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#EDF6F2", letterSpacing: "-0.3px", margin: "6px 0 2px" }}>
            Set your job filters
          </h2>
          <p style={{ fontSize: 11, color: "rgba(237,246,242,0.4)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Narrow the pool before ATS matching on <strong style={{ color: "rgba(237,246,242,0.65)" }}>{resumeName}</strong>
          </p>
        </div>

        {/* ── Body (scrollable) ── */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
          <div
            ref={bodyRef}
            onScroll={updateFade}
            style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}
          >

          {/* NEW Row 0: Candidate Name (REQUIRED) */}
          <Card label="👤 Candidate Name *" hint="Required — used on the resume & for optimization">
            <input
              type="text"
              value={candidateName}
              onChange={e => setCandidateName(e.target.value)}
              placeholder="e.g. Jane Doe"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.04)",
                border: nameValid
                  ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(244,63,94,0.55)",
                color: "#EDF6F2",
                fontSize: 13,
                fontWeight: 500,
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            <p style={{
              fontSize: 10,
              color: nameValid ? "rgba(237,246,242,0.3)" : "#fb7185",
              marginTop: 6,
            }}>
              {nameValid
                ? `Will display as "${candidateName.trim()}"`
                : "Please enter a candidate name to run the analysis"}
            </p>
          </Card>

          {/* Row 1: Language + Top N side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>

            {/* Language */}
            <Card label="🌐 Language" hint="Select one or both">
              <div style={{ display: "flex", gap: 6 }}>
                {[{ code: "en", label: "EN 🇬🇧" }, { code: "nl", label: "NL 🇳🇱" }].map(l => {
                  const active = languages.includes(l.code);
                  return (
                    <button key={l.code} onClick={() => toggleLanguage(l.code)} style={{
                      flex: 1, padding: "7px 0", borderRadius: 8, cursor: "pointer",
                      fontSize: 12, fontWeight: 600, transition: "all .15s", position: "relative",
                      background: active ? "linear-gradient(135deg,#00E87A,#00C9FF)" : "rgba(255,255,255,0.04)",
                      color:  active ? "#03080D" : "rgba(237,246,242,0.5)",
                      border: active ? "1px solid transparent" : "1px solid rgba(255,255,255,0.08)",
                    }}>
                      {l.label}
                      {active && (
                        <span style={{
                          position: "absolute", top: -5, right: -5,
                          width: 14, height: 14, borderRadius: "50%",
                          background: "#00E87A", color: "#03080D",
                          fontSize: 8, fontWeight: 900,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 10, color: "rgba(237,246,242,0.3)", marginTop: 6 }}>
                {languages.length === 2 ? "Both EN + NL" : languages[0] === "en" ? "English only" : "Dutch only"}
              </p>
            </Card>

            {/* Top N */}
            <Card label="🎯 Top Results" hint="Jobs to score & display">
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {TOP_N_OPTIONS.map(n => (
                  <button key={n} onClick={() => setTopN(n)} style={{
                    padding: "5px 10px", borderRadius: 100, cursor: "pointer",
                    fontSize: 11, fontWeight: 600, transition: "all .15s",
                    background: topN === n ? "rgba(0,232,122,0.15)" : "rgba(255,255,255,0.04)",
                    color:  topN === n ? "#00E87A" : "rgba(237,246,242,0.4)",
                    border: topN === n ? "1px solid rgba(0,232,122,0.35)" : "1px solid rgba(255,255,255,0.07)",
                  }}>
                    {n}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 10, color: "rgba(237,246,242,0.3)", marginTop: 6 }}>
                Score top {topN} semantically similar jobs
              </p>
            </Card>
          </div>

          {/* Row 2: Expiry */}
          <Card label="📅 Expiry Window" hint="Jobs expiring within this period">
            <div style={{ display: "flex", gap: 6 }}>
              {EXPIRY_PRESETS.map(p => (
                <button key={p.value} onClick={() => setExpiryDays(p.value)} style={{
                  flex: 1, padding: "6px 0", borderRadius: 8, cursor: "pointer",
                  fontSize: 11, fontWeight: 600, transition: "all .15s",
                  background: expiryDays === p.value ? "rgba(0,232,122,0.15)" : "rgba(255,255,255,0.04)",
                  color:  expiryDays === p.value ? "#00E87A" : "rgba(237,246,242,0.4)",
                  border: expiryDays === p.value ? "1px solid rgba(0,232,122,0.35)" : "1px solid rgba(255,255,255,0.07)",
                }}>
                  {p.label}
                </button>
              ))}
            </div>
            {/* Progress bar */}
            <div style={{ marginTop: 8, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 100, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 100,
                background: "linear-gradient(90deg,#00E87A,#00C9FF)",
                width: expiryDays === 999 ? "100%" : `${Math.min((expiryDays / 60) * 100, 100)}%`,
                transition: "width .3s ease",
              }} />
            </div>
            <p style={{ fontSize: 10, color: "rgba(237,246,242,0.3)", marginTop: 5 }}>
              {expiryDays === 999 ? "All jobs regardless of expiry" : `Expiring within ${expiryDays} days`}
            </p>
          </Card>

          {/* Row 3: Location */}
          <Card
            label="📍 Location"
            hint="Filter by proximity to a Dutch city"
            toggle={{ value: useLocation, onChange: setUseLocation }}
          >
            {useLocation && (
              <>
                {/* City grid */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                  {NL_CITIES.map(c => (
                    <button key={c} onClick={() => setCity(c)} style={{
                      padding: "4px 10px", borderRadius: 100, cursor: "pointer",
                      fontSize: 11, fontWeight: 600, transition: "all .15s",
                      background: city === c ? "rgba(0,201,255,0.15)" : "rgba(255,255,255,0.04)",
                      color:  city === c ? "#00C9FF" : "rgba(237,246,242,0.4)",
                      border: city === c ? "1px solid rgba(0,201,255,0.35)" : "1px solid rgba(255,255,255,0.07)",
                    }}>
                      {c === "Remote" ? "🌍 Remote" : c}
                    </button>
                  ))}
                </div>

                {city !== "Remote" && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "rgba(237,246,242,0.4)" }}>Radius around {city}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#00C9FF" }}>{radius} km</span>
                    </div>
                    <input type="range" min={0} max={RADIUS_STEPS.length - 1}
                      value={radiusIdx} onChange={e => setRadiusIdx(Number(e.target.value))}
                      style={{ width: "100%", accentColor: "#00C9FF", cursor: "pointer", height: 3 }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                      {RADIUS_STEPS.map((r, i) => (
                        <span key={r} style={{
                          fontSize: 9,
                          color: radiusIdx === i ? "#00C9FF" : "rgba(237,246,242,0.2)",
                          fontWeight: radiusIdx === i ? 700 : 400,
                        }}>{r}km</span>
                      ))}
                    </div>
                  </>
                )}

                {city === "Remote" && (
                  <p style={{ fontSize: 10, color: "rgba(0,201,255,0.6)" }}>Only jobs with "remote" in location</p>
                )}
              </>
            )}
          </Card>
          </div>

          {/* Scroll hint — only when there's more below the fold. Fade + bouncing
              chevron pinned to the body's bottom edge; click scrolls down. */}
          {showFade && (
            <div style={{
              position: "absolute", left: 0, right: 4, bottom: 0, height: 56,
              pointerEvents: "none",
              background: "linear-gradient(to top, rgba(9,17,24,0.95), rgba(9,17,24,0))",
              display: "flex", alignItems: "flex-end", justifyContent: "center",
              paddingBottom: 6,
            }}>
              <button
                onClick={() => bodyRef.current?.scrollBy({ top: 220, behavior: "smooth" })}
                title="Scroll for more"
                aria-label="Scroll down for more"
                style={{
                  pointerEvents: "auto",
                  width: 28, height: 28, borderRadius: "50%", cursor: "pointer",
                  background: "rgba(0,232,122,0.18)",
                  border: "1px solid rgba(0,232,122,0.4)",
                  color: "#00E87A", fontSize: 14, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  animation: "rfmBounce 1s infinite",
                }}
              >
                ↓
              </button>
            </div>
          )}
        </div>

        {/* ── Footer (fixed) ── */}
        <div style={{
          flexShrink: 0,
          borderTop: "1px solid rgba(255,255,255,0.07)",
          padding: "12px 20px",
        }}>
          {/* Live job-count preview (refresh flow only) */}
          {resumeId && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
              padding: "8px 12px", borderRadius: 10,
              background: noJobs ? "rgba(244,63,94,0.10)" : "rgba(0,232,122,0.08)",
              border: `1px solid ${noJobs ? "rgba(244,63,94,0.35)" : "rgba(0,232,122,0.25)"}`,
            }}>
              {jobCount === "loading" && (
                <>
                  <span style={{
                    width: 13, height: 13, borderRadius: "50%",
                    border: "2px solid rgba(0,232,122,0.4)", borderTopColor: "#00E87A",
                    display: "inline-block", animation: "rfmSpin .7s linear infinite", flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 12, color: "rgba(237,246,242,0.6)" }}>
                    Checking how many jobs match…
                  </span>
                </>
              )}
              {typeof jobCount === "number" && jobCount > 0 && (
                <>
                  <span style={{ fontSize: 14 }}>✅</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "#00E87A" }}>
                    {jobCount} {jobCount === 1 ? "job" : "jobs"} match your filters
                  </span>
                  <span style={{ fontSize: 11, color: "rgba(237,246,242,0.4)" }}>
                    · top {Math.min(topN, jobCount)} will be scored
                  </span>
                </>
              )}
              {noJobs && (
                <>
                  <span style={{ fontSize: 14 }}>⚠️</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "#fb7185" }}>
                    No jobs match these filters — adjust them to run analysis
                  </span>
                </>
              )}
              {jobCount === "error" && (
                <span style={{ fontSize: 12, color: "rgba(237,246,242,0.45)" }}>
                  Couldn’t check job count — you can still run the analysis
                </span>
              )}
            </div>
          )}

          {/* Summary chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {candidateName.trim() && <Chip color="#22d3ee">{candidateName.trim()}</Chip>}
            <Chip color="#00E87A">{languages.map(l => l.toUpperCase()).join(" + ")}</Chip>
            <Chip color="#00C9FF">{expiryDays === 999 ? "All dates" : `≤ ${expiryDays}d`}</Chip>
            <Chip color="#f59e0b">Top {topN}</Chip>
            {useLocation && city !== "Remote" && <Chip color="#a78bfa">{city} · {radius}km</Chip>}
            {useLocation && city === "Remote"  && <Chip color="#a78bfa">Remote only</Chip>}
            {!useLocation                       && <Chip color="#6b7280">No location filter</Chip>}
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel} style={{
              flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer",
              fontSize: 13, fontWeight: 600,
              background: "transparent", color: "rgba(237,246,242,0.4)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={!nameValid || noJobs} style={{
              flex: 2, padding: "10px 0", borderRadius: 10,
              cursor: (!nameValid || noJobs) ? "not-allowed" : "pointer",
              fontSize: 13, fontWeight: 700,
              background: (!nameValid || noJobs)
                ? "rgba(255,255,255,0.08)"
                : "linear-gradient(135deg,#00E87A,#00C9FF)",
              color: (!nameValid || noJobs) ? "rgba(237,246,242,0.35)" : "#03080D",
              border: "none",
              opacity: (!nameValid || noJobs) ? 0.7 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              transition: "all .15s",
            }}>
              {confirmLabel || "🚀 Run ATS Analysis"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */
function Card({ label, hint, toggle, children }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12, padding: "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#EDF6F2" }}>{label}</span>
          {hint && <span style={{ fontSize: 10, color: "rgba(237,246,242,0.3)", marginLeft: 6 }}>{hint}</span>}
        </div>
        {toggle && (
          <div onClick={() => toggle.onChange(!toggle.value)} style={{
            width: 34, height: 19, borderRadius: 100, cursor: "pointer", flexShrink: 0, marginLeft: 8,
            background: toggle.value ? "linear-gradient(135deg,#00E87A,#00C9FF)" : "rgba(255,255,255,0.1)",
            position: "relative", transition: "background .2s",
          }}>
            <div style={{
              position: "absolute", top: 2,
              left: toggle.value ? 17 : 2,
              width: 15, height: 15, borderRadius: "50%", background: "#fff",
              transition: "left .2s",
            }} />
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Chip({ children, color }) {
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 100, fontSize: 10, fontWeight: 700,
      background: `${color}18`, color, border: `1px solid ${color}30`,
    }}>
      {children}
    </span>
  );
}