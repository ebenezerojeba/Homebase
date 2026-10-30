import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Manrope } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/brand";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap", weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — rent, records and repairs in one place`, template: `%s · ${APP_NAME}` },
  description: "A shared, trustworthy tenancy record for Nigerian landlords and tenants: rent schedules, verified payments, receipts, repairs and messages.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0B1F3A",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading request headers renders every page per request, so Next can apply the CSP nonce set in proxy.ts.
  await headers();
  return (
    <html lang="en-NG" className={manrope.variable}>
      <body className="font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-pop">
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
