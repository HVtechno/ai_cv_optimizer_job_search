import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { jwtDecode } from "jwt-decode";
import api from "../components/api";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  // NEW: subscription state, kept separate from the decoded JWT identity.
  // The JWT only carries {sub, exp} — it has NO plan info — so we fetch the
  // plan/limits from GET /me (which now returns them) whenever we have a token.
  const [plan, setPlan] = useState(null);         // "basic" | "pro" | "enterprise"
  const [limits, setLimits] = useState(null);     // resolved limit object from backend
  const [subStatus, setSubStatus] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);

  // Set true when we detect the user was previously on a paid plan but is now
  // on basic (i.e. their subscription ended / was cancelled). Drives the
  // "you've moved to Free" popup. Cleared when the user dismisses it.
  const [justDowngraded, setJustDowngraded] = useState(false);
  const clearDowngradeNotice = useCallback(() => setJustDowngraded(false), []);

  // Fetch (or refetch) the user's plan + limits. Call after login, on mount,
  // and after returning from Stripe checkout so the UI reflects the new plan.
  const refreshPlan = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setPlan(null); setLimits(null); setSubStatus(null);
      return;
    }
    try {
      setPlanLoading(true);
      const { data } = await api.get("/auth/me");
      const newPlan = data.plan || "basic";

      // Downgrade detection: compare against the last paid plan we saw for this
      // user (persisted in localStorage so it survives reloads). If they were
      // pro/enterprise and are now basic, flag the popup once.
      const lastPaid = localStorage.getItem("last_known_paid_plan"); // "pro"|"enterprise"|null
      if (newPlan === "basic" && (lastPaid === "pro" || lastPaid === "enterprise")) {
        setJustDowngraded(true);
        localStorage.removeItem("last_known_paid_plan"); // show only once
      }
      // Remember the current paid plan so a future drop to basic is detectable.
      if (newPlan === "pro" || newPlan === "enterprise") {
        localStorage.setItem("last_known_paid_plan", newPlan);
      }

      setPlan(newPlan);
      setLimits(data.limits || null);
      setSubStatus(data.subscription_status || "none");
    } catch (err) {
      // On failure, assume the most restrictive (free) so we never accidentally
      // unlock paid features client-side. The backend is the real gate anyway.
      setPlan("basic");
      setLimits(null);
      setSubStatus("none");
    } finally {
      setPlanLoading(false);
    }
  }, []);

  useEffect(() => {
    const checkAuth = () => {
      const token = localStorage.getItem("token");
      if (!token) { setUser(null); setPlan(null); setLimits(null); return; }
      try {
        const decoded = jwtDecode(token);
        if (decoded.exp * 1000 < Date.now()) {
          localStorage.removeItem("token");
          setUser(null); setPlan(null); setLimits(null); setSubStatus(null);
        } else {
          setUser(decoded);
        }
      } catch (err) {
        localStorage.removeItem("token");
        setUser(null); setPlan(null); setLimits(null); setSubStatus(null);
      }
    };

    checkAuth();
    const interval = setInterval(checkAuth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Whenever we gain a user identity, pull their plan. (Runs on login + mount.)
  useEffect(() => {
    if (user?.sub) refreshPlan();
  }, [user?.sub, refreshPlan]);

  // Gentle periodic re-check (every 5 min) so a user sitting in the app catches
  // a subscription that lapsed mid-session — the downgrade popup then appears
  // without them needing to reload. Cheap: one /auth/me call.
  useEffect(() => {
    if (!user?.sub) return;
    const id = setInterval(() => refreshPlan(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [user?.sub, refreshPlan]);

  const login = (token) => {
    localStorage.setItem("token", token);
    setUser(jwtDecode(token));
    // plan is fetched by the effect above once `user` updates
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("last_known_paid_plan");   // don't leak across users
    setUser(null);
    setPlan(null);
    setLimits(null);
    setSubStatus(null);
    setJustDowngraded(false);
  };

  // Small convenience helpers the UI can use to gate features without
  // re-deriving logic everywhere. These mirror the backend's feature flags.
  const hasFeature = useCallback(
    (feature) => Boolean(limits && limits[feature]),
    [limits]
  );
  const isPro = plan === "pro" || plan === "enterprise";

  return (
    <AuthContext.Provider
      value={{
        user, login, logout,
        plan, limits, subStatus, planLoading,
        refreshPlan, hasFeature, isPro,
        justDowngraded, clearDowngradeNotice,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);