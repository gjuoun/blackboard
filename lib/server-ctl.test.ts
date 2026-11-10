import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clearState, DEFAULT_API_URL, DEFAULT_URL, pidAlive, portOf, prepareServer, readState, resolveApiUrl, resolveUrl, restart, runForeground, runtimeFor, ServerError, stop, unrecordedNote, verifyRecord, writeState } from "./server-ctl";
import { bigHome, slowServer, tmp } from "../test/serve-fixture";

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
  test("round-trips a two-proc record, junk reads as none, and the old single-pid shape reads as legacy", () => {
    const home = tmp();
    expect(readState(home)).toBeNull();
    const proc = { pid: 123, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" };
    writeState(home, { ui: proc, api: { ...proc, pid: 124, url: "http://127.0.0.1:2" } });
    const st = readState(home);
    expect(st && "ui" in st && st.ui.pid).toBe(123);
    expect(st && "api" in st && st.api.pid).toBe(124);
    // the pre-split single-pid file is a marked legacy record: the pid it names is ours to stop
    writeFileSync(join(home, "server.json"), JSON.stringify({ pid: 123, url: "http://127.0.0.1:1", startedAt: "x" }));
    const legacy = readState(home);
    expect(legacy).toEqual({ legacy: { pid: 123, url: "http://127.0.0.1:1", startedAt: "x" } });
    writeFileSync(join(home, "server.json"), "not json");
    expect(readState(home)).toBeNull();
    clearState(home);
    expect(readState(home)).toBeNull();
  });
  test("pidAlive is true for this process and false for a dead pid", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 12345)).toBe(false);
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

