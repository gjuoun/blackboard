import { describe, expect, test } from "bun:test";
import { Runtime, type Safe } from "@gjuoun/safe-ts";
import { run } from "../../test/app";
import type { CliError } from "../cli";
import { CommentArgs, decodeArgs } from "./args";

/** The refusal a decode ends with, so a test asserts the message and code the CLI prints. */
async function refusal<A>(safe: Safe<A, CliError>): Promise<{ message: string; code: number }> {
  const outcome = await Runtime.run(safe);
  if (outcome._tag === "success")
    throw new Error("expected a refusal, decoded " + JSON.stringify(outcome.value));
  if (outcome._tag !== "fail") throw new Error("expected a typed failure, not a defect");
  const failure = (outcome.error as CliError).CliError;
  return { message: failure.message, code: failure.code };
}

describe("the option records", () => {
  test("comment: an empty --occurrence is not given, so the first match", async () => {
    const empty = await run(decodeArgs(CommentArgs, { quote: "Later text.", occurrence: "" }));
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
    expect(await refusal(decodeArgs(CommentArgs, { quote: "x", occurrence: "1.5" }))).toEqual({
      message: "--occurrence must be a whole number",
      code: 2,
    });
    const whole = (await run(decodeArgs(CommentArgs, { quote: "Later text.", occurrence: "2" }))) as {
      quote?: string;
      occurrence?: number;
    };
    expect(whole.quote).toBe("Later text.");
    expect(whole.occurrence).toBe(2);
    const general = (await run(decodeArgs(CommentArgs, { general: true }))) as { general?: boolean };
    expect(general.general).toBe(true);
  });
});
