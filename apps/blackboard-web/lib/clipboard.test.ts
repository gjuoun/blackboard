import { afterEach, describe, expect, test } from "bun:test";
import { copyText } from "./clipboard";

type Stubs = { secure: boolean; writeText?: (t: string) => Promise<void> };
const g = globalThis as unknown as Record<string, unknown>;

/** Install just enough window/navigator/document for copyText; returns what it recorded. */
function stub({ secure, writeText }: Stubs) {
  const written: string[] = [];
  const copied: { value: string; command?: string }[] = [];
  const area = { value: "", style: {} as Record<string, string>, setAttribute() {}, select() {}, setSelectionRange() {} };
  g.window = { isSecureContext: secure };
  g.navigator = { clipboard: writeText ? { writeText: async (t: string) => { written.push(t); await writeText(t); } } : undefined };
  g.document = {
    getSelection: () => null,
    createElement: () => area,
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: (command: string) => { copied.push({ value: area.value, command }); return true; },
  };
  return { written, copied };
}

afterEach(() => {
  delete g.window;
  delete g.navigator;
  delete g.document;
});

describe("copyText", () => {
  test("secure context uses the async Clipboard API with the exact string", async () => {
    const { written, copied } = stub({ secure: true, writeText: async () => {} });
    expect(await copyText("/a/b/colors-pipeline.md")).toBe(true);
    expect(written).toEqual(["/a/b/colors-pipeline.md"]);
    expect(copied).toEqual([]);
  });

  test("a refused Clipboard API call falls back to textarea + execCommand", async () => {
    const { written, copied } = stub({ secure: true, writeText: async () => { throw new Error("not focused"); } });
    expect(await copyText("feat/colors")).toBe(true);
    expect(written).toEqual(["feat/colors"]);
    expect(copied).toEqual([{ value: "feat/colors", command: "copy" }]);
  });

  test("non-secure context skips the Clipboard API", async () => {
    const { written, copied } = stub({ secure: false, writeText: async () => {} });
    expect(await copyText("/x/worktree")).toBe(true);
    expect(written).toEqual([]);
    expect(copied).toEqual([{ value: "/x/worktree", command: "copy" }]);
  });
});
