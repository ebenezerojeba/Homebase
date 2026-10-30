import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import type { Actor } from "@/server/auth/actor";
import { connectDb } from "@/server/db";
import { User } from "@/server/models";
import { listMyDataRequests } from "@/server/services/admin";
import { enabledTextChannels } from "@/server/providers/text";
import { PhoneSettings } from "./phone-settings";
import { NotificationPrefs, PasswordForm, PrivacyControls, ProfileForm } from "./settings-forms";

export async function SettingsPage({ actor, title }: { actor: Actor; title: string }) {
  await connectDb();
  const [user, requests] = await Promise.all([User.findById(actor.userId).select("name email phone phoneVerifiedAt smsEnabled whatsappEnabled emailOptOut").lean(), listMyDataRequests(actor)]);
  return (
    <>
      <PageHeader title={title} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody><ProfileForm name={user?.name ?? ""} email={user?.email ?? ""} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" />
          <CardBody><PasswordForm /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Text alerts (SMS / WhatsApp)" />
          <CardBody>
            <PhoneSettings
              phone={user?.phone ?? null}
              verified={Boolean(user?.phone && user.phoneVerifiedAt)}
              sms={Boolean(user?.smsEnabled)}
              whatsapp={Boolean(user?.whatsappEnabled)}
              available={enabledTextChannels()}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Email notifications" />
          <CardBody><NotificationPrefs role={actor.role} optOut={user?.emailOptOut ?? []} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Privacy and your data" description="Your rights under the Nigeria Data Protection Act 2023" />
          <CardBody>
            <PrivacyControls requests={requests.map((r) => ({ _id: r._id.toString(), type: r.type, status: r.status, createdAt: r.createdAt.toISOString(), resolutionNote: r.resolutionNote ?? null }))} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
