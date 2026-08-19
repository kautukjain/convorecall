import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than build output.
  transpilePackages: ["@convorecall/ui", "@convorecall/types"],
};

export default nextConfig;
