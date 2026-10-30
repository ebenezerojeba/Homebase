import { ClipboardCheck, Receipt, ScrollText, ShieldCheck, Wrench } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon, Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { APP_NAME } from "@/lib/brand";
import { getActor, homeFor } from "@/server/auth/current";

const features = [
  { icon: ScrollText, title: "One shared record", body: "Every agreed term, payment, receipt, repair and correction is timestamped and shows who recorded it — visible to landlord and tenant alike." },
  { icon: ClipboardCheck, title: "Payments you can trust", body: "Online payments are verified with the provider. Transfers are confirmed by the landlord before they count. Nothing is silently changed." },
  { icon: Receipt, title: "Receipts and statements", body: "Receipts only for confirmed payments, and statements that reconcile line by line with the ledger." },
  { icon: Wrench, title: "Repairs with accountability", body: "Report with photos, follow progress, and confirm when it's really fixed." },
];

export default async function Landing() {
  const actor = await getActor();
  if (actor) redirect(homeFor(actor.role));
  return (
    <div className="min-h-dvh">
      <header className="border-b border-cream-300 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label={`${APP_NAME} home`}>
            <Logo size="md" />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-ink-800 md:flex" aria-label="Product">
            <a href="#landlords" className="hover:text-emerald-700">For landlords</a>
            <a href="#tenants" className="hover:text-emerald-700">For tenants</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-800 hover:bg-cream-100">Sign in</Link>
            <ButtonLink href="/register" size="sm">Get started</ButtonLink>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:pt-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              <ShieldCheck className="size-3.5" aria-hidden /> Built for Nigerian landlords and tenants
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-[-0.035em] text-ink-900 sm:text-6xl">Rent, repairs and updates in one shared place.</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-600">
              {APP_NAME} keeps landlords and tenants on the same page — every message, payment and request on record. Works just as well for one flat as for a whole block.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/register" size="lg" variant="accent">Add your first property</ButtonLink>
              <ButtonLink href="/login" size="lg" variant="outline">I have an account</ButtonLink>
            </div>
          </div>
          {/* Product preview, matching the in-app tenant home */}
          <div className="mx-auto w-full max-w-xs rounded-[2.25rem] border-[10px] border-ink-900 bg-white p-4 shadow-pop" aria-hidden>
            <div className="flex items-center justify-between">
              <Logo size="sm" compact />
              <span className="grid size-8 place-items-center rounded-xl border border-cream-300">
                <span className="size-2 rounded-full bg-emerald-600" />
              </span>
            </div>
            <div className="mt-4 rounded-2xl bg-ink-900 p-4 text-white">
              <p className="text-xs text-ink-300">Rent due</p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight">₦150,000.00</p>
              <div className="mt-3 h-1.5 rounded-full bg-white/10">
                <div className="h-full w-3/5 rounded-full bg-emerald-500" />
              </div>
            </div>
            {[0, 1].map((i) => (
              <div key={i} className="mt-3 space-y-2 rounded-2xl border border-cream-200 p-3">
                <div className="h-2 w-1/2 rounded-full bg-cream-200" />
                <div className="h-2 w-4/5 rounded-full bg-cream-200" />
              </div>
            ))}
          </div>
        </section>
        <section className="border-y border-cream-300 bg-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {features.map((f) => (
              <div key={f.title}>
                <span className="grid size-11 place-items-center rounded-xl bg-ink-900 text-emerald-500">
                  <f.icon className="size-5" aria-hidden />
                </span>
                <h2 className="mt-4 font-bold text-ink-900">{f.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:px-6 md:grid-cols-2">
          <div id="landlords" className="rounded-2xl bg-ink-900 p-7 text-white">
            <h2 className="text-xl font-bold">For landlords</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-300">See what&apos;s been paid, what&apos;s owed and what needs fixing across every unit. Confirm transfers in one place, issue receipts automatically, and export clean statements.</p>
          </div>
          <div id="tenants" className="rounded-2xl border border-cream-300 bg-white p-7">
            <h2 className="text-xl font-bold text-ink-900">For tenants</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">Know exactly what&apos;s due and when, pay online or report a transfer, keep every receipt, and track repairs from report to fix.</p>
          </div>
        </section>
        <footer className="border-t border-cream-300 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-3">
              <AppIcon className="size-7" />
              <p>{APP_NAME} organises records; it doesn&apos;t decide disputes. Payments are processed by licensed providers — we never hold your money.</p>
            </div>
            <p className="flex shrink-0 gap-4">
              <Link href="/privacy" className="hover:text-ink-800 hover:underline">Privacy</Link>
              <Link href="/terms" className="hover:text-ink-800 hover:underline">Terms</Link>
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
