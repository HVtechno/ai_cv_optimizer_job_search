// Visitor presence beacon (consent-gated).
//
// Drop-in NEW file: src/lib/presence.js
// Does not touch any existing component or feature.
//
// Call startPresence() ONCE, only AFTER the user has accepted cookies in your
// consent banner. Call stopPresence() if they withdraw consent.

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function ping() {
  try {
    // Include the auth token if the user is logged in, so the backend can
    // attribute the visit to their email. Anonymous visits work too.
    const token = localStorage.getItem("token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    await fetch(`${API}/presence/track`, {
      method: "POST",
      credentials: "include", // sends/receives the first-party "vid" cookie
      headers,
      body: JSON.stringify({
        consent: true, // only ever sent after the user accepted cookies
        path: window.location.pathname,
      }),
      keepalive: true,
    });
  } catch (_) {
    // Tracking must never break the app — swallow errors.
  }
}

let timer = null;

export function startPresence() {
  if (timer) return; // already running
  ping(); // initial heartbeat
  timer = setInterval(() => {
    if (document.visibilityState === "visible") ping();
  }, 60_000); // every 60s while the tab is visible
}

export function stopPresence() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Optional helper: read the current live count (for an admin widget).
export async function getActiveVisitors(minutes = 5) {
  const res = await fetch(`${API}/presence/active?minutes=${minutes}`, {
    credentials: "include",
  });
  return res.json();
}