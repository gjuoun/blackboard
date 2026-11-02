import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Result } from "effect";
import type { CliError } from "../cli";
import { BlockArgs, CommentArgs, decodeArgs, HeaderArgs, OpenArgs, ReviewArgs } from "./args";

/** The refusal a decode ends with, so a test asserts the message and code the CLI prints. */
async function refusal<A>(effect: Effect.Effect<A, CliError>): Promise<{ message: string; code: number }> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error(`expected a refusal, decoded ${JSON.stringify(exit.value)}`);
  const found = Cause.findError(exit.cause);
  if (Result.isFailure(found)) throw new Error("expected a typed failure, not a defect");
  return { message: found.success.message, code: found.success.code };
}

describe("the option records", () => {
  test("open: --kind is plain or stream", async () => {
    expect(await refusal(decodeArgs(OpenArgs, { kind: "cloud" }))).toEqual({ message: '--kind takes "plain" or "stream"', code: 2 });
    expect(await Effect.runPromise(decodeArgs(OpenArgs, { kind: "stream" }))).toEqual({ kind: "stream" });
    expect(await Effect.runPromise(decodeArgs(OpenArgs, {}))).toEqual({});
  });

  test("header: --title is required", async () => {
    expect(await refusal(decodeArgs(HeaderArgs, { owner: "jun" }))).toEqual({ message: "header needs --title <title>", code: 2 });
    expect(await Effect.runPromise(decodeArgs(HeaderArgs, { title: "Log", owner: "jun" }))).toEqual({ title: "Log", owner: "jun" });
  });

  test("block: --status is writing or absent", async () => {
    expect(await refusal(decodeArgs(BlockArgs, { status: "draft" }))).toEqual({ message: '--status takes "writing"', code: 2 });
    expect(await Effect.runPromise(decodeArgs(BlockArgs, { status: "writing" }))).toEqual({ status: "writing" });
  });

  test("comment: an empty --occurrence is not given, so the first match", async () => {
    const empty = await Effect.runPromise(decodeArgs(CommentArgs, { quote: "Later text.", occurrence: "" }));
    expect(empty.occurrence).toBeUndefined();
    expect(empty.occurrence ?? 1).toBe(1);
    expect(await refusal(decodeArgs(CommentArgs, { quote: "Later text.", occurrence: "abc" }))).toEqual({
      message: "--occurrence must be a whole number",
      code: 2,
    });
  });

  test("comment: exactly one anchor, and a whole --occurrence", async () => {
    const both = { message: "comment takes --general alone, not with --quote", code: 2 };
    const neither = { message: "comment needs --quote <passage> or --general", code: 2 };
    expect(await refusal(decodeArgs(CommentArgs, { general: true, quote: "Later text." }))).toEqual(both);
    expect(await refusal(decodeArgs(CommentArgs, {}))).toEqual(neither);
    expect(await refusal(decodeArgs(CommentArgs, { quote: "" }))).toEqual(neither);
    expect(await refusal(decodeArgs(CommentArgs, { quote: "x", occurrence: "1.5" }))).toEqual({ message: "--occurrence must be a whole number", code: 2 });
    expect(await Effect.runPromise(decodeArgs(CommentArgs, { quote: "Later text.", occurrence: "2" }))).toEqual({ quote: "Later text.", occurrence: 2 });
    expect(await Effect.runPromise(decodeArgs(CommentArgs, { general: true }))).toEqual({ general: true });
  });

  test("review: --round is a whole number from 1", async () => {
    const refusalText = { message: "--round must be a whole number from 1", code: 2 };
    expect(await refusal(decodeArgs(ReviewArgs, {}))).toEqual(refusalText);
    expect(await refusal(decodeArgs(ReviewArgs, { round: "x" }))).toEqual(refusalText);
    expect(await refusal(decodeArgs(ReviewArgs, { round: "0" }))).toEqual(refusalText);
    expect(await refusal(decodeArgs(ReviewArgs, { round: "1.5" }))).toEqual(refusalText);
    expect(await Effect.runPromise(decodeArgs(ReviewArgs, { round: "2" }))).toEqual({ round: 2 });
  });
});
