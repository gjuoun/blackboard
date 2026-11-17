import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { EnvelopeFailure, ErrorEnvelope } from "./envelope";

/**
 * The one place a failure becomes a response body. A variant whose status is 5xx says `code` and
 * `message` only: whatever explains it (a SQLite message, a thrown value) belongs in the log, not
 * on the wire.
 */
/**
 * A failure as the single-key catalog record the wire wants. The stores still hand out `WireFailure`
 * instances (`_tag` + `message` + `status`); their tag becomes the code and the rest the payload, so
 * this file stays the only place a failure body is built while the catalog refactor is still ahead.
 */
export function asCatalog(failure: EnvelopeFailure | { readonly _tag: string }): EnvelopeFailure {
  if (!("_tag" in failure)) return failure;
  const { _tag, ...rest } = failure as unknown as { _tag: string } & Record<string, unknown>;
  return { [_tag]: rest } as EnvelopeFailure;
}

export function errorEnvelope(failure: EnvelopeFailure): ErrorEnvelope {
  const catalog = asCatalog(failure);
  const [code, payload] = Object.entries(catalog)[0] as [
    string,
    { status: number; message: string } & Record<string, unknown>,
  ];
  const { status, message, ...rest } = payload;
  const details = Object.fromEntries(Object.entries(rest));
  const error =
    status >= 500 || Object.keys(details).length === 0 ? { code, message } : { code, message, details };
  return { success: false, error };
}

/** The status a variant answers with, read off its catalog entry. */
export function statusOf(failure: EnvelopeFailure): ContentfulStatusCode {
  const [, payload] = Object.entries(asCatalog(failure))[0] as [string, { status: ContentfulStatusCode }];
  return payload.status;
}

/** Last resort for anything that was never classified: one 500, one code, no internals. */
export const INTERNAL_ERROR: EnvelopeFailure = {
  INTERNAL_ERROR: { status: 500, message: "internal error" },
};

/** The value → throw bridge. `app.onError` is the only other half: nothing else builds a failure body. */
export class HttpFailure extends HTTPException {
  readonly failure: EnvelopeFailure;

  /** `label` is the log tag for a 5xx answer ("GET /api/x"): a 4xx is a client answer, silent. */
  constructor(failure: EnvelopeFailure, label?: string) {
    const status = statusOf(failure);
    super(status, {
      message: (Object.values(asCatalog(failure))[0] as { message: string }).message,
      res: new Response(JSON.stringify(errorEnvelope(failure)), {
        status,
        headers: { "content-type": "application/json" },
      }),
    });
    this.failure = failure;
    if (label !== undefined && status >= 500) console.error(label, failure);
  }

  /** A defect or an interrupt: same 500 exit as a classified failure, with the detail logged. */
  static defect(defect: unknown, label?: string): HttpFailure {
    if (label !== undefined) console.error(label, defect);
    else console.error(defect);
    return new HttpFailure(INTERNAL_ERROR);
  }
}
