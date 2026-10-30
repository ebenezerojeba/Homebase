import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/forms";
import { getActor, homeFor } from "@/server/auth/current";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  const actor = await getActor();
  if (actor) redirect(homeFor(actor.role));
  return (
    <AuthCard title="Create your account" subtitle="Free for individual landlords and their tenants." footer={<>Already have an account? <Link href="/login" className="font-medium text-emerald-700 hover:underline">Sign in</Link></>}>
      <RegisterForm />
    </AuthCard>
  );
}
