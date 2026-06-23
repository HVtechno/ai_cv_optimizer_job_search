import api from "./api";

/**
 * polar.js — thin wrappers around the /polar endpoints (NEW, additive).
 *
 * Mirrors the structure of Billing.jsx (the Stripe wrappers) so components stay
 * clean. Reuses the existing axios `api` instance (which attaches the Bearer
 * token automatically), so nothing here touches auth directly.
 *
 * Polar is the Merchant of Record: the user pays on Polar's hosted checkout
 * (cards, iDEAL, etc.), Polar handles VAT/tax, and a signed webhook to our
 * backend grants Pro. There is no manual approval step.
 */

// Current user's Polar-backed subscription view (plan + status). Auth required.
export async function fetchPolarSubscription() {
  const { data } = await api.get("/polar/subscription");
  return data;
}

// Start Pro checkout on Polar. Redirects the whole browser to Polar's hosted
// checkout page. After payment, Polar redirects back to POLAR_SUCCESS_URL and
// (separately) fires the webhook that actually grants Pro.
export async function startPolarCheckout() {
  const { data } = await api.post("/polar/create-checkout");
  if (data?.url) {
    window.location.href = data.url;
  } else {
    throw new Error("No checkout URL returned");
  }
}
