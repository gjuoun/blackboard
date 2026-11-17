import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import pkg from "../package.json";
import { json } from "./platform/http/envelope";
import { guard } from "./platform/http/guard.middleware";
import { HttpFailure, INTERNAL_ERROR } from "./platform/http/http.failure";
import { respond } from "./respond";
import { asset } from "./routes/asset";
import { bind } from "./routes/bind";
import { comments } from "./routes/comments";
import { doc } from "./routes/doc";
import { images } from "./routes/images";
import { reading } from "./routes/reading";
import { watch } from "./routes/watch";

/**
 * The Blackboard API: the business layer the UI forwards to. One Hono app, mounted under /api so
 * the browser URLs and the internal URLs are identical.
 */
export const app = new Hono();

app.use("*", guard);

/**
 * The only conversion point from a failure to a response. `HttpFailure` carries the body it already
 * built; anything else was never classified, so it becomes one 500 with the detail only in the log.
 */
app.onError((err, _c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return new HttpFailure(INTERNAL_ERROR).getResponse();
});

/** Lets `blackboard serve` tell a running Blackboard API from any other server on the port. */
app.get("/api/health", (c) => json(c, Safe.ok({ app: "blackboard", version: pkg.version })));

app.route("/api/comments", comments);
app.route("/api/bind", bind);
app.route("/api/reading", reading);
app.route("/api/comment-images", images);
app.route("/api/asset", asset);
app.route("/api/watch", watch);
app.route("/api", doc);
