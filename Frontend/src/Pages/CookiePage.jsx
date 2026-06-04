import { LegalPage, LegalSection, LP, LU } from "../components/LegalBase";

export default function CookiePage() {
  return (
    <LegalPage title="Cookie Policy">
      <LegalSection title="1. What Are Cookies">
        <LP>Cookies are small text files placed on your device when you visit a website. They help the site remember your preferences, keep you logged in, and understand how you use the platform. We also use similar technologies like local storage and session storage.</LP>
      </LegalSection>
      <LegalSection title="2. Cookies We Use">
        <LP><strong style={{ color: "var(--text)" }}>Strictly Necessary Cookies</strong> — These are required for the Service to function. They cannot be disabled.</LP>
        <LU items={[
          "velora_session — keeps you logged in during your browser session.",
          "velora_csrf — protects against cross-site request forgery attacks.",
          "velora_lang — remembers your EN/NL language preference.",
        ]} />
        <LP><strong style={{ color: "var(--text)" }}>Analytics Cookies</strong> — Help us understand how visitors use the platform (set only with your consent).</LP>
        <LU items={[
          "Google Analytics (_ga, _gid) — aggregated, anonymised page view and event tracking.",
          "Sentry session replay — anonymised error diagnostics (no resume content captured).",
        ]} />
        <LP><strong style={{ color: "var(--text)" }}>Payment Cookies</strong> — Set by Stripe during checkout to prevent fraud.</LP>
        <LU items={["__stripe_mid, __stripe_sid — fraud prevention and checkout state."]} />
      </LegalSection>
      <LegalSection title="3. Your Choices">
        <LP>When you first visit Resuviq AI, you will see a cookie consent banner. You can accept all cookies, accept only necessary cookies, or manage your preferences individually. You can change your preferences at any time via the cookie settings link in the footer.</LP>
        <LP>You can also manage cookies directly in your browser settings. Note that disabling strictly necessary cookies will prevent you from logging in or using the platform.</LP>
      </LegalSection>
      <LegalSection title="4. Third-Party Cookies">
        <LP>Some cookies are set by third parties (Google, Stripe, Sentry). These third parties have their own privacy policies. We recommend reviewing them:</LP>
        <LU items={[
          "Google Privacy Policy: policies.google.com/privacy",
          "Stripe Privacy Policy: stripe.com/privacy",
          "Sentry Privacy Policy: sentry.io/privacy",
        ]} />
      </LegalSection>
      <LegalSection title="5. Cookie Retention">
        <LU items={[
          "Session cookies — deleted when you close your browser.",
          "velora_lang — 1 year.",
          "Google Analytics — 2 years (standard GA4 retention).",
          "Stripe — 1 year.",
        ]} />
      </LegalSection>
      <LegalSection title="6. Contact">
        <LP>Questions about cookies or your data? Email us at <strong style={{ color: "var(--g1)" }}>support@resuviq-ai.nl</strong></LP>
      </LegalSection>
    </LegalPage>
  );
}
