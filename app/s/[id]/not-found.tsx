import type { Metadata } from "next";
import Link from "next/link";
import { ForgetTab } from "@/components/RegisterTab";

export const metadata: Metadata = { title: "No such session" };

export default function SessionNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 md:px-6" data-testid="session-not-found">
      <ForgetTab />
      <h1 className="text-2xl font-bold">No such session</h1>
      <p className="text-muted-foreground mt-3">
        It was closed or never opened. Open a file with <code className="bg-code rounded px-1.5">blackboard open &lt;file&gt;</code>, or go{" "}
        <Link href="/" className="text-primary hover:underline">
          Home
        </Link>
        .
      </p>
    </main>
  );
}
