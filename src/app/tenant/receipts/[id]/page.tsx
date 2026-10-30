import { ReceiptPage } from "@/components/shared/receipt-page";
import { requirePageActor } from "@/server/auth/current";

export const metadata = { title: "Receipt" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("tenant");
  return <ReceiptPage actor={actor} id={(await params).id} back="/tenant/receipts" />;
}
