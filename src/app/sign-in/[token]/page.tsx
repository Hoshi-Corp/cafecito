import { Suspense } from "react";
import { SignInLink } from "@/components/Entry";

async function Button({ params }: { params: Promise<{ token: string }> }) {
  return <SignInLink token={(await params).token} />;
}

// The token is only known per request, so it is read inside Suspense (Cache Components).
export default function SignIn({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="p-6 text-muted">Loading…</main>}>
      <Button params={params} />
    </Suspense>
  );
}
