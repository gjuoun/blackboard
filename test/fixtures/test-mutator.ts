import { Effect } from "effect";
import { addComment, CommentsStore } from "@/lib/comments-store";
import { AppLayer } from "@/lib/effect/layers";
import { runtime } from "@/lib/effect/runtime";

/**: A comment writer a test process runs against one file, as the CLI does. */
const [file, count, tag] = process.argv.slice(2);
const quote = { exact: "The cache is warm.", prefix: "Later text. ", suffix: " End." };
const program = Effect.forEach(
  Array.from({ length: Number(count) }, (_, i) => i),
  (i) =>
    Effect.gen(function* () {
      const comments = yield* CommentsStore;
      return yield* comments.mutate(file, (f) => addComment(f, "design.md", { quote, body: `${tag}-${i}`, author: "test" }));
    }),
  { concurrency: 1 },
);
await runtime.runPromise(program.pipe(Effect.provide(AppLayer)));