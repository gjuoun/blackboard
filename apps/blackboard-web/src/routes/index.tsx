import { createFileRoute, redirect } from "@tanstack/react-router";

/** The inbox is the product's face: the Sessions home retired, and old links land on the list. */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox", statusCode: 308 });
  },
});