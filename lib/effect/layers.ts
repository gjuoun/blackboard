import { Layer } from "effect";
import { layer as fileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { layer as agentsLayer } from "../agents-store";
import { layer as commentsLayer } from "../comments-store";
import { layer as lockLayer } from "../lock";
import { layer as sessionsLayer } from "../sessions";

/** The lock with nothing above it. */
const lock = lockLayer;
/** The comment file store: the one store every other store waits on. */
const comments = commentsLayer.pipe(Layer.provideMerge(lock));
/** The registry, which reads its open-comment counts through the comment store. */
const sessions = sessionsLayer.pipe(Layer.provideMerge(comments));
/** The doc-to-pi-session bindings, on the same lock. */
const agents = agentsLayer.pipe(Layer.provideMerge(lock));

/**
 * Everything the server builds once: the file lock, the comment store, the session registry and
 * the platform's file system. One instance of each, composed here and nowhere else.
 */
export const AppLayer = Layer.mergeAll(sessions, agents, fileSystemLayer);

/** The services AppLayer provides; a program that needs them is runnable by the runtime below. */
export type AppServices = Layer.Success<typeof AppLayer>;