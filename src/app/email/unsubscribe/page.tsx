import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { label } from "@/lib/nigeria";
import { verifyUnsubscribe } from "@/server/services/unsubscribe";

export const metadata = { title: "Email preferences" };

/** Confirmation step (a plain link visit never unsubscribes, so link scanners can't trigger it). */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  if (sp.done) {
    return (
      <AuthCard title="You're unsubscribed">
        <Alert tone="success">We won&apos;t email you about this again. You&apos;ll still see these updates in the app, and you can change this any time in Settings.</Alert>
      </AuthCard>
    );
  }
  const v = verifyUnsubscribe(sp.u ?? null, sp.t ?? null, sp.s ?? null);
  if (!v) {
    return (
      <AuthCard title="Link not valid">
        <Alert tone="warning">This unsubscribe link is invalid. You can manage email preferences in Settings after signing in.</Alert>
      </AuthCard>
    );
  }
  const action = `/api/email/unsubscribe?${new URLSearchParams({ u: sp.u!, t: sp.t!, s: sp.s! })}`;
  return (
    <AuthCard title="Stop these emails?" subtitle={`You'll no longer get "${label(v.type)}" emails. They'll still appear in the app.`}>
      <form method="post" action={action}>
        <input type="hidden" name="from" value="page" />
        <Button type="submit" className="w-full" size="lg">Unsubscribe</Button>
      </form>
    </AuthCard>
  );
}
