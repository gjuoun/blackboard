import { Effect } from "effect";
import { CommentsStore } from "@/lib/comments-store";
import { DocumentsRepo } from "@/lib/db/repos/documents";
import { AppLayer } from "@/lib/effect/layers";
import { runtime } from "@/lib/effect/runtime";

/** A comment writer a test process runs against one session, as the CLI does. */
const [home, sessionId, doc, count, tag] = process.argv.slice(2);
const quote = { exact: "The cache is warm.", prefix: "Later text. ", suffix: " End." };
const program = Effect.gen(function* () {
  const docs = yield* DocumentsRepo;
  yield* docs.upsert(home, { id: sessionId, path: doc }).pipe(Effect.ignore);
  const comments = yield* CommentsStore;
  return yield* Effect.forEach(
    Array.from({ length: Number(count) }, (_, i) => i),
    (i) => comments.add(home, sessionId, doc, { quote, body: `${tag}-${i}`, author: "test" }),
    { concurrency: 1 },
  );
});
await runtime.runPromise(program.pipe(Effect.provide(AppLayer)));
