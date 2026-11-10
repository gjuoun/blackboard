import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatStatus, probe, readState, status, writeState } from "../lib/server-ctl";
import { bigHome, slowServer, tmp } from "../test/serve-fixture";

describe("status with a live server", () => {
  test("a Blackboard answering with no state of ours is running but not managed; a stale state is cleared", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => (new URL(req.url).pathname === "/api/health" ? Response.json({ app: "blackboard", version: "x" }) : new Response("no", { status: 404 })) });
    const url = `http://127.0.0.1:${server.port}`;
    try {
      const home = tmp();
      expect(await probe(url)).toBe(true);
      expect(await status(home, url)).toEqual({ running: true, url, managed: false });
      const dead = { pid: 2 ** 22 + 12345, url, startedAt: "2026-01-01T00:00:00.000Z" };
      writeState(home, { ui: dead, api: dead });
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
  test("a pair with one process gone reads as partial and keeps its record, so stop can still reach the survivor", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ app: "blackboard", version: "x" }) });
    const url = `http://127.0.0.1:${server.port}`;
    try {
      const home = tmp();
      const alive = { pid: process.pid, url, startedAt: "2026-01-01T00:00:00.000Z" };
      const dead = { pid: 2 ** 22 + 12345, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" };
      writeState(home, { ui: alive, api: dead });
      const s = await status(home, "http://127.0.0.1:1");
      expect(s.running).toBe(false);
      expect(formatStatus(s)).toContain("one of the pair has stopped");
      expect(formatStatus(s)).toContain("api: down");
      expect(readState(home)).not.toBeNull();
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

describe("status with a pre-split single-pid record", () => {
  const writeLegacy = (home: string, proc: { pid: number; url: string; startedAt: string }) =>
    writeFileSync(join(home, "server.json"), JSON.stringify(proc) + "\n");

  test("a live legacy process reads as running, named as a pre-split record", async () => {
    const server = slowServer(0);
    const url = `http://127.0.0.1:${server.port}`;
    try {
      const home = tmp();
      const proc = { pid: process.pid, url, startedAt: "2026-01-01T00:00:00.000Z" };
      writeLegacy(home, proc);
      const s = await status(home);
      expect(s).toEqual({ running: true, url, legacy: { ...proc, state: "running", cleared: false } });
      const text = formatStatus(s);
      expect(text).toContain(`running at ${url}  pid ${proc.pid}`);
      expect(text).toContain("pre-split");
      expect(text).toContain("blackboard serve restart");
      expect(readState(home)).not.toBeNull();
    } finally {
      server.stop(true);
    }
  }, 20_000);

  test("a dead legacy pid clears the record and reports it cleared", async () => {
    const home = tmp();
    const proc = { pid: 2 ** 22 + 12345, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" };
    writeLegacy(home, proc);
    const s = await status(home);
    expect(s).toEqual({ running: false, url: proc.url, legacy: { ...proc, state: "down", cleared: true } });
    expect(readState(home)).toBeNull();
    const text = formatStatus(s);
    expect(text).toContain("pid (" + proc.pid + ") is gone");
    expect(text).toContain("cleared");
  });

  test("a live legacy pid whose port answers nothing is down, and the record stays for stop", async () => {
    const home = tmp();
    const proc = { pid: process.pid, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z" };
    writeLegacy(home, proc);
    const s = await status(home);
    expect(s).toEqual({ running: false, url: proc.url, legacy: { ...proc, state: "down", cleared: false } });
    expect(readState(home)).not.toBeNull();
    const text = formatStatus(s);
    expect(text).toContain("pid " + proc.pid + " is alive");
    expect(text).toContain("blackboard serve stop");
  }, 20_000);
});

describe("a large home: a slow pair keeps its record", () => {
  test("a slow pair keeps its record in a home with many sessions", async () => {
    const home = bigHome();
    const api = slowServer(2600);
    const ui = slowServer(2600);
    try {
      const apiUrl = `http://127.0.0.1:${api.port}`;
      const uiUrl = `http://127.0.0.1:${ui.port}`;
      const now = new Date().toISOString();
      writeState(home, { ui: { pid: process.pid, url: uiUrl, startedAt: now }, api: { pid: process.pid, url: apiUrl, startedAt: now } });
      const s = await status(home, uiUrl);
      // Answering in 2.6 s is inside the 5 s health budget: the pair is running, and the record is kept.
      expect(readState(home)).not.toBeNull();
      expect(s).toMatchObject({ running: true, managed: true, degraded: [] });
    } finally {
      api.stop(true);
      ui.stop(true);
    }
  }, 20_000);
});

describe("status states: running, degraded, down", () => {
  test("a process that listens but answers after the 5 s budget is degraded, not down", async () => {
    const home = tmp();
    const ui = slowServer(6500);
    const api = slowServer(6500);
    try {
      const now = new Date().toISOString();
      writeState(home, {
        ui: { pid: process.pid, url: `http://127.0.0.1:${ui.port}`, startedAt: now },
        api: { pid: process.pid, url: `http://127.0.0.1:${api.port}`, startedAt: now },
      });
      const s = await status(home, "http://127.0.0.1:1");
      // Both pids are alive and both ports listen; the health route is what is slow. That is degraded, and
      // the pair is still ours and still reported as running, with the slow processes named.
      expect(readState(home)).not.toBeNull();
      expect(s).toMatchObject({ running: true, managed: true, degraded: ["ui", "api"] });
    } finally {
      ui.stop(true);
      api.stop(true);
    }
  }, 30_000);

  test("a process whose pid is gone is down, and the pair is not running", async () => {
    const home = tmp();
    const api = slowServer(0);
    try {
      const now = new Date().toISOString();
      const gone = 2 ** 22 + 12345;
      writeState(home, {
        ui: { pid: gone, url: `http://127.0.0.1:${api.port}`, startedAt: now },
        api: { pid: process.pid, url: `http://127.0.0.1:${api.port}`, startedAt: now },
      });
      const s = await status(home, "http://127.0.0.1:1");
      expect(s).toMatchObject({ running: false, partial: { ui: "down", api: "running" } });
    } finally {
      api.stop(true);
    }
  }, 30_000);

  test("a live pid whose port accepts no connection is down", async () => {
    const home = tmp();
    // A port nothing listens on, held by no process: the pid is ours, the port is not.
    const closed = slowServer(0);
    const port = closed.port;
    closed.stop(true);
    const now = new Date().toISOString();
    writeState(home, {
      ui: { pid: process.pid, url: `http://127.0.0.1:${port}`, startedAt: now },
      api: { pid: process.pid, url: `http://127.0.0.1:${port}`, startedAt: now },
    });
    const s = await status(home, "http://127.0.0.1:1");
    expect(s).toMatchObject({ running: false, partial: { ui: "down", api: "down" } });
  }, 30_000);
});

describe("formatStatus names a slow process without calling it down", () => {
  test("a managed pair with a degraded process says which one is slow, and still reads as running", () => {
    const proc = { pid: 1, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z", log: "/x/server.log" };
    const text = formatStatus({ running: true, url: "http://127.0.0.1:1", managed: true, degraded: ["api"], ui: proc, api: { ...proc, log: "/x/api.log" } });
    expect(text.startsWith("running at ")).toBe(true);
    expect(text).toContain("degraded: api is up but slow");
    expect(text).not.toContain("down");
  });

  test("a managed pair with nothing degraded prints no degraded line", () => {
    const proc = { pid: 1, url: "http://127.0.0.1:1", startedAt: "2026-01-01T00:00:00.000Z", log: "/x/server.log" };
    const text = formatStatus({ running: true, url: "http://127.0.0.1:1", managed: true, degraded: [], ui: proc, api: { ...proc, log: "/x/api.log" } });
    expect(text).not.toContain("degraded");
  });
});

describe("a slow pair is managed, not down", () => {
  test("UI and API that answer after 3 s are reported as managed by this home", async () => {
    const home = tmp();
    const ui = slowServer(3000);
    const api = slowServer(3000);
    try {
      const now = new Date().toISOString();
      writeState(home, {
        ui: { pid: process.pid, url: `http://127.0.0.1:${ui.port}`, startedAt: now },
        api: { pid: process.pid, url: `http://127.0.0.1:${api.port}`, startedAt: now },
      });
      const s = await status(home, "http://127.0.0.1:1");
      expect(s.running).toBe(true);
      expect(s).toMatchObject({ managed: true });
      expect(readState(home)).not.toBeNull();
    } finally {
      ui.stop(true);
      api.stop(true);
    }
  }, 30_000);
});
