import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/forms";
import { getActor, homeFor } from "@/server/auth/current";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(homeFor(actor.role));
  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your account." footer={<>New here? <Link href="/register" className="font-medium text-emerald-700 hover:underline">Create an account</Link></>}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
