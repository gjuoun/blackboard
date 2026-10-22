import pkg from "../../../package.json";

/** Lets `blackboard serve` and `blackboard open` tell a running Blackboard from any other server on the port. */
export function GET() {
  return Response.json({ app: "blackboard", version: pkg.version });
}
