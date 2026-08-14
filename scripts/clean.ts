import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const TARGETS = [
  "node_modules",
  "dist",
  ".turbo",
  "apps/web/.next",
  "apps/web/dist",
  "apps/api/dist",
  "coverage",
] as const;

function main(): void {
  for (const rel of TARGETS) {
    const path = resolve(ROOT, rel);
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      console.log(`Removed ${rel}`);
    }
  }
  console.log("Clean complete.");
}

main();
