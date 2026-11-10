import { Effect } from "effect";
import { Hono } from "hono";
import pkg from "../package.json";
import { guard } from "./guard";
import { respond } from "./respond";

/**
 * The Blackboard API: the business layer the Next app proxies to. One Hono app, mounted under
 * /api so the browser URLs and the internal URLs are identical — the forwarder in app/ sends
 * the path through unchanged.
 */
export const app = new Hono();

app.use("*", guard);

/** Lets `blackboard serve` tell a running Blackboard API from any other server on the port. */
app.get("/api/health", () => respond(Effect.succeed({ app: "blackboard", version: pkg.version })));
