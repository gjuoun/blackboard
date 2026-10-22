import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearState, DEFAULT_URL, formatStatus, pidAlive, portOf, prepareServer, probe, readState, resolveUrl, runtimeFor, ServerError, status, writeState } from "./server-ctl";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "bb-ctl-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("resolveUrl", () => {
  test("defaults to the local app, honours BLACKBOARD_URL and strips a trailing slash", () => {
    expect(resolveUrl({ env: {} })).toBe(DEFAULT_URL);
    expect(resolveUrl({ env: { BLACKBOARD_URL: "http://127.0.0.1:4000/" } })).toBe("http://127.0.0.1:4000");
  });
  test("--port overrides the port and pins the host to this machine", () => {
    expect(resolveUrl({ port: 4100, env: { BLACKBOARD_URL: "https://notes.example.com" } })).toBe("http://127.0.0.1:4100");
  });
  test("rejects a port that is not a port", () => {
    expect(() => resolveUrl({ port: "abc", env: {} })).toThrow(ServerError);
    expect(() => resolveUrl({ port: 70000, env: {} })).toThrow(ServerError);
  });
  test("portOf reads the port, with the scheme's default", () => {
    expect(portOf("http://127.0.0.1:38770")).toBe(38770);
    expect(portOf("https://x.example")).toBe(443);
  });
});

describe("runtimeFor", () => {
  const exists = (p: string) => p === "/opt/node/bin/node";
  test("a Node process runs the app with itself", () => {
    expect(runtimeFor({ execPath: "/usr/bin/node", pathDirs: [], exists })).toEqual({ cmd: "/usr/bin/node", args: [] });
  });
  test("Bun uses a Node on PATH when there is one", () => {
    expect(runtimeFor({ execPath: "/home/u/.bun/bin/bun", pathDirs: ["/usr/bin", "/opt/node/bin"], exists })).toEqual({ cmd: "/opt/node/bin/node", args: [] });
  });
  test("Bun without Node runs the app itself in Node-compat mode", () => {
    expect(runtimeFor({ execPath: "/home/u/.bun/bin/bun", pathDirs: ["/usr/bin"], exists })).toEqual({ cmd: "/home/u/.bun/bin/bun", args: ["--bun"] });
  });
});

describe("server state", () => {
  test("round-trips, and junk reads as none", () => {
    const home = tmp();
    expect(readState(home)).toBeNull();
    writeState(home, { pid: 123, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" });
    expect(readState(home)).toEqual({ pid: 123, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" });
    clearState(home);
    expect(readState(home)).toBeNull();
  });
  test("pidAlive is true for this process and false for a dead pid", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe("status with a live server", () => {
  test("a Blackboard answering with no state of ours is running but not managed; a stale state is cleared", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => (new URL(req.url).pathname === "/api/health" ? Response.json({ app: "blackboard", version: "x" }) : new Response("no", { status: 404 })) });
    const url = `http://127.0.0.1:${server.port}`;
    try {
      const home = tmp();
      expect(await probe(url)).toBe(true);
      expect(await status(home, url)).toEqual({ running: true, url, managed: false });
      writeState(home, { pid: 2 ** 22 + 12345, url, startedAt: "2026-01-01T00:00:00.000Z" });
      expect(await status(home, url)).toEqual({ running: true, url, managed: false });
      expect(readState(home)).toBeNull();
    } finally {
      server.stop(true);
    }
  });
  test("another server on the port is not a Blackboard", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("<html>hi</html>") });
    try {
      expect(await probe(`http://127.0.0.1:${server.port}`)).toBe(false);
    } finally {
      server.stop(true);
    }
  });
  test("nothing listening reads as not running", async () => {
    const s = await status(tmp(), "http://127.0.0.1:1");
    expect(s.running).toBe(false);
    expect(formatStatus(s)).toBe("not running (http://127.0.0.1:1)");
  });
});

describe("prepareServer", () => {
  const fixture = () => {
    const root = tmp();
    const server = join(root, "server");
    mkdirSync(join(server, "modules", "next"), { recursive: true });
    writeFileSync(join(server, "server.js"), "// app");
    writeFileSync(join(server, "modules", "next", "index.js"), "// next");
    return { server, home: join(root, "home") };
  };
  test("renames modules to node_modules in place, once", () => {
    const { server, home } = fixture();
    expect(prepareServer(server, home, "1.0.0")).toBe(server);
    expect(existsSync(join(server, "node_modules", "next", "index.js"))).toBe(true);
    expect(existsSync(join(server, "modules"))).toBe(false);
    expect(prepareServer(server, home, "1.0.0")).toBe(server);
  });
  test("a read-only package folder runs from a copy under the home folder", () => {
    const { server, home } = fixture();
    const readOnly = (from: string) => {
      if (from.startsWith(server)) throw new Error("EACCES");
    };
    const dir = prepareServer(server, home, "1.0.0", readOnly);
    expect(dir).toBe(join(home, "runtime", "1.0.0"));
    expect(readFileSync(join(dir, "node_modules", "next", "index.js"), "utf8")).toBe("// next");
    expect(existsSync(join(server, "modules", "next"))).toBe(true);
    expect(prepareServer(server, home, "1.0.0", readOnly)).toBe(dir);
  });
});
