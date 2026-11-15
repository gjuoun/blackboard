#!/usr/bin/env bun
/**
 * serve.ts — static server for the sketches in this folder, for review only.
 *
 *   bun sketches/serve.ts [port]      # default 38800
 *
 * Sketches are plain HTML/CSS/JS: no build step, nothing imported from the app, nothing exported to
 * it. They exist so a direction can be looked at before it becomes code.
 */
import { join, normalize } from "node:path";

const port = Number(process.argv[2] ?? 38800);
const root = join(import.meta.dir, "..", "sketches");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(root, rel.endsWith("/") ? rel + "index.html" : rel);
    if (!file.startsWith(root)) return new Response("forbidden", { status: 403 });
    const body = Bun.file(file);
    const type = TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream";
    return body.size ? new Response(body, { headers: { "content-type": type } }) : new Response("not found", { status: 404 });
  },
});

console.log("sketches: http://127.0.0.1:" + port + "/reading-config/");
