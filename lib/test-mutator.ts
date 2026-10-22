// Child process for the multi-process test: adds N comments to one comment file through mutate.
import { addComment, mutate } from "./comments-store";

const [file, count, tag] = process.argv.slice(2);
const quote = { exact: "x", prefix: "", suffix: "" };
await Promise.all(
  Array.from({ length: Number(count) }, (_, i) => mutate(file, (f) => addComment(f, "design.md", { quote, body: `${tag}-${i}`, author: "test" }))),
);
