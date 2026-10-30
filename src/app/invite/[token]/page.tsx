import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { AcceptInvite } from "@/components/auth/accept-invite";
import { Alert } from "@/components/ui/feedback";
import { formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { label } from "@/lib/nigeria";
import { getActor } from "@/server/auth/current";
import { getInvitationPreview } from "@/server/services/tenancy";

export const metadata = { title: "Tenancy invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, actor] = await Promise.all([getInvitationPreview(token), getActor()]);
  if (!preview) {
    return (
      <AuthCard title="Invitation not available">
        <Alert tone="warning">This invitation is invalid, has expired, or has already been used. Ask your landlord to send a new one.</Alert>
        <p className="mt-4 text-sm">
          <Link href="/login" className="font-medium text-emerald-700 hover:underline">Sign in</Link>
        </p>
      </AuthCard>
    );
  }
  const t = preview.terms;
  return (
    <AuthCard title={`${preview.landlordName} invited you`} subtitle={`Review the tenancy terms recorded for ${preview.emailMasked} before you accept.`}>
      <div className="mb-6 rounded-2xl border border-cream-300 bg-cream-50 p-4 text-sm">
        <p className="font-semibold text-ink-900">
          {preview.property?.name}
          {preview.unit ? ` · ${preview.unit.unitNumber}` : ""}
        </p>
        <p className="text-ink-600">{preview.property ? `${preview.property.city}, ${preview.property.state}` : null}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div><dt className="text-xs text-ink-500">Rent</dt><dd className="tabular font-semibold">{formatKobo(t.rentAmountKobo)} <span className="font-normal text-ink-500">{label(t.frequency).toLowerCase()}</span></dd></div>
          <div><dt className="text-xs text-ink-500">First due</dt><dd>{formatDate(t.firstDueDate)}</dd></div>
          <div><dt className="text-xs text-ink-500">Starts</dt><dd>{formatDate(t.startDate)}</dd></div>
          <div><dt className="text-xs text-ink-500">Ends</dt><dd>{formatDate(t.endDate)}</dd></div>
          <div><dt className="text-xs text-ink-500">Grace period</dt><dd>{t.gracePeriodDays} days</dd></div>
          <div><dt className="text-xs text-ink-500">Deposit</dt><dd className="tabular">{t.depositAmountKobo ? formatKobo(t.depositAmountKobo) : "None recorded"}</dd></div>
        </dl>
        {t.agreedCharges.length ? (
          <div className="mt-3">
            <p className="text-xs text-ink-500">Other agreed charges</p>
            <ul className="mt-1 space-y-0.5">
              {t.agreedCharges.map((c) => (
                <li key={c.label} className="tabular">{c.label}: {formatKobo(c.amountKobo)} ({c.recurrence === "recurring" ? "each period" : "once"})</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="mb-4 text-xs text-ink-500">
        These are the terms your landlord recorded. If anything doesn&apos;t match what you agreed, don&apos;t accept yet — contact your landlord first. Accepting doesn&apos;t replace your signed tenancy agreement.
      </p>
      <AcceptInvite token={token} email={preview.email} accountExists={preview.accountExists} signedInAs={actor ? { email: actor.email, role: actor.role } : null} />
    </AuthCard>
  );
}
