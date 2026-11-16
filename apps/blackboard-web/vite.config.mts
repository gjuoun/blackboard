import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

/**
 * The second app on this branch: TanStack Start on Vite 8 with Nitro's `node-server` preset.
 * `dev`/`build` still run Next until the port is complete (Step 11); `dev:start`/`build:start`
 * run this tree on 38792 so both can be compared route by route.
 */
export default defineConfig({
  server: { port: 38792, host: "127.0.0.1" },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart({ srcDirectory: "src" }), viteReact(), nitro()],
});