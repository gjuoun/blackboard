import { Effect, Schema, SchemaGetter } from "effect";
import { CliError } from "../cli";

/**
 * The option records the subcommands decode, one per command. A field that is wrong is bad usage:
 * the annotation on it is the message the CLI has always printed, and the decode is the only place
 * that check lives.
 */

/** Decode one record at the CLI edge. A bad value becomes the exit-code-2 failure, never a SchemaError. */
export function decodeArgs<T>(schema: Schema.Codec<T, unknown>, input: unknown): Effect.Effect<T, CliError> {
  return Schema.decodeUnknownEffect(schema)(input).pipe(
    // The formatter appends the failing path on later lines; a CLI message is one line.
    Effect.mapError((error) => new CliError({ message: error.message.split("\n")[0], code: 2 })),
  );
}


/** A whole number written as text, which is how every numeric option arrives. */
const WholeNumber = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt({ message: "--occurrence must be a whole number" })),
);

/**
 * `--occurrence`: a whole number, or nothing. An empty value is the flag written without one, so it
 * means "not given" and the first match — the way the CLI read it before the options were decoded. A
 * value that is there and is not a whole number is still bad usage.
 */
const Occurrence = Schema.optional(Schema.String).pipe(
  Schema.decodeTo(Schema.optional(WholeNumber), {
    decode: SchemaGetter.transform((text) => (text === "" ? undefined : text)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

/**
 * `comment`: exactly one anchor. A general note and a quote are mutually exclusive, and one of them
 * must be there; the decoded record says which one it got.
 */
export const CommentArgs = Schema.Struct({
  general: Schema.optional(Schema.Boolean),
  quote: Schema.optional(Schema.String),
  occurrence: Occurrence,
})
  .pipe(
    Schema.check(
      Schema.makeFilter((args) => !(Boolean(args.general) && Boolean(args.quote)), {
        message: "comment takes --general alone, not with --quote",
      }),
    ),
  )
  .pipe(
    Schema.refine(
      (args): args is
        | { readonly general: true; readonly quote?: undefined; readonly occurrence?: number }
        | { readonly general?: undefined; readonly quote: string; readonly occurrence?: number } =>
        Boolean(args.general) ? !args.quote : Boolean(args.quote),
      { message: "comment needs --quote <passage> or --general" },
    ),
  );
export type CommentArgs = typeof CommentArgs.Type;

/** `db migrate --dry-run`: the flag as given. */
export const MigrateArgs = Schema.Struct({ dry: Schema.optional(Schema.Boolean) });
export type MigrateArgs = typeof MigrateArgs.Type;

/** `review --round`: a round number starts at 1, and a missing or fractional one is the same refusal. */
export const ReviewArgs = Schema.Struct({ round: Schema.optional(Schema.NumberFromString) }).pipe(
  Schema.refine((args): args is { readonly round: number } => args.round !== undefined && Number.isInteger(args.round) && args.round >= 1, {
    message: "--round must be a whole number from 1",
  }),
);
export type ReviewArgs = typeof ReviewArgs.Type;
