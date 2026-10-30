import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/brand";

export const metadata = { title: "Privacy notice" };

/**
 * Plain-language privacy notice aligned with the Nigeria Data Protection Act 2023.
 * Have this reviewed by a qualified Nigerian data-protection professional before production use.
 */
export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/" aria-label={`${APP_NAME} home`}><Logo size="md" /></Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Privacy notice</h1>
      <p className="mt-2 text-sm text-ink-500">Draft for legal review · applies to landlords and tenants using {APP_NAME}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-ink-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900 [&_li]:ml-5 [&_li]:list-disc">
        <p>We process personal data in line with the Nigeria Data Protection Act 2023 (NDPA). This notice explains what we collect, why, how long we keep it, and your rights.</p>
        <h2>What we collect</h2>
        <ul>
          <li>Account details: name, email address, optional phone number, password (stored only as a one-way hash).</li>
          <li>Tenancy records: property address, unit, agreed rent and dates, charges, payments, receipts, and the shared tenancy timeline.</li>
          <li>Payment details: amounts, dates, references and status. We never store card numbers, CVVs or bank login details — online payments are handled by our payment provider.</li>
          <li>Content you upload: agreements, payment evidence, repair and inspection photos, messages.</li>
          <li>Security data: sign-in times and coarse technical information needed to protect accounts.</li>
        </ul>
        <p>We do not ask for identity documents (NIN, BVN, passports) and you should not upload them.</p>
        <h2>Why we process it (lawful basis)</h2>
        <ul>
          <li>To provide the service you asked for (contract): tenancy records, payments, receipts, reminders, messaging, repairs.</li>
          <li>To meet legal obligations, such as keeping financial records.</li>
          <li>Legitimate interests: preventing fraud and abuse, securing accounts, keeping an accurate shared record for both parties.</li>
        </ul>
        <h2>Who can see it</h2>
        <p>Your landlord or tenant sees only the records of the tenancy you share. Landlord-only notes are not shown to tenants. Our staff access personal data only when needed to support you or keep the platform secure, and that access is logged. We use processors for hosting (MongoDB Atlas), file storage (Cloudinary), email (Brevo) and payments (Paystack), under contracts that require them to protect your data. We do not sell personal data or publish tenant ratings or blacklists.</p>
        <h2>How long we keep it</h2>
        <ul>
          <li>Tenancy, payment and receipt records: 6 years after the tenancy ends (financial record-keeping), then deleted or anonymised.</li>
          <li>Messages and repair history: for the life of the tenancy plus 2 years.</li>
          <li>Deactivated accounts: profile details are kept only as long as linked financial records must be retained.</li>
          <li>Security logs: 12 months.</li>
        </ul>
        <h2>Your rights</h2>
        <p>You can access and download your data, ask us to correct it, object to or restrict processing, request deletion (subject to records we must keep), and withdraw consent where we rely on it. Use Settings → Privacy in the app, or email <a className="text-emerald-700 underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We respond within 30 days. You may also complain to the Nigeria Data Protection Commission (NDPC).</p>
        <h2>Security and incidents</h2>
        <p>Data is encrypted in transit, private documents are delivered only through short-lived authorised links, and financial history is append-only. If a breach is likely to put your rights at risk, we will notify the NDPC within 72 hours and inform affected users without undue delay.</p>
        <h2>International transfers</h2>
        <p>Our providers may store data outside Nigeria. We use providers with adequate safeguards as required by the NDPA.</p>
      </div>
    </main>
  );
}
