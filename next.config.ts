import type { NextConfig } from "next";

// Cache Components is off: every page reads the board folder from disk on each request,
// and a cached shell would show stale docs and comments.
const nextConfig: NextConfig = {
  // The dev indicator badge would end up in screenshots; the UI speaks for itself.
  devIndicators: false,
};

export default nextConfig;
