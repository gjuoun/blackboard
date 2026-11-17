import { createMiddleware } from "hono/factory";
import { crossSiteWrite, hostAllowed } from "../../../lib/http-guard";
import { json } from "./envelope";
import { HttpError } from "./http.errors";
import { HttpFailure } from "./http.failure";

/**
 * The API's guard. A denial is a failure like any other: it is thrown as `HttpFailure`, so
 * `app.onError` answers with the same envelope every route uses — no second response shape.
 */
export const guard = createMiddleware(async (c, next) => {
  if (!hostAllowed(c.req.header("host") ?? "")) throw new HttpFailure(HttpError.FORBIDDEN_HOST());
  if (crossSiteWrite(c.req.method, c.req.header("origin"))) {
    throw new HttpFailure(HttpError.FORBIDDEN_CROSS_SITE());
  }
  await next();
});

export { json };
