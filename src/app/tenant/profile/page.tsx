import { SettingsPage } from "@/components/shared/settings-page";
import { requirePageActor } from "@/server/auth/current";

export const metadata = { title: "Profile" };

export default async function Page() {
  return <SettingsPage actor={await requirePageActor("tenant")} title="Profile and settings" />;
}
