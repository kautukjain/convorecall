import { copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ensureLlm } from "./llm-setup.js";
import { ensureSandboxKey } from "./sandbox-key.js";

const ROOT = resolve(import.meta.dirname, "..");
const envPath = resolve(ROOT, ".env");
const examplePath = resolve(ROOT, ".env.example");
const composeFile = resolve(ROOT, "infra/compose/docker-compose.yml");

function run(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { cwd: ROOT, stdio: "inherit", env: process.env });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prisma looks for `.env` beside the schema; ours lives at the repo root. Load it here
 * and hand it to every child, so DATABASE_URL is present without a second env file.
 */
function loadRootEnv(): void {
  if (!existsSync(envPath)) return;
  process.loadEnvFile(envPath);
}

function ensureEnv(): void {
  if (existsSync(envPath)) {
    console.log("• .env already present, leaving it alone.");
    return;
  }
  if (!existsSync(examplePath)) {
    console.error("Missing .env.example");
    process.exit(1);
  }
  copyFileSync(examplePath, envPath);
  console.log("• Created .env from .env.example.");
}

function waitForPostgres(): boolean {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      execFileSync(
        "docker",
        ["exec", "opengong-postgres", "pg_isready", "-U", "opengong", "-d", "opengong"],
        { stdio: "ignore" },
      );
      return true;
    } catch {
      execFileSync("sleep", ["2"], { stdio: "ignore" });
    }
  }
  return false;
}

async function main(): Promise<void> {
  ensureEnv();
  loadRootEnv();

  // Speech-to-text needs a key. Minting is best-effort and never fatal: the endpoint is rate
  // limited per network, and the five sample calls do not need it at all.
  const key = await ensureSandboxKey(envPath);
  console.log(`• ${key.message}`);
  if (key.status === "failed") console.log(`  ${key.hint}`);

  // Extraction cannot be provisioned unattended the way speech can: no OpenAI-compatible
  // provider mints an anonymous key. Report honestly, and take the one keyless path if it
  // happens to be available.
  const llm = await ensureLlm(envPath);
  console.log(`• ${llm.message}`);
  if (llm.status === "absent") console.log(`  ${llm.hint}`);

  const hasDocker = run("docker", ["--version"]);
  if (!hasDocker) {
    console.log("• Docker not found — skipping database. Start Postgres yourself and");
    console.log("  set DATABASE_URL, then run: pnpm --filter @opengong/api prisma:migrate");
    return;
  }
// Client generation does not need a live DB. Always run it so `pnpm dev` can import
  // PrismaClient even when Docker/Postgres is unavailable on this machine.
  console.log("• Generating Prisma client…");
  if (!run("pnpm", ["db:generate"])) {
    console.error("  prisma generate failed.");
    process.exit(1);
  }
  console.log("• Starting Postgres…");
  if (!run("docker", ["compose", "-f", composeFile, "up", "-d"])) {
    console.error("  Failed to start Postgres. Is Docker running?");
    process.exit(1);
  }

  if (!waitForPostgres()) {
    console.error("  Postgres did not become ready in time.");
    process.exit(1);
  }
  console.log("• Postgres ready on localhost:5433.");

  console.log("• Applying migrations…");
  if (!run("pnpm", ["--filter", "@opengong/api", "exec", "prisma", "migrate", "deploy"])) {
    console.error("  Migration failed. Check DATABASE_URL in .env.");
    process.exit(1);
  }

  console.log("\nSetup complete. Next: pnpm seed && pnpm dev");
}

await main();
