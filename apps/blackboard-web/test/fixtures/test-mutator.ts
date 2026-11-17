import { Runtime, Safe } from "@gjuoun/safe-ts";
import { bootstrap } from "@/lib/bootstrap";

/** A comment writer a test process runs against one session, as the CLI does. */
const [home, sessionId, doc, count, tag] = process.argv.slice(2);
const quote = { exact: "The cache is warm.", prefix: "Later text. ", suffix: " End." };
const services = bootstrap();

const program = Safe.try(function* () {
  yield services.documents.upsert(home, { id: sessionId, path: doc });
  const written = [];
  for (let i = 0; i < Number(count); i++) {
    written.push(
      yield services.comments.add(home, sessionId, doc, { quote, body: `${tag}-${i}`, author: "test" }),
    );
  }
  return written;
}) as unknown as Safe<unknown, unknown>;

await Runtime.run(program);
