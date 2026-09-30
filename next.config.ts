import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB. Files are capped at 4MB in app/check/limits.ts; the
      // extra headroom covers multipart overhead, staying under Vercel's 4.5MB.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
