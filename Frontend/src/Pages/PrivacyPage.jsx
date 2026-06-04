import { LegalPage, LegalSection, LP, LU } from "../components/LegalBase";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="1. Who We Are">
        <LP>Resuviq AI B.V. ("Resuviq AI", "we", "us", "our") is a software company registered in Amsterdam, The Netherlands. We operate the website <strong style={{ color: "var(--text)" }}>resuviq-ai.nl</strong> and the Resuviq AI platform (collectively the "Service").</LP>
        <LP>Data Controller: Resuviq AI B.V., Herengracht 124, 1015 BT Amsterdam, The Netherlands. Contact: <strong style={{ color: "var(--g1)" }}>support@resuviq-ai.nl</strong></LP>
      </LegalSection>
      <LegalSection title="2. What Data We Collect">
        <LP>We collect the following categories of personal data:</LP>
        <LU items={[
          "Account data: name, email address, password (hashed), registration date.",
          "Resume data: the CV or resume you upload, extracted skills, keywords, and work history.",
          "Usage data: pages visited, features used, timestamps, device type, IP address, browser.",
          "Job match data: job listings matched against your resume, ATS scores, match history.",
          "Payment data: billing address and payment method (processed securely by Stripe — we do not store card numbers).",
          "Communications: emails, support messages, and feedback you send us.",
        ]} />
      </LegalSection>
      <LegalSection title="3. How We Use Your Data">
        <LU items={[
          "To provide and improve the Resuviq AI matching and ATS scoring service.",
          "To process your resume and generate personalised job matches.",
          "To send transactional emails (account, job alerts, billing receipts).",
          "To send marketing emails, where you have given explicit consent (opt-out anytime).",
          "To analyse usage patterns and improve platform performance.",
          "To comply with legal obligations under Dutch and EU law.",
        ]} />
      </LegalSection>
      <LegalSection title="4. Legal Basis for Processing (GDPR)">
        <LP>We process your personal data under the following legal bases:</LP>
        <LU items={[
          "Contract performance — to deliver the Service you signed up for.",
          "Legitimate interests — to improve our platform, prevent fraud, and ensure security.",
          "Consent — for marketing emails and non-essential cookies.",
          "Legal obligation — to comply with applicable law.",
        ]} />
      </LegalSection>
      <LegalSection title="5. Data Sharing">
        <LP>We do not sell your personal data. We share data only with trusted sub-processors necessary to operate the Service:</LP>
        <LU items={[
          "AWS / Google Cloud — cloud infrastructure and storage (EU data centres).",
          "Stripe — payment processing (PCI-DSS compliant).",
          "Postmark / SendGrid — transactional email delivery.",
          "Sentry — error monitoring (anonymised logs only).",
          "Google Analytics — aggregated, anonymised usage analytics.",
        ]} />
        <LP>All processors are bound by data processing agreements in accordance with GDPR Art. 28.</LP>
      </LegalSection>
      <LegalSection title="6. Your Rights Under GDPR">
        <LP>As an EU/EEA resident you have the right to:</LP>
        <LU items={[
          "Access the personal data we hold about you.",
          "Rectify inaccurate or incomplete data.",
          "Erase your data ('right to be forgotten').",
          "Restrict or object to certain processing.",
          "Data portability — receive your data in a structured, machine-readable format.",
          "Withdraw consent at any time (where processing is based on consent).",
          "Lodge a complaint with the Dutch Data Protection Authority (Autoriteit Persoonsgegevens) at autoriteitpersoonsgegevens.nl.",
        ]} />
        <LP>To exercise any right, email us at <strong style={{ color: "var(--g1)" }}>support@resuviq-ai.nl</strong>. We respond within 30 days.</LP>
      </LegalSection>
      <LegalSection title="7. Data Retention">
        <LP>We retain your data for as long as your account is active, plus 90 days after deletion for backup purposes. Resume embeddings are deleted immediately upon account deletion. Payment records are retained for 7 years as required by Dutch tax law.</LP>
      </LegalSection>
      <LegalSection title="8. Security">
        <LP>We use industry-standard security measures including TLS 1.3 encryption in transit, AES-256 encryption at rest, bcrypt password hashing, rate limiting, and regular penetration testing. However, no system is 100% secure. Please use a strong, unique password.</LP>
      </LegalSection>
      <LegalSection title="9. Changes to This Policy">
        <LP>We may update this policy. We will notify you by email and update the "last updated" date above. Continued use of the Service after changes constitutes acceptance.</LP>
      </LegalSection>
    </LegalPage>
  );
}
