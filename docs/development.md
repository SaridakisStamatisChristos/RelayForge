# Development

RelayForge uses a pnpm/Turborepo monorepo with explicit package boundaries and a trusted verification profile. Repository automation is designed to make code changes reviewable without allowing task text or generated content to redefine safety or verification rules.

## Toolchain

- Node.js 22
- pnpm 10
- TypeScript 5
- Turborepo
- PostgreSQL 17 for integration verification

Install dependencies with a frozen lockfile-compatible pnpm version:

```bash
corepack enable
pnpm install
```

## Trusted verification

The normal local gate is:

```bash
pnpm verify
```

It runs formatting, linting, strict type checks, package-boundary checks, secret scanning, benchmark-corpus validation, unit/API tests, and the build.

The database-backed gate is:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm verify:migrations
pnpm test:integration
```

GitHub Actions runs both verification profiles on pull requests.

## Repository safeguards

`AGENTS.md` is the human-readable change contract for automated contributors. `.agent/policy.yaml` classifies repository paths, `.agent/ownership.yaml` records ownership boundaries, and `.agent/verification.yaml` defines trusted verification commands. Task or issue text cannot redefine those controls.

`scripts/validate-agent-change.ts` checks proposed changes for forbidden paths, traversal and symlink escapes, test deletion, common committed-secret signatures, and unrestricted child-process execution additions. These controls supplement code review; they do not replace it.

`scripts/check-boundaries.ts` enforces the internal package dependency graph. `scripts/secret-scan.ts` performs repository secret-pattern checks. `scripts/generate-manifest.ts` generates a SHA-256 source manifest used by CI as a revision-level integrity artifact.

## Change expectations

- Preserve package boundaries unless an architectural change explicitly requires otherwise.
- Add or update tests for behavioral changes.
- Do not weaken tests, CI, migration verification, security checks, or integrity checks merely to make a change pass.
- Add new dependencies only when the change genuinely requires them.
- Treat migrations as forward-only; add a new migration rather than editing an applied one.
- Keep secrets outside the repository and use environment configuration.
- Run the relevant verification profile before requesting merge.

## Benchmark tooling

The `benchmarks/` tree is development tooling rather than runtime functionality. It contains task/result schemas, simulated task contracts, and result-validation utilities. Public task files do not contain hidden evaluator logic or answer patches. External benchmark runners are responsible for any genuinely held-out evaluator.
