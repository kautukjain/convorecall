# Contributing

Thanks for helping ship ConvoRecall.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm setup
pnpm seed
pnpm dev
```
OR

```bash
pnpm install
cp .env.example .env
pnpm run setup
pnpm seed
pnpm dev
```

## Workflow

1. Open an issue (bug / feature / task templates).
2. Branch from `main`: `feat/...`, `fix/...`, `docs/...`.
3. Keep changes focused; follow `.cursor/rules/`.
4. Run `pnpm lint && pnpm typecheck && pnpm test`.
5. Open a PR using the pull request template.

## Code standards

- TypeScript strict; no `any` without justification.
- Validate all external input (Zod).
- No secrets in source; env only.
- Harness: named exits, gates, capped retries.

## Commit style

Prefer conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.

## Security

Report credential leaks or unsafe patterns in a private channel / security issue — do not open a public issue with secrets.
