import { useEffect, useState } from "react";
import api from "../components/api";
import { isAdminEmail } from "../components/IdealAdminPanel";
import { useAuth } from "../context/AuthContext";

/**
 * PromptAdminPanel — Phase 2 admin UI for the prompt registry.
 *
 * What it does (read + version management only):
 *   - Lists all manageable prompts with their version count + which is live.
 *   - Opens a prompt to see its version history.
 *   - Views any version's full text.
 *   - Saves a NEW version (a draft). This does NOT deploy — deploy/rollback/
 *     scheduling arrive in later phases. Saving is append-only and never changes
 *     what is live, so it cannot affect production output.
 *   - One-click "Seed from current prompts" to populate the registry the first
 *     time (idempotent on the backend).
 *
 * Security: self-gates on isAdminEmail AND every call hits an admin-gated
 * backend endpoint (ADMIN_EMAILS), so a non-admin sees nothing and can do
 * nothing even if they reached this component.
 *
 * Style: matches the existing admin panels (IdealAdminPanel / AdminMetrics) —
 * same api client, same CSS variables, same dark surface.
 */

const card = {
  background: "var(--surface, #0f1f1a)",
  border: "1px solid var(--border, #1f3b32)",
  borderRadius: 12,
  padding: 16,
};

const btn = {
  background: "var(--accent, #1D9E75)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  cursor: "pointer",
};

const btnGhost = {
  ...btn,
  background: "transparent",
  border: "1px solid var(--border, #1f3b32)",
  color: "var(--text, #EDF6F2)",
};

