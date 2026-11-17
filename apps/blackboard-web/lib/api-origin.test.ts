import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiOrigin, apiTarget, apiUrl, appOrigin } from "./api-origin";

const home = () => mkdtempSync(join(tmpdir(), "bb-origin-"));
const proc = (url: string) => ({ pid: 4242, url, startedAt: "2026-01-01T00:00:00.000Z" });
const record = (h: string, body: unknown) =>
  writeFileSync(join(h, "server.json"), JSON.stringify(body) + "\n");

afterEach(() => {
  delete process.env.BLACKBOARD_API_URL;
  delete process.env.BLACKBOARD_URL;
});

describe("apiTarget: one resolver, three answers", () => {
  test("the env var wins over the record, and a trailing slash is trimmed", () => {
    const h = home();
    record(h, { ui: proc("http://127.0.0.1:4100") });
    process.env.BLACKBOARD_API_URL = "http://127.0.0.1:4200/";
    expect(apiTarget(h)).toEqual({ url: "http://127.0.0.1:4200", source: "env" });
    expect(apiUrl(h)).toBe("http://127.0.0.1:4200");
  });

  test("a two-process record names the API; a one-process record means the app's own port", () => {
    const two = home();
    record(two, { ui: proc("http://127.0.0.1:4100"), api: proc("http://127.0.0.1:4101") });
    expect(apiTarget(two)).toEqual({ url: "http://127.0.0.1:4101", source: "record" });

    const one = home();
    record(one, { ui: proc("http://127.0.0.1:4100") });
    expect(apiTarget(one)).toEqual({ url: "http://127.0.0.1:4100", source: "record" });
  });

  test("nothing recorded answers null, and only apiOrigin falls back to the app's own port", () => {
    const h = home();
    expect(apiTarget(h)).toEqual({ url: null, source: "none" });
    expect(apiUrl(h)).toBeNull();
    expect(apiOrigin(h)).toBe("http://127.0.0.1:38770");
    process.env.BLACKBOARD_URL = "http://127.0.0.1:4300/";
    expect(appOrigin()).toBe("http://127.0.0.1:4300");
    expect(apiOrigin(h)).toBe("http://127.0.0.1:4300");
  });
});
