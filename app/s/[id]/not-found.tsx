import Link from "next/link";
import { ForgetTab } from "@/components/RegisterTab";

export default function SessionNotFound() {
  return (
    <main className="home" data-testid="session-not-found">
      <ForgetTab />
      <h1>No such session</h1>
      <p className="muted">
        It was closed or never opened. Open a file with <code>blackboard open &lt;file&gt;</code>, or go <Link href="/">Home</Link>.
      </p>
    </main>
  );
}