export default function PromptAdminPanel() {
  const { user } = useAuth();
  const admin = isAdminEmail(user?.sub);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); // { key, label }
  const [versions, setVersions] = useState([]);
  const [liveText, setLiveText] = useState(null);  // current text in the code (fallback)
  const [deployedText, setDeployedText] = useState(null); // what's actually live from DB
  const [viewing, setViewing] = useState(null);    // a full version doc
  const [editing, setEditing] = useState(null);    // { systemText, promptText, note, kind }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState([]);
  const [confirmFor, setConfirmFor] = useState(null); // { versionNo, action }
  const [confirmText, setConfirmText] = useState("");
  const [scheduled, setScheduled] = useState([]);
  const [scheduleFor, setScheduleFor] = useState(null); // { versionNo }
  const [schedDay, setSchedDay] = useState("saturday");
  const [schedHour, setSchedHour] = useState(3);

  const loadCatalog = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/prompts/catalog");
      setItems(data.items || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load prompts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (admin) loadCatalog();
  }, [admin]);

  const openKey = async (item) => {
    setSelected(item);
    setViewing(null);
    setEditing(null);
    setNotice("");
    setLiveText(null);
    setDeployedText(null);
    try {
      const { data } = await api.get(`/prompts/${item.key}/versions`);
      setVersions(data.versions || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load versions.");
    }
    try {
      const { data } = await api.get(`/prompts/${item.key}/live`);
      setLiveText(data.text || "");
    } catch (e) {
      setLiveText(null); // non-fatal: just won't show the live block
    }
    try {
      const { data } = await api.get(`/prompts/${item.key}/active`);
      // active doc has system_text/prompt_text depending on the key slot
      const a = data.active;
      if (a) {
        setDeployedText(
          item.key.endsWith("_system") ? a.system_text : a.prompt_text
        );
      } else {
        setDeployedText(null); // nothing deployed -> code fallback is in effect
      }
    } catch (e) {
      setDeployedText(null);
    }
    try {
      const { data } = await api.get(`/prompts/${item.key}/history`);
      setHistory(data.history || []);
    } catch (e) {
      setHistory([]);
    }
    try {
      const { data } = await api.get(`/prompts/scheduled/list?active_only=true`);
      setScheduled((data.scheduled || []).filter((s) => s.key === item.key));
    } catch (e) {
      setScheduled([]);
    }
  };

  const doSchedule = async (versionNo) => {
    setBusy(true);
    setNotice("");
    try {
      const { data } = await api.post(`/prompts/${selected.key}/schedule`, {
        version_no: versionNo,
        day: schedDay,
        hour: schedHour,
      });
      setNotice(
        `Scheduled v${versionNo} for ${data.scheduled.scheduled_cet} CET. Team notified.`
      );
      setScheduleFor(null);
      await openKey(selected);
    } catch (e) {
      setError(e?.response?.data?.detail || "Scheduling failed.");
    } finally {
      setBusy(false);
    }
  };

  const cancelSchedule = async (deploymentId) => {
    setBusy(true);
    try {
      await api.post(`/prompts/scheduled/${deploymentId}/cancel`);
      await openKey(selected);
    } catch (e) {
      setError(e?.response?.data?.detail || "Cancel failed.");
    } finally {
      setBusy(false);
    }
  };

  const discard = async (versionNo) => {
    setBusy(true);
    setNotice("");
    try {
      await api.delete(`/prompts/${selected.key}/versions/${versionNo}`);
      setNotice(`Discarded v${versionNo}.`);
      await openKey(selected);
      await loadCatalog();
    } catch (e) {
      setError(e?.response?.data?.detail || "Discard failed.");
    } finally {
      setBusy(false);
    }
  };

  const doActivation = async (versionNo, action) => {
    setBusy(true);
    setNotice("");
    try {
      const path = action === "rollback" ? "rollback" : "deploy";
      await api.post(`/prompts/${selected.key}/${path}`, { version_no: versionNo });
      setNotice(
        action === "rollback"
          ? `Rolled back to v${versionNo}. It is now live.`
          : `Deployed v${versionNo}. It is now live.`
      );
      setConfirmFor(null);
      setConfirmText("");
      await openKey(selected);
      await loadCatalog();
    } catch (e) {
      setError(e?.response?.data?.detail || "Activation failed.");
    } finally {
      setBusy(false);
    }
  };

  const viewVersion = async (versionNo) => {
    try {
      const { data } = await api.get(`/prompts/${selected.key}/versions/${versionNo}`);
      setViewing(data);
      setEditing(null);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load version.");
    }
  };

  const startEditFrom = (doc) => {
    const kind = selected.key.endsWith("_system") ? "system" : "prompt";
    setEditing({
      systemText: doc?.system_text || "",
      promptText: doc?.prompt_text || "",
      note: "",
      kind,
    });
    setViewing(null);
  };

  const saveDraft = async () => {
    if (!editing) return;
    setBusy(true);
    setNotice("");
    try {
      const { data } = await api.post(`/prompts/${selected.key}/versions`, {
        system_text: editing.systemText,
        prompt_text: editing.promptText,
        note: editing.note,
      });
      setNotice(`Saved as version ${data.version.version_no} (draft — not deployed).`);
      setEditing(null);
      await openKey(selected);
      await loadCatalog();
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to save version.");
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    setBusy(true);
    setNotice("");
    try {
      const { data } = await api.post("/prompts/seed");
      const r = data.report || {};
      setNotice(
        `Seed complete — ${(r.seeded || []).length} created, ` +
        `${(r.skipped || []).length} already existed.`
      );
      await loadCatalog();
    } catch (e) {
      setError(e?.response?.data?.detail || "Seed failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!admin) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-500 text-sm">
        You don't have access to this area.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button style={btn} onClick={seed} disabled={busy}>
          Seed from current prompts
        </button>
        <button style={btnGhost} onClick={loadCatalog} disabled={busy}>
          Refresh
        </button>
        <span style={{ fontSize: 12, color: "var(--muted, #8fb3a7)" }}>
          Saving a version is a draft only — it never changes what is live.
        </span>
      </div>

      {notice && (
        <div style={{ ...card, borderColor: "var(--accent, #1D9E75)", fontSize: 13 }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ ...card, borderColor: "#a33", color: "#f4baba", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16, height: "80vh", minHeight: 420 }}>
        {/* Left: catalog list */}
        <div style={{ ...card, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, opacity: 0.8 }}>
            Managed prompts {loading ? "…" : `(${items.length})`}
          </div>
          <div style={{ display: "grid", gap: 6, overflowY: "auto", minHeight: 0, flex: 1 }}>
            {items.map((it) => {
              const isSel = selected?.key === it.key;
              return (
                <div
                  key={it.key}
                  onClick={() => openKey(it)}
                  style={{
                    cursor: "pointer",
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: isSel ? "var(--accentSoft, #143b30)" : "transparent",
                    border: "1px solid var(--border, #1f3b32)",
                  }}
                >
                  <div style={{ fontSize: 13 }}>{it.label}</div>
                  <div style={{ fontSize: 11, color: "var(--muted, #8fb3a7)" }}>
                    {it.latest_version_no == null
                      ? "no versions yet"
                      : `v${it.latest_version_no} latest`}
                    {it.active_version_no != null && ` · v${it.active_version_no} live`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: detail */}
        <div style={{ ...card, overflowY: "auto", minHeight: 0 }}>
          {!selected ? (
            <div style={{ fontSize: 13, color: "var(--muted, #8fb3a7)" }}>
              Select a prompt to view its history.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{selected.label}</div>
                <button
                  style={btn}
                  onClick={() => {
                    const base = viewing || versions[0];
                    if (base) return startEditFrom(base);
                    // Nothing seeded yet — start the draft from the live code text.
                    const kind = selected.key.endsWith("_system") ? "system" : "prompt";
                    const baseText = deployedText != null ? deployedText : (liveText || "");
                    setEditing({
                      systemText: kind === "system" ? baseText : "",
                      promptText: kind === "prompt" ? baseText : "",
                      note: "",
                      kind,
                    });
                    setViewing(null);
                  }}
                >
                  New version
                </button>
              </div>

              {/* What's ACTUALLY live right now. If a version is deployed, this
                  is the deployed DB text. Otherwise the code fallback is live. */}
              {deployedText != null ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.8, display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "var(--accent, #1D9E75)" }}>● Currently live</span>
                    <span style={{ color: "var(--muted, #8fb3a7)" }}>
                      deployed v{selected.active_version_no} — this is what runs now
                    </span>
                  </div>
                  <pre style={preStyle}>{deployedText}</pre>
                </div>
              ) : (
                liveText != null && (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: "var(--accent, #1D9E75)" }}>● Currently live</span>
                      <span style={{ color: "var(--muted, #8fb3a7)" }}>
                        nothing deployed — running the original code text
                      </span>
                    </div>
                    <pre style={preStyle}>{liveText}</pre>
                  </div>
                )
              )}

              {/* The original hardcoded text — the permanent fallback. Always
                  shown for reference, collapsed-feel via muted heading. */}
              {liveText != null && deployedText != null && (
                <details style={{ fontSize: 12 }}>
                  <summary style={{ cursor: "pointer", color: "var(--muted, #8fb3a7)" }}>
                    Show original code text (fallback)
                  </summary>
                  <pre style={{ ...preStyle, marginTop: 6 }}>{liveText}</pre>
                </details>
              )}

              {/* Pending weekend schedules for this prompt */}
              {scheduled.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  {scheduled.map((s) => (
                    <div
                      key={s.deployment_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--amber, #BA7517)",
                        fontSize: 12,
                      }}
                    >
                      <span>
                        ⏱ Scheduled: v{s.version_no} → live {s.scheduled_cet} CET
                      </span>
                      <button
                        style={btnGhost}
                        onClick={() => cancelSchedule(s.deployment_id)}
                        disabled={busy}
                      >
                        Cancel schedule
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Version history */}
              <div style={{ display: "grid", gap: 6 }}>
                {versions.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--muted, #8fb3a7)" }}>
                    No versions yet. Use “Seed from current prompts” to create v1.
                  </div>
                )}
                {versions.map((v) => {
                  const isLive = selected.active_version_no === v.version_no;
                  const confirming = confirmFor && confirmFor.versionNo === v.version_no;
                  return (
                    <div
                      key={v.version_no}
                      style={{
                        display: "grid",
                        gap: 8,
                        padding: "8px 10px",
                        border: `1px solid ${isLive ? "var(--accent, #1D9E75)" : "var(--border, #1f3b32)"}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>
                          v{v.version_no}
                          {isLive && <span style={{ color: "var(--accent, #1D9E75)" }}> · live</span>}
                          {v.note ? ` — ${v.note}` : ""}
                        </span>
                        <span style={{ display: "flex", gap: 6 }}>
                          <button style={btnGhost} onClick={() => viewVersion(v.version_no)}>
                            View
                          </button>
                          {!isLive && (
                            <button
                              style={btn}
                              onClick={() => {
                                const action =
                                  selected.active_version_no != null &&
                                  v.version_no < selected.active_version_no
                                    ? "rollback"
                                    : "deploy";
                                setConfirmFor({ versionNo: v.version_no, action });
                                setConfirmText("");
                                setNotice("");
                              }}
                            >
                              {selected.active_version_no != null &&
                              v.version_no < selected.active_version_no
                                ? "Roll back to this"
                                : "Deploy now"}
                            </button>
                          )}
                          {!isLive && (
                            <button
                              style={btnGhost}
                              onClick={() => {
                                setScheduleFor({ versionNo: v.version_no });
                                setNotice("");
                              }}
                            >
                              Schedule weekend
                            </button>
                          )}
                          {!isLive && (
                            <button
                              style={{ ...btnGhost, color: "#f4baba", borderColor: "#a33" }}
                              onClick={() => discard(v.version_no)}
                              disabled={busy}
                            >
                              Discard
                            </button>
                          )}
                        </span>
                      </div>

                      {confirming && (
                        <div
                          style={{
                            display: "grid",
                            gap: 6,
                            padding: 10,
                            borderRadius: 8,
                            background: "var(--bg, #07120e)",
                            border: "1px solid var(--accent, #1D9E75)",
                          }}
                        >
                          <div style={{ fontSize: 12 }}>
                            {confirmFor.action === "rollback" ? "Roll back" : "Deploy"} v
                            {v.version_no} of <b>{selected.label}</b> — this changes live
                            output. Type the prompt key to confirm:
                          </div>
                          <code style={{ fontSize: 11, opacity: 0.8 }}>{selected.key}</code>
                          <input
                            style={{ ...ta, minHeight: 0, height: 34 }}
                            value={confirmText}
                            placeholder={selected.key}
                            onChange={(e) => setConfirmText(e.target.value)}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              style={{
                                ...btn,
                                opacity: confirmText.trim() === selected.key ? 1 : 0.4,
                                cursor: confirmText.trim() === selected.key ? "pointer" : "not-allowed",
                              }}
                              disabled={busy || confirmText.trim() !== selected.key}
                              onClick={() => doActivation(v.version_no, confirmFor.action)}
                            >
                              Confirm {confirmFor.action}
                            </button>
                            <button
                              style={btnGhost}
                              onClick={() => {
                                setConfirmFor(null);
                                setConfirmText("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {scheduleFor && scheduleFor.versionNo === v.version_no && (
                        <div
                          style={{
                            display: "grid",
                            gap: 8,
                            padding: 10,
                            borderRadius: 8,
                            background: "var(--bg, #07120e)",
                            border: "1px solid var(--border, #1f3b32)",
                          }}
                        >
                          <div style={{ fontSize: 12 }}>
                            Schedule v{v.version_no} for the next weekend slot (CET). The
                            team will be emailed now; it goes live automatically at the slot.
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <select
                              value={schedDay}
                              onChange={(e) => setSchedDay(e.target.value)}
                              style={selectStyle}
                            >
                              <option value="saturday">Saturday</option>
                              <option value="sunday">Sunday</option>
                            </select>
                            <select
                              value={schedHour}
                              onChange={(e) => setSchedHour(Number(e.target.value))}
                              style={selectStyle}
                            >
                              {[0, 1, 2, 3, 4, 5, 6, 22, 23].map((h) => (
                                <option key={h} value={h}>
                                  {String(h).padStart(2, "0")}:00 CET
                                </option>
                              ))}
                            </select>
                            <button style={btn} onClick={() => doSchedule(v.version_no)} disabled={busy}>
                              Schedule + notify team
                            </button>
                            <button style={btnGhost} onClick={() => setScheduleFor(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Viewing a version */}
              {viewing && !editing && (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Viewing v{viewing.version_no} · by {viewing.created_by}
                  </div>
                  {viewing.system_text ? (
                    <pre style={preStyle}>{viewing.system_text}</pre>
                  ) : null}
                  {viewing.prompt_text ? (
                    <pre style={preStyle}>{viewing.prompt_text}</pre>
                  ) : null}
                </div>
              )}

              {/* Editing a new draft */}
              {editing && (
                <div style={{ display: "grid", gap: 8 }}>
                  {editing.kind === "system" ? (
                    <>
                      <label style={lbl}>System text</label>
                      <textarea
                        style={ta}
                        value={editing.systemText}
                        onChange={(e) => setEditing({ ...editing, systemText: e.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <label style={lbl}>Prompt text</label>
                      <textarea
                        style={ta}
                        value={editing.promptText}
                        onChange={(e) => setEditing({ ...editing, promptText: e.target.value })}
                      />
                    </>
                  )}
                  <label style={lbl}>Note (optional)</label>
                  <input
                    style={{ ...ta, minHeight: 0, height: 36 }}
                    value={editing.note}
                    onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={btn} onClick={saveDraft} disabled={busy}>
                      Save draft version
                    </button>
                    <button style={btnGhost} onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted, #8fb3a7)" }}>
                    This saves a new version for review. It will not go live until a
                    deploy step (coming in a later phase).
                  </div>
                </div>
              )}
              {/* Deploy / rollback history */}
              {history.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7 }}>
                    Deploy history
                  </div>
                  {history.map((h, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 11,
                        color: "var(--muted, #8fb3a7)",
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "4px 8px",
                        border: "1px solid var(--border, #1f3b32)",
                        borderRadius: 6,
                      }}
                    >
                      <span>
                        {h.action === "rollback" ? "↩ rollback" : "▲ deploy"} to v
                        {h.to_version_no}
                        {h.from_version_no != null && ` (from v${h.from_version_no})`}
                      </span>
                      <span>{h.deployed_by}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const preStyle = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: "var(--bg, #07120e)",
  border: "1px solid var(--border, #1f3b32)",
  borderRadius: 8,
  padding: 12,
  fontSize: 12,
  margin: 0,
  maxHeight: 320,
  overflow: "auto",
};

const lbl = { fontSize: 12, opacity: 0.8 };

const ta = {
  width: "100%",
  minHeight: 180,
  background: "var(--bg, #07120e)",
  border: "1px solid var(--border, #1f3b32)",
  borderRadius: 8,
  padding: 12,
  fontSize: 12,
  color: "var(--text, #EDF6F2)",
  fontFamily: "var(--font-mono, monospace)",
};

const selectStyle = {
  height: 36,
  minWidth: 150,
  background: "var(--bg, #07120e)",
  border: "1px solid var(--border, #1f3b32)",
  borderRadius: 8,
  padding: "0 10px",
  fontSize: 13,
  color: "var(--text, #EDF6F2)",
  fontFamily: "inherit",
  cursor: "pointer",
};
