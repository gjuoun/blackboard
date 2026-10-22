// Cache Components is off: every page reads the board folder from disk on each request,
// and a cached shell would show stale docs and comments.
// `standalone` makes the production build trace only the files the server needs, so the npm
// package ships about 50 MB instead of all of next, mermaid and the rest (see scripts/build-server.ts).
/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  // The dev indicator badge would land in every screenshot taken for the release site.
  devIndicators: false,
  // No next/image here, so the image optimiser (sharp, ~18 MB) is dead weight.
  outputFileTracingExcludes: { "*": ["node_modules/@img/**", "node_modules/sharp/**"] },
};

export default nextConfig;
