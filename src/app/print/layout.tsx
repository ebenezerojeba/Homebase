import { requirePageActor } from "@/server/auth/current";

/** Print-friendly pages (statements, records). Same authorization as the app; no navigation chrome. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requirePageActor("landlord", "tenant");
  return <main id="main" className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:p-0">{children}</main>;
}
