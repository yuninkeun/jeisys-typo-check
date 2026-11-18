import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

// 사이드바 스탬프(Jeisys UI 표준): 버전과 최신화(배포) 시각은 손으로 적지 않고 빌드가 채운다.
const builtAt = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version, NEXT_PUBLIC_BUILT_AT: builtAt },
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
