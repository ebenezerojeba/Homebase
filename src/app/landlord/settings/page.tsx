import { SettingsPage } from "@/components/shared/settings-page";
import { requirePageActor } from "@/server/auth/current";

export const metadata = { title: "Settings" };

export default async function Page() {
  return <SettingsPage actor={await requirePageActor("landlord")} title="Settings" />;
}
