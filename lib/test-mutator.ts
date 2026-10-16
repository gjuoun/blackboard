// Child process for the multi-process test: adds N comments to a board through mutate.
import { addComment, commentsPath, mutate } from "./comments-store";

const [boardDir, count, tag] = process.argv.slice(2);
const quote = { exact: "x", prefix: "", suffix: "" };
await Promise.all(
  Array.from({ length: Number(count) }, (_, i) => mutate(commentsPath(boardDir), (f) => addComment(f, "design.md", { quote, body: `${tag}-${i}`, author: "test" }))),
);
