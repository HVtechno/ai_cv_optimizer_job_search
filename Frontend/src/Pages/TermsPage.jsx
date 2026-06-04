import { LegalPage, LegalSection, LP, LU } from "../components/LegalBase";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <LegalSection title="1. Acceptance of Terms">
        <LP>By creating an account or using the Resuviq AI platform ("Service"), you agree to these Terms of Service ("Terms"). If you do not agree, do not use the Service. These Terms form a binding agreement between you and Resuviq AI B.V.</LP>
      </LegalSection>
      <LegalSection title="2. Description of Service">
        <LP>Resuviq AI provides an AI-powered job matching platform that: (a) scrapes publicly available LinkedIn job listings on a daily basis; (b) analyses and embeds your uploaded resume; (c) calculates match scores between your resume and job listings; (d) provides ATS optimisation recommendations; and (e) enables you to track job applications.</LP>
        <LP>We do not guarantee employment outcomes, interview invitations, or job placement. Match scores and ATS recommendations are algorithmic estimates and may not reflect every employer's screening system.</LP>
      </LegalSection>
      <LegalSection title="3. Account Registration">
        <LU items={[
          "You must be 16 or older to use the Service.",
          "You are responsible for maintaining the confidentiality of your login credentials.",
          "You must provide accurate, complete information during registration.",
          "One account per person. Do not share your account.",
          "Notify us immediately at support@resuviq-ai.nl if you suspect unauthorised access.",
        ]} />
      </LegalSection>
      <LegalSection title="4. Subscription & Payments">
        <LP>Resuviq AI offers free and paid plans. Paid plans are billed monthly or annually via Stripe. All prices are inclusive of applicable VAT. You may cancel at any time; cancellation takes effect at the end of the current billing period. We do not offer pro-rata refunds for partial months unless required by law.</LP>
      </LegalSection>
      <LegalSection title="5. Acceptable Use">
        <LP>You agree not to:</LP>
        <LU items={[
          "Use the Service for any unlawful purpose or in violation of any applicable regulation.",
          "Upload false, misleading, or fraudulent resume content.",
          "Scrape, crawl, or systematically extract data from the Service.",
          "Attempt to reverse-engineer, decompile, or tamper with the platform.",
          "Use automated tools to create accounts or generate artificial activity.",
          "Share, resell, or sublicense access to the Service without permission.",
        ]} />
      </LegalSection>
      <LegalSection title="6. Intellectual Property">
        <LP>All platform code, AI models, design elements, and brand assets are the exclusive property of Resuviq AI B.V. Your resume content remains your property; by uploading it, you grant us a limited licence to process it solely to provide the Service.</LP>
      </LegalSection>
      <LegalSection title="7. Limitation of Liability">
        <LP>To the maximum extent permitted by Dutch law, Resuviq AI's total liability for any claim arising out of these Terms shall not exceed the amount you paid us in the 3 months preceding the claim. We are not liable for indirect, incidental, or consequential damages including loss of employment opportunity.</LP>
      </LegalSection>
      <LegalSection title="8. Termination">
        <LP>We reserve the right to suspend or terminate your account if you breach these Terms, engage in fraudulent activity, or if we are required to do so by law. You may delete your account at any time from account settings.</LP>
      </LegalSection>
      <LegalSection title="9. Governing Law">
        <LP>These Terms are governed by Dutch law. Disputes shall be submitted to the competent court in Amsterdam, The Netherlands, unless mandatory consumer protection rules provide otherwise.</LP>
      </LegalSection>
      <LegalSection title="10. Contact">
        <LP>Questions about these Terms? Contact us at <strong style={{ color: "var(--g1)" }}>support@resuviq-ai.nl</strong> or Resuviq AI B.V., Herengracht 124, 1015 BT Amsterdam, The Netherlands.</LP>
      </LegalSection>
    </LegalPage>
  );
}
