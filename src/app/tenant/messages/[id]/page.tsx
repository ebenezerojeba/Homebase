import { MessagesPage } from "@/components/shared/messages-page";
import { requirePageActor } from "@/server/auth/current";

export const metadata = { title: "Messages" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <MessagesPage actor={await requirePageActor("tenant")} conversationId={(await params).id} />;
}