describe("a large home: stop clears a dead record", () => {
  test("a stop with both recorded pids gone clears the record, and does not call the port a stranger's", async () => {
    const home = bigHome();
    const dead = { pid: 2 ** 22 + 12345, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" };
    writeState(home, { ui: dead, api: dead });
    const r = await stop(home);
    // The record existed, so stop cleared it; it never reaches the "not started by this command" note.
    expect(r).toEqual({ stopped: true });
    expect(readState(home)).toBeNull();
  }, 20_000);
});

describe("serve restart: the stopped pair must really be gone", () => {
  // The defect: `serve restart` printed "restarted" while the old pair still listened — stop's
  // result was ignored and start's "already running" (a foreign listener) was read as success.
  test("restart refuses when nothing is recorded but a Blackboard still answers", async () => {
    const server = slowServer(0);
    const url = `http://127.0.0.1:${server.port}`;
    try {
      const home = tmp();
      // No server.json (a stale single-pid record reads as none); the pair is still up.
      await expect(
        restart(home, { port: server.port, apiPort: 1 }, {
          start: async () => ({ running: true, url, managed: false, started: false }),
        }),
      ).rejects.toThrow(/not stopped|already|not started by this command/);
    } finally {
      server.stop(true);
    }
  });

  test("stop does not call it stopped while a recorded port still listens", async () => {
    const foreign = slowServer(0);
    const url = `http://127.0.0.1:${foreign.port}`;
    try {
      const home = tmp();
      const dead = { pid: 2 ** 22 + 12345, url, startedAt: "2026-01-01T00:00:00.000Z" };
      writeState(home, { ui: dead, api: { ...dead, pid: dead.pid + 1, url: "http://127.0.0.1:1" } });
      const r = await stop(home);
      // The recorded pids are gone, but the ui port still answers: someone else holds it, and a
      // "stopped" here is exactly how restart used to lose the old pair.
      expect(r.stopped).toBe(false);
    } finally {
      foreign.stop(true);
    }
  }, 20_000);

  test("restart refuses when start finds the port already taken", async () => {
    const home = tmp();
    const url = "http://127.0.0.1:1";
    // The recorded pair stopped cleanly; a different process then grabbed the port, so start
    // reports an unmanaged running pair instead of starting ours. That is not a restart.
    await expect(
      restart(home, { port: 1, apiPort: 1 }, {
        start: async () => ({ running: true, url, managed: false, started: false }),
      }),
    ).rejects.toThrow(ServerError);
  });
});
describe("start verifies the record it wrote", () => {
  test("a record that reads back as written passes", () => {
    const home = tmp();
    const proc = { pid: process.pid, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" };
    const rec = { ui: proc, api: { ...proc, url: "http://127.0.0.1:2" } };
    writeState(home, rec);
    expect(() => verifyRecord(home, rec)).not.toThrow();
  });

  test("a record that is missing after the write fails, naming the pids to stop by hand", () => {
    const home = tmp();
    const proc = { pid: 4242, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" };
    const rec = { ui: proc, api: { ...proc, pid: 4343, url: "http://127.0.0.1:2" } };
    expect(() => verifyRecord(home, rec)).toThrow(/did not read back.*kill 4242 4343/);
  });

  test("a record that reads back with another pid fails", () => {
    const home = tmp();
    const proc = { pid: 4242, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" };
    writeState(home, { ui: { ...proc, pid: 9999 }, api: { ...proc, url: "http://127.0.0.1:2" } });
    expect(() => verifyRecord(home, { ui: proc, api: { ...proc, url: "http://127.0.0.1:2" } })).toThrow(ServerError);
  });
});

describe("stop names the process when nothing is recorded", () => {
  test("unrecordedNote with a listener gives the pid and the kill command", () => {
    const note = unrecordedNote("http://127.0.0.1:38770", [4321]);
    expect(note).toContain("pid 4321");
    expect(note).toContain("kill 4321");
  });

  test("unrecordedNote with no listener says how to find one", () => {
    const note = unrecordedNote("http://127.0.0.1:38770", []);
    expect(note).toContain("lsof -nP -iTCP:38770");
  });

  test("stop on a home with no record and nothing answering reports not stopped", async () => {
    // Point at a port nothing listens on, so the result does not depend on what this machine runs.
    const prev = process.env.BLACKBOARD_URL;
    process.env.BLACKBOARD_URL = "http://127.0.0.1:1";
    try {
      const r = await stop(tmp());
      expect(r).toEqual({ stopped: false, nothing: true });
    } finally {
      if (prev === undefined) delete process.env.BLACKBOARD_URL;
      else process.env.BLACKBOARD_URL = prev;
    }
  });
});

describe("a pre-split single-pid record", () => {
  const writeLegacy = (home: string, proc: { pid: number; url: string; startedAt: string }) =>
    writeFileSync(join(home, "server.json"), JSON.stringify(proc) + "\n");

  test("stop kills the recorded process when it is alive, and clears the record", async () => {
    const home = tmp();
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    const pid = child.pid!;
    child.unref();
    try {
      expect(pidAlive(pid)).toBe(true);
      // Nothing listens on the recorded url's port: the kill is what stop is proving.
      writeLegacy(home, { pid, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" });
      const r = await stop(home);
      expect(r).toEqual({ stopped: true });
      expect(pidAlive(pid)).toBe(false);
      expect(readState(home)).toBeNull();
    } finally {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }, 20_000);

  test("stop on a dead pid just clears the record", async () => {
    const home = tmp();
    writeLegacy(home, { pid: 2 ** 22 + 12345, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" });
    const r = await stop(home);
    expect(r).toEqual({ stopped: true });
    expect(readState(home)).toBeNull();
  }, 20_000);

  test("stop is not stopped while a stranger still holds the recorded port", async () => {
    const foreign = slowServer(0);
    const url = `http://127.0.0.1:${foreign.port}`;
    try {
      const home = tmp();
      writeLegacy(home, { pid: 2 ** 22 + 12345, url, startedAt: "2026-01-01T00:00:00.000Z" });
      const r = await stop(home);
      // The recorded pid is dead and the record is cleared, but the port answers: "stopped"
      // here would let a restart lose whoever owns it.
      expect(r.stopped).toBe(false);
      expect(r.note).toContain("port still listens");
      expect(readState(home)).toBeNull();
    } finally {
      foreign.stop(true);
    }
  }, 20_000);

  test("restart stops the legacy process and starts a fresh pair", async () => {
    const home = tmp();
    writeLegacy(home, { pid: 2 ** 22 + 12345, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" });
    let started = false;
    const proc = { pid: process.pid, url: "http://127.0.0.1:1", startedAt: "x", log: "/x/server.log" };
    const r = await restart(home, { port: 1, apiPort: 1 }, {
      start: async () => {
        started = true;
        return { running: true, url: proc.url, managed: true, degraded: [], ui: proc, api: { ...proc, url: "http://127.0.0.1:2", log: "/x/api.log" }, started: true };
      },
    });
    expect(started).toBe(true);
    expect(r.started).toBe(true);
    expect(readState(home)).toBeNull();
  }, 20_000);
});

describe("serve start --foreground", () => {
  test("resolveApiUrl honours --api-port, BLACKBOARD_API_URL, and the default", () => {
    expect(resolveApiUrl({ env: {} })).toBe(DEFAULT_API_URL);
    expect(resolveApiUrl({ env: { BLACKBOARD_API_URL: "http://127.0.0.1:4500/" } })).toBe("http://127.0.0.1:4500");
    expect(resolveApiUrl({ apiPort: 4501, env: { BLACKBOARD_API_URL: "http://127.0.0.1:4500" } })).toBe("http://127.0.0.1:4501");
  });

  test("foreground refuses when the api port is already listening, naming the port", async () => {
    const busy = slowServer(0);
    try {
      await expect(runForeground(tmp(), { port: 1, apiPort: busy.port })).rejects.toThrow(/already in use|listening|occupied/);
    } finally {
      busy.stop(true);
    }
  });

  test("foreground refuses when the ui port is already listening", async () => {
    const busy = slowServer(0);
    try {
      await expect(runForeground(tmp(), { port: busy.port, apiPort: 1 })).rejects.toThrow(/already in use|listening|occupied/);
    } finally {
      busy.stop(true);
    }
  });
});
