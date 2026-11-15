/**
 * The API process layer is the app layer: since the stores moved onto the SQLite repos there is
 * one service composition again — Db + repos + repo-backed stores + the file lock + the
 * platform file system. The JSON stores exist nowhere in it; `lib/json-sources.ts` serves the
 * migration only. `Db` defers `bun:sqlite` to first use, so a Node `next build` can trace the
 * module without resolving `bun:`.
 */
export { AppLayer as ApiLayer } from "./layers";
export type { AppServices as ApiServices } from "./layers";
