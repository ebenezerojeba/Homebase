import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { APP_NAME } from "@/lib/brand";

export const metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/" aria-label={`${APP_NAME} home`}><Logo size="md" /></Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Terms of use</h1>
      <p className="mt-2 text-sm text-ink-500">Draft for legal review</p>
      <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink-700">
        <p>{APP_NAME} is a record-keeping and communication tool for landlords and tenants. It is not a party to your tenancy, a bank, an escrow service or a legal adviser.</p>
        <p><strong>Records, not verdicts.</strong> The shared tenancy record shows who recorded or confirmed each entry and when. It does not by itself prove legal liability, guarantee that uploaded documents are authentic, or resolve disputes.</p>
        <p><strong>Payments.</strong> Online payments are processed by our payment provider and only count once the provider confirms them. Payments made outside {APP_NAME} only count once the landlord confirms them. We never hold funds.</p>
        <p><strong>Your responsibilities.</strong> Enter accurate information, only upload documents you have the right to share, and don&apos;t use the service to harass, threaten or publicly shame anyone.</p>
        <p><strong>Agreements.</strong> Any tenancy agreement uploaded or referenced here should be reviewed by a qualified legal professional. {APP_NAME} does not provide legally validated templates.</p>
      </div>
    </main>
  );
}
