import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

/**
 * The app: TanStack Start on Vite 8 with Nitro's `node-server` preset. `dev` serves it on 38792 with
 * the API run beside it (see README); `build` emits `.output/`, which `build:server` assembles into
 * the `server/` tree that `blackboard serve` runs.
 */
export default defineConfig({
  server: { port: 38792, host: "127.0.0.1" },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart({ srcDirectory: "src" }), viteReact(), nitro()],
});