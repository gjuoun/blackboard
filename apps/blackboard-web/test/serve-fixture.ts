import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "bun:test";

/** Temp folders the serve tests create; removed after each test. */
export const dirs: string[] = [];
export const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "bb-ctl-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A home with many registered sessions and comment folders, the shape of a long-used one. */
export const bigHome = () => {
  const home = tmp();
  for (let i = 1; i <= 120; i += 1) {
    const dir = join(home, "sessions", `s${String(i).padStart(3, "0")}`);
    mkdirSync(dir, { recursive: true });
    if (i % 3 === 0) writeFileSync(join(dir, "comments.json"), '{"version":1,"docs":{"design.md":[]}}\n');
  }
  return home;
};

/** A stand-in for one Blackboard process that answers /api/health only after `delayMs`. */
export function slowServer(delayMs: number) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      await Bun.sleep(delayMs);
      if (new URL(req.url).pathname === "/api/health") return Response.json({ app: "blackboard", version: "x" });
      return new Response("ok");
    },
  });
}
