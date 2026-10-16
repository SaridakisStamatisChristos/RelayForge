# RelayForge R7 Evidence Ledger

This document closes the repository-local UCS-Pro R7 campaign for RelayForge without
turning unexecuted external work into evidence.

## Completion label

**VERIFIED FOR THE DECLARED RELAYFORGE REPOSITORY TARGET — external agent/provider
campaigns remain unexecuted.**

RelayForge core, agent-safety controls, benchmark harness, CI, PostgreSQL integration,
adversarial repository tests, and source-manifest generation are implemented and
independently exercised by GitHub Actions.

The later Workflows-N8N/Linear/model campaign and empirical human-review benchmark are
not claimed here. They require external credentials, external systems, and real
executions.

The pull request must remain draft/unmerged until a human chooses otherwise.

## Authoritative contract

The product contract is `RELAYFORGE_ZERO_TO_HERO.md`. The repository implements its
repository-local phases and preserves explicit claim boundaries for external phases.

## Latest code-affecting verification checkpoint

- Commit: `e656cf7da56364734f7e24cba59ee695c3b1b33f`
- CI run: `38897080938` (`CI` run #27) — success
- PostgreSQL integration run: `38897080768` (`Integration` run #27) — success
- Manifest artifact id: `12043714654`
- Manifest artifact digest:
  `sha256:d3ed18578ca95c300805d3ba71429666ad534774cc2d564f394a52dca653c74f`

The manifest is generated from repository bytes by `scripts/generate-manifest.ts`. It
records real SHA-256 hashes and file sizes and excludes VCS data, dependency caches,
generated build output, and the manifest output itself.

Because this evidence file is itself source, the authoritative current-revision status
is always the CI/Integration status attached to the pull request head. A documentation
commit does not inherit green status by assertion; its own CI must pass.

## Requirement coverage

- **R-01 — Runtime and monorepo: VERIFIED.** Node 22, TypeScript 5, pnpm workspaces,
  Turborepo, frozen install, strict typecheck, and build are exercised in CI.
- **R-02 — Fastify and Zod API contracts: VERIFIED.** API tests exercise event,
  destination, replay, auth, health, and readiness routes.
- **R-03 — PostgreSQL persistence and migrations: VERIFIED.** PostgreSQL 17 CI applies
  migrations, verifies migration state, and runs integration tests.
- **R-04 — Transactional event/job ingestion: VERIFIED.** An integration test forces a
  job insert failure and proves the event insert rolls back.
- **R-05 — DB-enforced idempotency: VERIFIED.** Sequential and 8-way concurrent
  identical submissions converge to one row/event id; conflicting content is rejected.
- **R-06 — Race-safe worker claims: VERIFIED.** PostgreSQL integration races claimers
  and proves one due job is claimed once through the database claim path.
- **R-07 — Delivery classification/retries/exhaustion: VERIFIED.** Tests cover success,
  retryable and permanent HTTP classes, deterministic backoff, exhaustion, network
  failure, and timeout classification.
- **R-08 — Attempts, dead letters, and replay: VERIFIED.** Integration tests persist
  attempts/dead letters, replay a dead letter once, preserve replay provenance, and
  serialize duplicate event replay races.
- **R-09 — Destination filtering/disable behavior: VERIFIED.** Integration and worker
  tests cover event-type filtering and disabled destinations.
- **R-10 — Liveness versus readiness: VERIFIED.** `/health` remains 200 while `/ready`
  returns 503 when the required store dependency is unavailable.
- **R-11 — API-key boundary: VERIFIED.** Protected API routes return 401 without bearer
  authorization; auth code is a forbidden autonomous path.
- **R-12 — Destination/SSRF baseline: VERIFIED.** HTTPS-only and credential-bearing URL
  rejection are tested and redirects are not followed. Comprehensive SSRF prevention
  is not claimed.
- **R-13 — Package dependency boundaries: VERIFIED.** `pnpm check:boundaries` passes in
  CI and enforces the declared internal package graph.
- **R-14 — Agent policy/ownership/trusted verification: VERIFIED.** `AGENTS.md`, policy,
  ownership, CODEOWNERS, and trusted verification profiles exist and are exercised.
- **R-15 — Traversal/symlink/test-weakening/shell/secret defenses: VERIFIED.** Tests
  reject traversal, a real symlink escape, test deletion, unrestricted child-process
  patterns, and committed-secret patterns.
- **R-16 — Strict verification profile: VERIFIED.** CI #27 passed format, lint, strict
  types, boundaries, secret scan, benchmark validation, tests, build, manifest
  generation, and artifact upload.
- **R-17 — Benchmark task corpus: VERIFIED.** RF-001 through RF-015 are issue-only
  contracts. Validation requires at least 10 tasks and fixed 40-hex base commits. The
  seeded contracts are explicitly `simulated`.
- **R-18 — Benchmark metrics/claim hygiene: VERIFIED.** Results separate first-pass and
  final CI, repairs, human review, safety counts, completion time, and optional token/API
  cost. Unknown human fields remain null or absent.
- **R-19 — Hidden evaluator execution: UNVERIFIED.** Public task contracts contain
  `evaluatorRef` references, but held-out evaluator execution is intentionally external
  to the agent-visible repository.
- **R-20 — Workflows-N8N campaign integration: UNVERIFIED.** Cross-repository
  orchestration requires independent evidence from Workflows-N8N.
- **R-21 — Real Linear/provider pilot: UNVERIFIED.** This requires external credentials
  and a real provider flow. No result is fabricated or inferred.
- **R-22 — Empirical 10+ genuine-task campaign/human review: UNVERIFIED.** The repository
  contains simulated benchmark contracts, not a claimed autonomous-coding dataset.
- **R-23 — Production scale/exactly-once/enterprise/SOTA claims: N/A.** These are explicit
  non-goals or excluded claims and are not required for repository completion.

## Adversarial closure

Repository-level falsification covers:

- malformed and invalid API input;
- unauthorized protected routes;
- dependency-unavailable readiness while liveness remains healthy;
- sequential and concurrent idempotency;
- transactional rollback on forced job-creation failure;
- concurrent worker claim;
- event-type filtering and disabled destinations;
- retryable and permanent HTTP outcomes;
- network failure and abort/timeout classification;
- bounded retry exhaustion;
- dead-letter creation and one-time replay;
- duplicate event replay race;
- cursor pagination without duplicate cross-page events;
- forbidden agent paths and review-required CI paths;
- test deletion, committed-secret patterns, and unrestricted shell patterns;
- path traversal and real filesystem symlink escape;
- package-boundary verification;
- frozen dependency installation and reproducible CI build.

No adversarial result is promoted beyond what those tests actually establish.

## Failure and repair ledger

The campaign did not erase failing iterations. Branch and Actions history preserve them.
Material observed failures and repairs include:

- **F-01 — Typed-ESLint/project-service bootstrap failure.** Earliest invalidated phase:
  INTEGRATE. Lint/project configuration was repaired without disabling behavioral tests.
  Later lint gates are green.
- **F-02 — Root module/project-reference integration defects.** Earliest invalidated
  phase: INTEGRATE. ESM/project-reference/task configuration was corrected. Later type
  and build gates are green.
- **F-03 — Nullable `pg` `rowCount`.** Earliest invalidated phase: GENERATE. Nullable
  row count was handled explicitly with compiler strictness unchanged. Typecheck, build,
  and PostgreSQL integration are green.
- **F-04 — Benchmark summary null typing.** Earliest invalidated phase: GENERATE.
  `reviewer_acceptance_rate` received explicit nullable numeric typing. Strict typecheck
  is green.
- **F-05 — RF task corpus formatting.** Earliest invalidated phase: GENERATE. RF-001
  through RF-015 were normalized without weakening tasks or tests. Format and benchmark
  validation are green.
- **F-06 — Missing evidence ledger.** Earliest invalidated phase: PACKAGE / EVIDENCE.
  Final audit found README referenced missing `docs/R7_EVIDENCE.md`. This file closes the
  missing evidence surface instead of deleting the reference.
- **F-07 — Missing direct timeout and symlink falsifiers.** Earliest invalidated phase:
  FALSIFY. Explicit aborted-request timeout and real symlink-escape tests were added.
  CI #26 and later are green.
- **F-08 — Missing degraded-readiness falsifier.** Earliest invalidated phase: FALSIFY.
  A direct `/health` 200 plus `/ready` 503 dependency-failure test was added. CI #27 is
  green.
- **F-09 — Evidence ledger formatting.** Earliest invalidated phase: PACKAGE / EVIDENCE.
  The first evidence-ledger commit failed only `pnpm format:check`. The ledger was
  normalized; no later gate was claimed as executed on that failed revision.

No compiler, lint, contract, or behavioral test was weakened to manufacture green
status.

## Claims ledger

### Supported

RelayForge is an evidence-backed TypeScript/Node.js event-relay monorepo with PostgreSQL
persistence, transactional job creation, bounded retry/dead-letter behavior, replay,
DB-enforced idempotency, race-safe job claiming, strict CI, explicit agent path policy,
adversarial safety tests, and a validated simulated benchmark corpus.

### Explicitly unsupported by this campaign

Do not claim:

- exactly-once delivery;
- production scale or capacity;
- zero data loss under every failure mode;
- complete SSRF protection;
- enterprise readiness or compliance;
- superiority of any coding agent;
- productivity improvement;
- reviewer satisfaction;
- real n8n/Linear adoption;
- a successful external provider campaign;
- empirical benchmark rates from the simulated RF task templates.

## Remaining external evidence

Only concrete external work remains:

1. Run the Workflows-N8N target integration against this repository.
2. Preserve a real isolated agent campaign and resulting draft-PR evidence.
3. Run a real Linear/provider path when credentials are intentionally supplied.
4. Execute genuine benchmark tasks from fixed historical bases with held-out evaluators.
5. Collect human-review fields only from actual reviewers.
6. Perform production load/capacity/security evaluation only if a production-readiness
   claim is later desired.

These items are not repository code-completeness blockers. They are blockers for claims
about external orchestration performance, human acceptance, production scale, or
autonomous-agent effectiveness.
