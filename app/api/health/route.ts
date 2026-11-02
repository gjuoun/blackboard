import { Effect } from "effect";
import pkg from "../../../package.json";
import { respond } from "@/lib/effect/respond";

/** Lets `blackboard serve` and `blackboard open` tell a running Blackboard from any other server on the port. */
export async function GET() {
  return respond(Effect.succeed({ app: "blackboard", version: pkg.version }));
}
