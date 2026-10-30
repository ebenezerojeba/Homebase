import { AuthCard } from "@/components/auth/auth-card";
import { VerifyEmail } from "@/components/auth/forms";

export const metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Verifying your email">
      <VerifyEmail token={token ?? null} />
    </AuthCard>
  );
}
