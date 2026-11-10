import { Effect } from "effect";
import { apiPost, apiUrl } from "../api-client";
import { cliFailure, CliError, find } from "../cli";
import { layer as dbLayer } from "../db/client";
import { StreamsStore, layer as streamsLayer } from "../stream-store";
import type { Session } from "../session-model";
import { SessionsStore } from "../sessions";
import { sessionUrl } from "./sessions";

/** Where a block lands in the page: the session URL with the block anchor. */
export const blockUrl = (id: string, block: string) => `${sessionUrl(id)}#${block}`;

/** Offline is allowed only under Bun, and only when this home records no API. */
const offlineOk = (home: string): boolean => process.versions.bun !== undefined && apiUrl(home) === null;

/**
 * Stream commands prefer the running API; under Bun with no recorded API they write the home's
 * database directly (the local lane carries the two layers a store needs and nothing else).
 */
function route<A>(
  home: string,
  api: Effect.Effect<A, import("../api-client").ApiFailure>,
  local: Effect.Effect<A, CliError, SessionsStore | StreamsStore>,
): Effect.Effect<A, CliError, SessionsStore | StreamsStore> {
  return api.pipe(
    Effect.catch((e): Effect.Effect<A, CliError, SessionsStore | StreamsStore> => {
      if (e._tag === "ApiUnreachable" && offlineOk(home)) return local;
      return Effect.fail(new CliError({ message: e.message, code: 1 }));
    }),
  );
}

/** The local lane's requirements, provided at the call site (dbLayer evaluates bun:sqlite lazily — Bun only). */
const provide = <A, E>(effect: Effect.Effect<A, E, SessionsStore | StreamsStore>) =>
  effect.pipe(
    Effect.provide(streamsLayer),
    Effect.provide(dbLayer),
  );

/** The resolved session must be a streamed doc — the file sessions answer this refusal. */
function requireStream(session: Session): Effect.Effect<void, CliError> {
  return session.kind === "stream"
    ? Effect.void
    : Effect.fail(new CliError({ message: `${session.id} is not a stream (create one with: blackboard stream <title>)`, code: 2 }));
}

export function stream(home: string, title: string): Effect.Effect<{ session: Session; url: string }, CliError, SessionsStore | StreamsStore> {
  return Effect.gen(function* () {
    const api = apiPost(home, "/api/stream", { title }).pipe(Effect.map((d) => (d as { session: Session }).session));
    const local = provide(Effect.gen(function* () {
      const store = yield* StreamsStore;
      return yield* store.create(home, title).pipe(Effect.mapError((error) => cliFailure(error)));
    }));
    const session = yield* route(home, api, local);
    return { session, url: sessionUrl(session.id) };
  });
}

export function appendBlock(
  home: string,
  ref: string,
  input: { action: string; text: string; author: string; images?: string[]; status?: "writing" },
): Effect.Effect<{ id: string; n: number; session: string; url: string }, CliError, SessionsStore | StreamsStore> {
  return Effect.gen(function* () {
    const { session } = yield* find(home, ref);
    yield* requireStream(session);
    if (!input.text.trim()) return yield* new CliError({ message: "block text is empty", code: 2 });
    const api = apiPost(home, "/api/block", {
      session: session.id, action: input.action, body: input.text, author: input.author, images: input.images, status: input.status,
    }).pipe(Effect.map((d) => (d as { block: { id: string; n: number } }).block));
    const local = provide(Effect.gen(function* () {
      const store = yield* StreamsStore;
      const b = yield* store.append(home, session.id, {
        action: input.action as "answer" | "edit" | "append",
        body: input.text, author: input.author, images: input.images, status: input.status,
      }).pipe(Effect.mapError((error) => cliFailure(error)));
      return { id: b.id, n: b.n };
    }));
    const b = yield* route(home, api, local);
    return { id: b.id, n: b.n, session: session.id, url: blockUrl(session.id, b.id) };
  });
}

export function editBlock(
  home: string,
  ref: string,
  blockId: string,
  text: string,
  status?: "writing",
): Effect.Effect<{ id: string; n: number; session: string; url: string }, CliError, SessionsStore | StreamsStore> {
  return Effect.gen(function* () {
    const { session } = yield* find(home, ref);
    yield* requireStream(session);
    if (!text.trim()) return yield* new CliError({ message: "block text is empty", code: 2 });
    const api = apiPost(home, "/api/block", { session: session.id, edit: blockId, body: text, author: "agent", status }).pipe(
      Effect.map((d) => (d as { block: { id: string; n: number } }).block),
    );
    const local = provide(Effect.gen(function* () {
      const store = yield* StreamsStore;
      const b = yield* store.edit(home, session.id, blockId, text, status).pipe(Effect.mapError((error) => cliFailure(error, 2)));
      return { id: b.id, n: b.n };
    }));
    const b = yield* route(home, api, local);
    return { id: b.id, n: b.n, session: session.id, url: blockUrl(session.id, b.id) };
  });
}

export type HeaderData = { id: string; title: string | null; owner: string | null; createdAt: string; blocks: number; writing: boolean };

export function header(
  home: string,
  ref: string,
  input: { title?: string; owner?: string },
): Effect.Effect<HeaderData, CliError, SessionsStore | StreamsStore> {
  return Effect.gen(function* () {
    const { session } = yield* find(home, ref);
    yield* requireStream(session);
    if (input.owner !== undefined) {
      return yield* new CliError({ message: "owner is the first block's author", code: 2 });
    }
    if (input.title !== undefined && !input.title.trim()) {
      return yield* new CliError({ message: "header needs a non-empty --title", code: 2 });
    }
    // Header has no api endpoint: it is a read the local database answers. Under Bun any home
    // with a database can serve it; a Node CLI needs the api, which does not carry this route.
    if (process.versions.bun === undefined) {
      return yield* new CliError({ message: "header reads the local database — run it under bun", code: 1 });
    }
    return yield* provide(Effect.gen(function* () {
      const store = yield* StreamsStore;
      if (input.title !== undefined) yield* store.setTitle(home, session.id, input.title).pipe(Effect.mapError((error) => cliFailure(error)));
      return yield* store.header(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
    }));
  });
}

export function exportBlocks(home: string, ref: string): Effect.Effect<string, CliError, SessionsStore | StreamsStore> {
  return Effect.gen(function* () {
    const { session } = yield* find(home, ref);
    yield* requireStream(session);
    return yield* provide(Effect.gen(function* () {
      const store = yield* StreamsStore;
      return yield* store.export(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
    }));
  });
}

/** The one-line header report, same compact style as `sessions`. */
export function formatHeader(h: HeaderData): string {
  const writing = h.writing ? "  writing" : "";
  return `${h.id}  ${h.title ?? "(untitled)"}  by ${h.owner ?? "(no owner)"}  created ${h.createdAt}  ${h.blocks} blocks${writing}`;
}
