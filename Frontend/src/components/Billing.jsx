import api from "./api";

/**
 * billing.js — thin wrappers around the /billing endpoints.
 *
 * Keeps Stripe redirect logic in one place so components stay clean. All calls
 * reuse your existing axios `api` instance (which already attaches the Bearer
 * token), so nothing here touches auth directly.
 */

// Fetch the public plan catalog (mirrors backend core/plans.py).
export async function fetchPlans() {
  const { data } = await api.get("/billing/plans");
  return data.plans;
}

// Current user's subscription (plan + status). Auth required.
export async function fetchSubscription() {
  const { data } = await api.get("/billing/subscription");
  return data;
}

// Live usage counters for the Settings meters. Pass a resumeId to get the
// per-resume figures (used by Pro's per-resume metering).
export async function fetchUsage(resumeId) {
  const { data } = await api.get("/billing/usage", {
    params: resumeId ? { resume_id: resumeId } : {},
  });
  return data;
}

// Permanently delete the account and all associated data. Irreversible.
export async function deleteAccount() {
  const { data } = await api.delete("/billing/account");
  return data;
}

// ── Feedback ──────────────────────────────────────────────────────────────
// Whether the periodic (post-optimization) feedback prompt should show.
export async function shouldPromptFeedback() {
  try {
    const { data } = await api.get("/billing/feedback/should-prompt");
    return Boolean(data?.should_prompt);
  } catch {
    return false;   // never block the user on a feedback check
  }
}

// Mark the periodic prompt as shown without a rating (starts the 30-day cooldown).
export async function dismissFeedbackPrompt() {
  try { await api.post("/billing/feedback/dismiss"); } catch { /* non-critical */ }
}

// Submit a rating (1-5) + optional comment. source: "optimization" | "settings".
export async function submitFeedback({ rating, comment = "", source = "settings" }) {
  const { data } = await api.post("/billing/feedback", { rating, comment, source });
  return data;
}

// Start Pro checkout. billingPeriod: "monthly" | "annual".
// Redirects the whole browser to Stripe's hosted checkout page.
export async function startCheckout(billingPeriod = "monthly") {
  const { data } = await api.post("/billing/create-checkout-session", {
    billing_period: billingPeriod,
  });
  if (data?.url) {
    window.location.href = data.url;
  } else {
    throw new Error("No checkout URL returned");
  }
}

// Open the Stripe customer portal (manage card / cancel / invoices).
export async function openBillingPortal() {
  const { data } = await api.post("/billing/create-portal-session");
  if (data?.url) {
    window.location.href = data.url;
  } else {
    throw new Error("No portal URL returned");
  }
}

/**
 * Detect the backend's "you need to upgrade" 403 so the UI can pop an upsell
 * modal instead of showing a generic error. Both gate styles use these shapes:
 *   { error: "plan_upgrade_required", feature, current_plan, message }
 *   { error: "plan_limit_reached",    limit,   current_plan, message }
 *
 * Usage in a try/catch:
 *   catch (err) {
 *     const info = getUpgradeInfo(err);
 *     if (info) openUpgradeModal(info); else showGenericError();
 *   }
 */
export function getUpgradeInfo(err) {
  const detail = err?.response?.data?.detail;
  if (
    detail &&
    typeof detail === "object" &&
    (detail.error === "plan_upgrade_required" || detail.error === "plan_limit_reached")
  ) {
    return {
      kind: detail.error,                 // which gate fired
      feature: detail.feature || null,    // for feature gates
      limit: detail.limit || null,        // for limit gates
      currentPlan: detail.current_plan || "basic",
      message: detail.message || "Upgrade to Pro to unlock this.",
    };
  }
  return null;
}