import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bootstrap } from "../lib/bootstrap";
import pkg from "../package.json";
import { json } from "./platform/http/envelope";
import { guard } from "./platform/http/guard.middleware";
import { HttpFailure, INTERNAL_ERROR } from "./platform/http/http.failure";
import { assetRoutes } from "./routes/asset";
import { bindRoutes } from "./routes/bind";
import { commentsRoutes } from "./routes/comments";
import { docRoutes } from "./routes/doc";
import { imagesRoutes } from "./routes/images";
import { readingRoutes } from "./routes/reading";
import { watchRoutes } from "./routes/watch";

/**
 * The Blackboard API: the business layer the UI forwards to. One Hono app, mounted under /api so the
 * browser URLs and the internal URLs are identical.
 *
 * This file only wires: every dependency is built once in `bootstrap()` and handed to a route factory.
 */
const services = bootstrap();

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

app.route("/api/comments", commentsRoutes(services.comments, services.sessions, services.agents));
app.route("/api/bind", bindRoutes(services.agents, services.sessions));
app.route("/api/reading", readingRoutes(services.sessions, services.reading, services.comments));
app.route("/api/comment-images", imagesRoutes());
app.route("/api/asset", assetRoutes(services.sessions));
app.route("/api/watch", watchRoutes(services.sessions, services.bus));
app.route("/api", docRoutes(services.sessions, services.comments, services.reading));
