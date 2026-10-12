import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse bundles pdf.js, which loads its worker from its own package
  // path at runtime; letting webpack bundle it instead breaks that lookup.
  serverExternalPackages: ["pdf-parse"],
  experimental: {
    serverActions: {
      // Default is 1MB. Files are capped at 4MB in app/check/limits.ts; the
      // extra headroom covers multipart overhead, staying under Vercel's 4.5MB.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
