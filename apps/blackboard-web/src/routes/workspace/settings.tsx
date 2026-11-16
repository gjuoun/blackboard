import { createFileRoute, redirect } from "@tanstack/react-router";

/** The inbox moved; this route only exists so old links keep working, and it answers 308 like it did under Next. */
export const Route = createFileRoute("/workspace/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox/settings", statusCode: 308 });
  },
});
