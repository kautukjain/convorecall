import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/**/*.{test,spec}.ts",
      "packages/**/*.{test,spec}.ts",
      "tools/**/*.{test,spec}.ts",
      // Setup scripts mint a credential and rewrite .env; that earns tests.
      "scripts/**/*.{test,spec}.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
  },
});
