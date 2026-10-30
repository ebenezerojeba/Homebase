import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { APP_NAME } from "@/lib/brand";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 rounded-lg" aria-label={`${APP_NAME} home`}>
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-md animate-slide-up rounded-2xl border border-cream-300/80 bg-white p-6 shadow-card sm:p-8">
        <h1 className="text-xl font-bold tracking-tight text-ink-900">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm text-ink-600">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <div className="mt-6 text-sm text-ink-600">{footer}</div> : null}
    </main>
  );
}
