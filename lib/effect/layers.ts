import { Layer } from "effect";
import { layer as fileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { layer as agentsLayer } from "../agents-store";
import { layer as commentsLayer } from "../comments-store";
import { layer as dbLayer } from "../db/client";
import { layer as agentsRepoLayer } from "../db/repos/agents";
import { layer as blocksRepoLayer } from "../db/repos/blocks";
import { layer as commentsRepoLayer } from "../db/repos/comments";
import { layer as documentsRepoLayer } from "../db/repos/documents";
import { layer as readingRepoLayer } from "../db/repos/reading-state";
import { layer as lockLayer } from "../lock";
import { layer as readingLayer } from "../reading-state";
import { layer as sessionsLayer } from "../sessions";

/** The lock with nothing above it. */
const lock = lockLayer;
/** The comment file store: the one store every other store waits on. */
const comments = commentsLayer.pipe(Layer.provideMerge(lock));
/** The registry, which reads its open-comment counts through the comment store. */
const sessions = sessionsLayer.pipe(Layer.provideMerge(comments));
/** The doc-to-pi-session bindings, on the same lock. */
const agents = agentsLayer.pipe(Layer.provideMerge(lock));
/** The reading workspace's state file, on the same lock. */
const reading = readingLayer.pipe(Layer.provideMerge(lock));
/** The SQLite data layer: the handle, then the five repositories over it. */
const db = dbLayer;
const repos = Layer.mergeAll(documentsRepoLayer, blocksRepoLayer, commentsRepoLayer, readingRepoLayer, agentsRepoLayer).pipe(Layer.provideMerge(db));

/**
 * Everything the server builds once: the file lock, the comment store, the session registry, the
 * reading state and the platform's file system. One instance of each, composed here and nowhere else.
 */
export const AppLayer = Layer.mergeAll(sessions, agents, reading, fileSystemLayer, db, repos);

/** The services AppLayer provides; a program that needs them is runnable by the runtime below. */
export type AppServices = Layer.Success<typeof AppLayer>;