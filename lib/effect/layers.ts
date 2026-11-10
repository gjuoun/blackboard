import { Layer } from "effect";
import { layer as fileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { layer as agentsLayer } from "../agents-store";
import { layer as commentsLayer } from "../comments-store";
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
// The SQLite data layer (`Db` + repos) is deliberately NOT in AppLayer: nothing in app/ reads
// it this round, and evaluating it under the Node-spawned `next build` page collection would
// load `bun:sqlite`. The CLI provides `Db` locally for `db migrate`/`db stats` instead; the
// repos join AppLayer in the round that actually serves routes from SQLite.

/**
 * Everything the server builds once: the file lock, the comment store, the session registry, the
 * reading state and the platform's file system. One instance of each, composed here and nowhere else.
 */
export const AppLayer = Layer.mergeAll(sessions, agents, reading, fileSystemLayer);

/** The services AppLayer provides; a program that needs them is runnable by the runtime below. */
export type AppServices = Layer.Success<typeof AppLayer>;