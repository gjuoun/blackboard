import { createFileRoute, redirect } from "@tanstack/react-router";

/** The inbox moved; this route only exists so old links keep working, and it answers 308 like it did under Next. */
export const Route = createFileRoute("/workspace/")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox", statusCode: 308 });
  },
});
