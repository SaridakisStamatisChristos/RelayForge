# Testing

RelayForge separates deterministic unit/API tests from real PostgreSQL integration tests.

`pnpm test` covers Zod validation, retry calculation, state transitions, cursor parsing, destination filtering, outbound result classification, API auth/validation/filtering/idempotency surface, worker success/retry/permanent/exhaustion/disabled behavior, and agent-policy adversarial checks.

`pnpm test:integration` requires PostgreSQL and covers migration application/checksums, sequential and concurrent idempotency, conflicting idempotency content, concurrent worker claims, attempt/dead-letter persistence, and concurrent event replay serialization.

Tests do not sleep for retry timing; clocks are injected. HTTP route tests use Fastify injection. PostgreSQL concurrency is tested against the real database in GitHub Actions.

A failing test must not be deleted/weakened merely to reach green; this is both an agent contract rule and a validator rule for autonomous change manifests.
