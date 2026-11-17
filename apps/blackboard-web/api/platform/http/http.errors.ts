import { Errors } from "@gjuoun/safe-ts";
import { DENY_CROSS_SITE, DENY_HOST } from "../../../lib/http-guard";

/**
 * The HTTP-side catalog: the failures the transport itself produces, before any domain logic runs.
 * Domain catalogs live in `lib/errors/`. Every variant fixes its status and the exact message both
 * faces print.
 */
export const HttpError = Errors.define({
  FORBIDDEN_HOST: () => ({ status: 403 as const, message: DENY_HOST }),
  FORBIDDEN_CROSS_SITE: () => ({ status: 403 as const, message: DENY_CROSS_SITE }),
});
