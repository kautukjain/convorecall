/**
 * Lightweight release helper — prints checklist; tagging is intentional/manual.
 */
function main(): void {
  const tag = process.argv[2] ?? "v0.1.0";
  console.log(`Release checklist for ${tag}:`);
  console.log("- [ ] CHANGELOG updated");
  console.log("- [ ] PROJECT_STATE.md reflects shipped MVP");
  console.log("- [ ] pnpm lint && pnpm typecheck && pnpm test && pnpm build");
  console.log("- [ ] Sample demo path verified");
  console.log(`- [ ] git tag ${tag} && git push origin ${tag}`);
}

main();
