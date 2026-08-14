import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than build output.
  transpilePackages: ["@opengong/ui", "@opengong/types"],
};

export default nextConfig;
