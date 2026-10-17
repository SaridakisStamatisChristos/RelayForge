# Testing

RelayForge separates deterministic unit/API tests from real PostgreSQL integration tests.

`pnpm test` covers Zod validation, retry calculation, state transitions, cursor parsing, destination filtering, outbound result classification, API authentication/validation/filtering/idempotency behavior, worker success/retry/permanent/exhaustion/disabled behavior, and repository-policy adversarial checks.

`pnpm test:integration` requires PostgreSQL and covers migration application/checksums, sequential and concurrent idempotency, conflicting idempotency content, concurrent worker claims, attempt/dead-letter persistence, and concurrent event replay serialization.

Tests do not sleep for retry timing; clocks are injected. HTTP route tests use Fastify injection. PostgreSQL concurrency is tested against a real database in GitHub Actions.

A failing test must not be deleted or weakened merely to obtain a passing build. Repository validation also checks for test deletion and other unsafe change patterns.

## Verification commands

Run the complete static/unit/build profile:

```bash
pnpm verify
```

Run the PostgreSQL-backed profile:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm verify:migrations
pnpm test:integration
```

Pull requests execute both profiles through GitHub Actions.
