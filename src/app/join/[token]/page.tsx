import { Suspense } from "react";
import { JoinForm } from "@/components/Entry";

async function Form({ params }: { params: Promise<{ token: string }> }) {
  return <JoinForm token={(await params).token} />;
}

// The token is only known per request, so it is read inside Suspense (Cache Components).
export default function Join({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="p-6 text-muted">Loading…</main>}>
      <Form params={params} />
    </Suspense>
  );
}
