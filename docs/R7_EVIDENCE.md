# RelayForge R7 Evidence Ledger

This document closes the repository-local UCS-Pro R7 campaign for RelayForge without turning unexecuted external work into evidence.

## Completion label

**VERIFIED FOR THE DECLARED RELAYFORGE REPOSITORY TARGET — external agent/provider campaigns remain unexecuted.**

RelayForge core, agent-safety controls, benchmark harness, CI, PostgreSQL integration lane, adversarial repository tests, and source-manifest generation are implemented and independently exercised by GitHub Actions. The later Workflows-N8N/Linear/model campaign and empirical human-review benchmark are intentionally not claimed here because they require external credentials, external systems, and real executions.

The pull request must remain draft/unmerged until a human chooses otherwise.

## Authoritative contract

The product contract is `RELAYFORGE_ZERO_TO_HERO.md`. The repository implements the repository-local phases of that contract and preserves explicit claim boundaries for external phases.

## Latest code-affecting verification checkpoint

Code-affecting checkpoint:

- commit: `e656cf7da56364734f7e24cba59ee695c3b1b33f`
- CI run: `38897080938` (`CI` run #27) — success
- PostgreSQL integration run: `38897080768` (`Integration` run #27) — success
- manifest artifact id: `12043714654`
- manifest artifact digest: `sha256:d3ed18578ca95c300805d3ba71429666ad534774cc2d564f394a52dca653c74f`

The manifest artifact is generated from repository bytes using `scripts/generate-manifest.ts`; it records real SHA-256 hashes and file sizes and excludes VCS data, dependency caches, generated build output, and the manifest output itself.

Because this evidence file is itself source, the authoritative current-revision status is always the CI/Integration status attached to the pull request head. A later documentation-only commit does not inherit green status by assertion; its own CI must pass.

## Requirement coverage

| ID | Requirement surface | State | Evidence / rationale |
| --- | --- | --- | --- |
| R-01 | Node 22, TypeScript 5, pnpm workspace, Turborepo | VERIFIED | Frozen install, strict typecheck and build pass in CI. |
| R-02 | Fastify + Zod API contracts | VERIFIED | Unit/API tests and build pass; event, destination, replay, auth, health/readiness routes are exercised. |
| R-03 | PostgreSQL persistence and migrations | VERIFIED | PostgreSQL 17 service lane applies migrations, verifies migration hashes/state, and runs integration tests. |
| R-04 | Event + delivery-job transactional ingestion | VERIFIED | PostgreSQL integration test forces job insert failure and proves event rollback. |
| R-05 | DB-enforced idempotent ingestion | VERIFIED | Sequential and 8-way concurrent identical submissions converge to one row/event id; conflicting content is rejected. |
| R-06 | Race-safe worker claims | VERIFIED | PostgreSQL integration test races workers; one due job is claimed once using the database claim path. |
| R-07 | Delivery classification, retries and exhaustion | VERIFIED | Unit tests cover 2xx, retryable 408/429/5xx, 4xx permanent failure, deterministic backoff, retry exhaustion and timeout classification. |
| R-08 | Attempts, dead letters and replay | VERIFIED | Integration tests persist attempts/dead letters, replay dead letters once, record replay provenance, and serialize duplicate event replay races. |
| R-09 | Destination filtering / disabled destinations | VERIFIED | Integration and worker tests prove event-type filtering and disabled-destination behavior. |
| R-10 | Liveness vs readiness | VERIFIED | API tests prove `/health` remains 200 while `/ready` becomes 503 when the required store dependency is unavailable. |
| R-11 | API-key boundary | VERIFIED | Protected API route tests return 401 without bearer auth; auth source is a forbidden autonomous path. |
| R-12 | Destination/SSRF baseline | VERIFIED | HTTPS-only and credential-bearing URL rejection are tested; redirects are not followed. Comprehensive SSRF prevention is explicitly not claimed. |
| R-13 | Package dependency boundaries | VERIFIED | `pnpm check:boundaries` passes in CI and rejects imports outside the declared package graph. |
| R-14 | Agent path policy / ownership / trusted verification | VERIFIED | `AGENTS.md`, `.agent/policy.yaml`, `.agent/ownership.yaml`, CODEOWNERS and `.agent/verification.yaml` exist; policy tests cover protected/forbidden changes. |
| R-15 | Traversal / symlink / test-weakening / shell / secret defenses | VERIFIED | Adversarial tests reject traversal, a real symlink escape, test deletion, unrestricted child-process execution patterns and secret patterns. |
| R-16 | Strict verification profile | VERIFIED | CI #27 passes format, lint, strict types, boundaries, secret scan, benchmark validation, unit tests, build, manifest generation and artifact upload. |
| R-17 | Benchmark task corpus | VERIFIED | RF-001..RF-015 are issue-only contracts; validation requires at least 10 tasks and fixed 40-hex base commits. Seeded tasks are explicitly marked `simulated`. |
| R-18 | Benchmark metrics / claim hygiene | VERIFIED | Result schema/summarizer separates first-pass/final CI, repairs, human review, safety counts, completion time and optional token/API cost; unknown human fields stay null/absent. |
| R-19 | Hidden evaluator execution | UNVERIFIED | Public task contracts contain `evaluatorRef` references, but held-out evaluator execution is intentionally external to the agent-visible repository. No execution claim is made. |
| R-20 | Workflows-N8N campaign integration | UNVERIFIED | Cross-repository orchestration is outside this repository-local R7 execution and requires independent evidence from Workflows-N8N. |
| R-21 | Real Linear/provider pilot | UNVERIFIED | Requires external credentials and a real provider flow. None was fabricated or inferred. |
| R-22 | Empirical 10+ genuine-task campaign / human review metrics | UNVERIFIED | The repository contains simulated benchmark contracts, not a claimed empirical autonomous-coding dataset. |
| R-23 | Production scale / exactly-once / enterprise / SOTA claims | N/A | Explicit non-goals/claim exclusions; no such claim is required for RelayForge completion. |

## Adversarial closure

Repository-level falsification covers the high-impact contract boundaries:

- malformed/invalid API input;
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
- forbidden agent paths;
- CI review-required paths;
- test deletion;
- committed-secret patterns;
- unrestricted shell-execution patterns;
- path traversal and real filesystem symlink escape;
- package-boundary verification;
- build/package reproducibility through frozen dependency installation and CI build.

No adversarial result is promoted beyond what those tests actually establish.

## Failure / repair ledger

The campaign did not erase failing iterations. The branch/Actions history preserves them. Material observed failures and repairs include:

| Failure | Earliest invalidated surface | Repair | Reverification |
| --- | --- | --- | --- |
| Typed-ESLint/project-service configuration rejected test-file coverage during bootstrap | INTEGRATE | Repaired lint/project configuration without disabling behavioral tests | Later lint gates green. |
| Root workspace/module/project-reference integration defects surfaced during bootstrap | INTEGRATE | Corrected ESM/project-reference/task configuration | Later type/build gates green. |
| Strict `pg` typings reported nullable `rowCount` in database code | GENERATE | Handled nullable row count explicitly; compiler strictness unchanged | Database typecheck/build and PostgreSQL integration green. |
| Benchmark summarizer inferred `reviewer_acceptance_rate` as literal `null` | GENERATE | Added explicit nullable numeric summary typing | Strict typecheck green. |
| Added RF-001..RF-015 JSON corpus initially failed Prettier | GENERATE | Normalized task JSON; no task/test weakening | Format gate green; benchmark validator green. |
| Final audit found README referenced missing `docs/R7_EVIDENCE.md` | PACKAGE / MANIFEST-EVIDENCE | Added this evidence ledger instead of deleting the reference | Must pass the CI attached to the commit containing this file. |
| R7 falsification audit identified missing direct timeout and symlink-escape tests | FALSIFY | Added explicit aborted-request timeout test and real symlink-escape test | CI #26 and later green. |
| R7 falsification audit identified missing degraded-readiness test | FALSIFY | Added direct `/health` 200 + `/ready` 503 dependency-failure test | CI #27 green. |

No compiler/lint/test gate was weakened to manufacture green status.

## Claims ledger

### Supported

RelayForge is an evidence-backed TypeScript/Node.js event-relay monorepo with PostgreSQL persistence, transactional job creation, bounded retry/dead-letter behavior, replay, DB-enforced idempotency, race-safe job claiming, strict CI, explicit agent path policy, adversarial safety tests, and a validated simulated benchmark corpus.

### Explicitly unsupported by this campaign

Do not claim from this repository-local run:

- exactly-once delivery;
- production scale/capacity;
- zero data loss under every failure mode;
- complete SSRF protection;
- enterprise readiness/compliance;
- superiority of any coding agent;
- productivity improvement;
- reviewer satisfaction;
- real n8n/Linear adoption;
- successful external provider campaign;
- empirical benchmark rates from the simulated RF task templates.

## Remaining external evidence

Only concrete external work remains:

1. run the Workflows-N8N target integration against this repository;
2. preserve a real isolated agent campaign and resulting draft PR evidence;
3. run a real Linear/provider path when credentials are intentionally supplied;
4. execute genuine benchmark tasks from fixed historical bases with held-out evaluators;
5. collect human-review fields only from actual reviewers;
6. perform production load/capacity/security evaluation only if a production-readiness claim is later desired.

These items are not repository code-completeness blockers, but they are blockers for any claim about external orchestration performance, human acceptance, production scale, or autonomous-agent effectiveness.
