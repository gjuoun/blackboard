import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../test/app";
import { readImage, saveImage } from "./comment-image-store";

/** A 1x1 png: the same bytes the upload routes answer with. */
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** A temp Blackboard home; the store writes under <home>/comment-images. */
const fresh = () => mkdtempSync(join(tmpdir(), "bb-image-"));

describe("the comment image store", () => {
  test("stores an image under its content hash and reads the same bytes back", async () => {
    const home = fresh();
    const stored = await run(saveImage(home, PNG));
    expect(stored.id).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(stored.mime).toBe("image/png");
    expect(readFileSync(join(home, "comment-images", stored.id))).toEqual(Buffer.from(PNG));

    const back = await run(readImage(home, stored.id));
    expect(back).not.toBeNull();
    expect(Buffer.from(back!)).toEqual(Buffer.from(PNG));
  });

  test("the same bytes are stored once, and the second upload does not rewrite the file", async () => {
    const home = fresh();
    const first = await run(saveImage(home, PNG));
    const path = join(home, "comment-images", first.id);
    const stamp = statSync(path).mtimeMs;
    await Bun.sleep(10);

    const second = await run(saveImage(home, PNG));
    expect(second.id).toBe(first.id);
    expect(statSync(path).mtimeMs).toBe(stamp);
  });

  test("refuses bytes that are not a png, jpeg, gif or webp", async () => {
    const home = fresh();
    const exit = await run(Effect.exit(saveImage(home, new TextEncoder().encode("not an image"))));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("not a png, jpeg, gif or webp image");
    }
  });

  test("an id that is not a stored image name, or names no file, reads as null", async () => {
    const home = fresh();
    expect(await run(readImage(home, "../etc/passwd"))).toBeNull();
    expect(await run(readImage(home, `${"0".repeat(64)}.png`))).toBeNull();
  });
});
