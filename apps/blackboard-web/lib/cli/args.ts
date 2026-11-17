import { Safe } from "@gjuoun/safe-ts";
import { z } from "zod";
import type { CliError } from "../cli";

/**
 * The option records the subcommands decode, one per command. A field that is wrong is bad usage: the
 * message on it is the one the CLI has always printed, and the decode is the only place that check
 * lives.
 */

/** The exit-code-2 failure a bad option produces. A CLI message is one line. */
const badUsage = (message: string): CliError => ({
  CliError: { message: message.split("\n")[0] ?? "bad usage", code: 2 },
});

/** Decode one record at the CLI edge. A bad value becomes the exit-code-2 failure. */
export function decodeArgs<T>(schema: z.ZodType<T>, input: unknown): Safe<T, CliError> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return Safe.ok(parsed.data);
  return Safe.err(badUsage(parsed.error.issues[0]?.message ?? "bad usage"));
}

/**
 * `--occurrence`: a whole number, or nothing. An empty value is the flag written without one, so it
 * means "not given" and the first match — the way the CLI read it before the options were decoded. A
 * value that is there and is not a whole number is still bad usage.
 */
const occurrence = z
  .string()
  .optional()
  .transform((text) => (text === "" || text === undefined ? undefined : Number(text)))
  .refine((n) => n === undefined || Number.isInteger(n), { message: "--occurrence must be a whole number" });

/**
 * `comment`: exactly one anchor. A general note and a quote are mutually exclusive, and one of them
 * must be there; the decoded record says which one it got.
 */
export const CommentArgs = z
  .object({
    general: z.boolean().optional(),
    quote: z.string().optional(),
    occurrence,
  })
  .refine((args) => !(Boolean(args.general) && Boolean(args.quote)), {
    message: "comment takes --general alone, not with --quote",
  })
  .refine((args) => (args.general ? !args.quote : Boolean(args.quote)), {
    message: "comment needs --quote <passage> or --general",
  });
export type CommentArgs = z.infer<typeof CommentArgs>;

/** `db migrate --dry-run`: the flag as given. */
export const MigrateArgs = z.object({ dry: z.boolean().optional() });
export type MigrateArgs = z.infer<typeof MigrateArgs>;
