import { Layer } from "effect";
import { layer as fileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { layer as agentsLayer } from "../agents-store";
import { layer as busLayer } from "../change-bus";
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
 * Everything the server builds once: the SQLite data layer, the repos, the repo-backed stores
 * (sessions, comments, agents, reading state) and the platform file system. The JSON-era stores
 * are gone — `lib/json-sources.ts` serves the migration only. `Db` defers `bun:sqlite` to first
 * use, so a Node-hosted `next build` can still trace this module without resolving `bun:`.
 */
const db = dbLayer;
const documents = documentsRepoLayer.pipe(Layer.provideMerge(db));
const comments = commentsRepoLayer.pipe(Layer.provideMerge(db));
const agents = agentsRepoLayer.pipe(Layer.provideMerge(db));
const reading = readingRepoLayer.pipe(Layer.provideMerge(db));
const commentsStore = commentsLayer.pipe(Layer.provideMerge(Layer.mergeAll(comments, busLayer)));
const sessions = sessionsLayer.pipe(Layer.provideMerge(Layer.mergeAll(db, documents, commentsStore)));
const agentsStore = agentsLayer.pipe(Layer.provideMerge(agents));
const readingStore = readingLayer.pipe(Layer.provideMerge(reading));

export const AppLayer = Layer.mergeAll(lockLayer, db, busLayer, documents, comments, agents, reading, commentsStore, sessions, agentsStore, readingStore, fileSystemLayer);

/** The services AppLayer provides; a program that needs them is runnable by the runtime below. */
export type AppServices = Layer.Success<typeof AppLayer>;
