import { useState, useEffect, useCallback } from "react";
import api from "../components/api";

/**
 * TeamPanel — admin page to manage internal team members (contributors).
 * Grant by email (they sign up / log in themselves), remove access, and see
 * who has access. Contributors get full product access but no admin pages.
 */
export default function TeamPanel() {
  const [contributors, setContributors] = useState([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/team");
      setContributors(data?.contributors || []);
    } catch { /* surfaced by interceptor */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grant = async () => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setBusy(true); setNotice(null);
    try {
      const { data } = await api.post("/team/grant", { email: e });
      setNotice({
        type: "ok",
        text: data.email_sent
          ? `Access granted to ${data.email}. Notification email sent.`
          : `Access granted to ${data.email}. (Email could not be sent — check mail settings.)`,
      });
      setEmail("");
      await load();
    } catch (err) {
      setNotice({ type: "err", text: err?.response?.data?.detail || "Could not grant access." });
    } finally { setBusy(false); }
  };

  const remove = async (e) => {
    setBusy(true); setNotice(null);
    try {
      const { data } = await api.post("/team/remove", { email: e });
      setNotice({
        type: "ok",
        text: data.email_sent
          ? `Access removed for ${e}. They're now a free user and have been emailed.`
          : `Access removed for ${e}. They're now a free user. (Email could not be sent.)`,
      });
      await load();
    } catch (err) {
      setNotice({ type: "err", text: err?.response?.data?.detail || "Could not remove access." });
    } finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-y-auto p-6 text-gray-200">
      <h1 className="text-xl font-semibold mb-1">Team &amp; access</h1>
      <p className="text-sm text-gray-400 mb-6">
        Grant team members <span className="text-cyan-400">contributor</span> access — full product
        features (unlimited uploads, rewrites, optimization, cover &amp; motivation letters), but no
        admin pages. They sign in with the email you grant; a notification is emailed automatically.
      </p>

      {notice && (
        <div className={`mb-4 text-xs rounded px-3 py-2 border ${
          notice.type === "ok"
            ? "text-green-300 bg-green-600/15 border-green-600/30"
            : "text-red-300 bg-red-600/15 border-red-600/30"
        }`}>
          {notice.text}
        </div>
      )}

      {/* Grant */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 max-w-xl">
        <h2 className="text-sm font-semibold text-white mb-3">Add a team member</h2>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && grant()}
            placeholder="teammate@example.com"
            className="flex-1 bg-gray-800 rounded px-3 py-2 text-sm outline-none"
          />
          <button onClick={grant} disabled={busy || !email.trim()}
            className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#00e87a,#00c9ff)", color: "#0a0f0d" }}>
            {busy ? "Working…" : "Grant access"}
          </button>
        </div>
        <p className="text-[11px] text-gray-600 mt-2">
          If they don't have an account yet, the grant applies automatically when they sign up with this email.
        </p>
      </div>

      {/* List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-3">
          Contributors ({contributors.length})
        </h2>
        {loading && <p className="text-xs text-gray-500">Loading…</p>}
        {!loading && contributors.length === 0 && (
          <p className="text-xs text-gray-500">No contributors yet.</p>
        )}
        <div className="space-y-2">
          {contributors.map((c) => (
            <div key={c.email}
              className="flex items-center justify-between border border-gray-800 rounded px-3 py-2">
              <div>
                <p className="text-sm">{c.email}</p>
                <p className="text-[10px] text-gray-500">
                  {c.verified === false ? "not signed up yet · " : ""}
                  {c.contributor_since ? `since ${new Date(c.contributor_since).toLocaleDateString()}` : ""}
                  {c.contributor_by ? ` · by ${c.contributor_by}` : ""}
                </p>
              </div>
              <button onClick={() => remove(c.email)} disabled={busy}
                className="text-xs px-3 py-1 rounded bg-red-600/20 text-red-300 hover:bg-red-600/30 disabled:opacity-40">
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
