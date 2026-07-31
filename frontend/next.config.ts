import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Baked in at build time so the user-menu popover can show "last updated"
  // — for this app a new build IS a new deploy (pushing to main triggers a
  // full rebuild in Easypanel), so build time is an honest proxy for it.
  env: {
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString(),
  },
  // Next's dev-only route indicator defaults to bottom-left, which collides
  // with the sidebar's user-menu avatar (also bottom-left). Dev-only, no
  // effect on production builds.
  devIndicators: false,
};

export default nextConfig;
