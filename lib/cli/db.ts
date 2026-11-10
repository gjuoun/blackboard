import { Effect } from "effect";
import { cliFailure, CliError } from "../cli";
import { migrate, stats, type MigrateReport } from "../db/migrate";
import { Db } from "../db/client";
import { Lock } from "../lock";

/** The db subcommand's services. */
type Needs = Db | Lock;

/** What a migrate run reports, as plain CLI output. */
const formatReport = (r: MigrateReport): string => {
  if (r.nothing) return "nothing to migrate";
  const counts = `${r.documents} documents, ${r.comments} comments, ${r.reviews} reviews, ${r.readingState} reading_state, ${r.agents} agents`;
  if (r.dry) return `would migrate: ${counts}`;
  return `migrated: ${counts} (${r.renamed.length} source files renamed to .migrated)`;
};

/** `db migrate [--dry-run]`: move the JSON stores into blackboard.db. */
export function migrateCmd(home: string, dry: boolean): Effect.Effect<MigrateReport, CliError, Needs> {
  return migrate(home, { dry }).pipe(Effect.mapError((e) => cliFailure(e)));
}

/** `db stats`: row counts per table plus the file. */
export function statsCmd(home: string): Effect.Effect<{ path: string; tables: Record<string, number>; bytes: number }, CliError, Needs> {
  return stats(home).pipe(Effect.mapError((e) => cliFailure(e)));
}

/** `db` usage when the sub-arg is missing or unknown. */
export const dbUsage = (): CliError =>
  new CliError({ message: "usage: blackboard db migrate [--dry-run] | stats", code: 2 });

/** Format a stats result for the terminal. */
export const formatStats = (s: { path: string; tables: Record<string, number>; bytes: number }): string =>
  [`${s.path} (${s.bytes} bytes)`, ...Object.entries(s.tables).map(([t, n]) => `  ${t}: ${n}`)].join("\n");

export { formatReport };
