import { Layer } from "effect";
import { layer as fileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { layer as agentsLayer } from "../agents-store";
import { layer as commentsLayer } from "../comments-store";
import { layer as dbLayer } from "../db/client";
import { layer as agentsRepoLayer } from "../db/repos/agents";
import { layer as commentsRepoLayer } from "../db/repos/comments";
import { layer as documentsRepoLayer } from "../db/repos/documents";
import { layer as readingRepoLayer } from "../db/repos/reading-state";
import { layer as readingLayer } from "../reading-state";
import { layer as lockLayer } from "../lock";
import { layer as sessionsLayer } from "../sessions";

/**
 * The API process layer: the SQLite data layer, the repos and the repo-backed stores — sessions,
 * comments, agents and reading state — plus the file lock and the platform file system. The
 * JSON stores are deliberately absent; `lib/json-sources.ts` serves the migration only. `Db`
 * defers `bun:sqlite` to first use, so a Node `next build` can trace this module without
 * resolving `bun:`. Same composition as AppLayer, named separately so a route and a test can
 * tell which runtime they are building.
 */
const db = dbLayer;
const documents = documentsRepoLayer.pipe(Layer.provideMerge(db));
const comments = commentsRepoLayer.pipe(Layer.provideMerge(db));
const agents = agentsRepoLayer.pipe(Layer.provideMerge(db));
const reading = readingRepoLayer.pipe(Layer.provideMerge(db));
const commentsStore = commentsLayer.pipe(Layer.provideMerge(comments));
const sessions = sessionsLayer.pipe(Layer.provideMerge(Layer.mergeAll(documents, commentsStore)));
const agentsStore = agentsLayer.pipe(Layer.provideMerge(agents));
const readingStore = readingLayer.pipe(Layer.provideMerge(reading));

export const ApiLayer = Layer.mergeAll(lockLayer, db, documents, comments, agents, reading, commentsStore, sessions, agentsStore, readingStore, fileSystemLayer);

/** The services ApiLayer provides; a program that needs them is runnable by the API runtime. */
export type ApiServices = Layer.Success<typeof ApiLayer>;
