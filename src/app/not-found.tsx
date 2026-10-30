import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-[60dvh] place-items-center px-4 text-center">
      <div>
        <p className="text-sm font-semibold text-emerald-700">404</p>
        <h1 className="mt-2 text-2xl font-semibold">We couldn&apos;t find that</h1>
        <p className="mt-2 text-sm text-ink-600">The page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-emerald-700 hover:underline">Go home</Link>
      </div>
    </main>
  );
}
