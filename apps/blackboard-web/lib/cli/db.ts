import { Pipe, Safe } from "@gjuoun/safe-ts";
import { type CliError, cliFailure } from "../cli";
import type { Db } from "../db/client";
import type { MigrateReport, Migrations } from "../db/migrate";
import { type IndexReport, indexDocuments } from "../doc-index-run";

/** What a migrate run reports, as plain CLI output. */
const formatReport = (r: MigrateReport): string => {
  if (r.nothing) return "nothing to migrate";
  const counts = `${r.documents} documents, ${r.comments} comments, ${r.readingState} reading_state, ${r.agents} agents`;
  if (r.dry) return `would migrate: ${counts}`;
  return `migrated: ${counts} (${r.renamed.length} source files renamed to .migrated)`;
};

/** `db migrate [--dry-run]`: move the JSON stores into blackboard.db. */
export function migrateCmd(
  migrations: Migrations,
  home: string,
  dry: boolean,
): Safe<MigrateReport, CliError> {
  return Safe.pipe(
    migrations.migrate(home, { dry }),
    Pipe.catchTag("IoFailure", (e: { message: string }) => Safe.err(cliFailure(e))),
    Pipe.catchTag("LockTimeout", (e: { message: string }) => Safe.err(cliFailure(e))),
    Pipe.catchTag("DbFailure", (e: { message: string }) => Safe.err(cliFailure(e))),
  ) as unknown as Safe<MigrateReport, CliError>;
}

/** `db stats`: row counts per table plus the file. */
export function statsCmd(
  migrations: Migrations,
  home: string,
): Safe<{ path: string; tables: Record<string, number>; bytes: number }, CliError> {
  return Safe.pipe(
    migrations.stats(home),
    Pipe.catchTag("DbFailure", (e: { message: string }) => Safe.err(cliFailure(e))),
  ) as unknown as Safe<{ path: string; tables: Record<string, number>; bytes: number }, CliError>;
}

/** `db` usage when the sub-arg is missing or unknown. */
export const dbUsage = (): CliError => ({
  CliError: { message: "usage: blackboard db migrate [--dry-run] | stats | reindex [--force]", code: 2 },
});

/** Format a stats result for the terminal. */
export const formatStats = (s: { path: string; tables: Record<string, number>; bytes: number }): string =>
  [`${s.path} (${s.bytes} bytes)`, ...Object.entries(s.tables).map(([t, n]) => `  ${t}: ${n}`)].join("\n");

/** `db reindex [--force]`: bring every open document's row up to its file. Idempotent; --force re-reads them all. */
export function reindexCmd(db: Db, home: string, force: boolean): Safe<IndexReport, CliError> {
  return Safe.pipe(
    indexDocuments(db, home, force),
    Pipe.catchTag("IoFailure", (e: { message: string }) => Safe.err(cliFailure(e))),
    Pipe.catchTag("DbFailure", (e: { message: string }) => Safe.err(cliFailure(e))),
  ) as unknown as Safe<IndexReport, CliError>;
}

export const formatIndex = (r: IndexReport): string =>
  `indexed: ${r.updated} updated, ${r.skipped} current, ${r.missing} missing, ${r.gitCommands} git commands`;

export { cliFailure, formatReport };
