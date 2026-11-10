import { Effect } from "effect";
import { Hono } from "hono";
import pkg from "../package.json";
import { guard } from "./guard";
import { respond } from "./respond";
import { asset } from "./routes/asset";
import { bind } from "./routes/bind";
import { comments, review } from "./routes/comments";
import { doc } from "./routes/doc";
import { images } from "./routes/images";
import { reading } from "./routes/reading";
import { streams } from "./routes/streams";
import { watch } from "./routes/watch";

/**
 * The Blackboard API: the business layer the Next app proxies to. One Hono app, mounted under
 * /api so the browser URLs and the internal URLs are identical — the forwarder in app/ sends
 * the path through unchanged.
 */
export const app = new Hono();

app.use("*", guard);

/** Lets `blackboard serve` tell a running Blackboard API from any other server on the port. */
app.get("/api/health", () => respond(Effect.succeed({ app: "blackboard", version: pkg.version })));

app.route("/api/comments", comments);
app.route("/api/bind", bind);
app.route("/api/review", review);
app.route("/api/reading", reading);
app.route("/api/comment-images", images);
app.route("/api/asset", asset);
app.route("/api/watch", watch);
app.route("/api", streams);
app.route("/api", doc);
