import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forms";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a single-use link that expires in an hour." footer={<Link href="/login" className="font-medium text-emerald-700 hover:underline">Back to sign in</Link>}>
      <ForgotPasswordForm />
    </AuthCard>
  );
}
