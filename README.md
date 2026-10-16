# RelayForge

RelayForge is a TypeScript/Node.js event-relay backend and a deliberately realistic target repository for safety-first agentic software engineering. It accepts events, persists them in PostgreSQL, creates destination delivery jobs, processes those jobs with bounded retry semantics, records attempts, dead-letters exhausted/permanent failures, and supports controlled replay.

## Architecture

```text
Client -> Fastify API -> PostgreSQL <- Worker -> HTTPS destinations
                         |  |  |
                         |  |  +-- dead letters / attempts
                         |  +----- replay provenance
                         +-------- DB-enforced idempotency + SKIP LOCKED claims
```

The monorepo intentionally separates contracts, domain logic, persistence, delivery, configuration, and observability. `scripts/check-boundaries.ts` enforces the declared dependency graph.

## Packages

- `apps/api` — Fastify API, API-key boundary, HTTP contracts.
- `apps/worker` — delivery processor and polling worker.
- `packages/contracts` — Zod request/domain contracts; no internal dependencies.
- `packages/core` — errors, ports, retry/state logic, cursors and transformations.
- `packages/database` — typed `pg` repository, migrations, transactions and locks.
- `packages/delivery` — isolated outbound HTTPS client and failure classification.
- `packages/config` — environment validation.
- `packages/observability` — structured logging field conventions/redaction metadata.

## Local development

Requirements: Node.js 22, pnpm 10, Docker, Git.

```bash
corepack enable
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate
pnpm --filter @relayforge/api dev
# in another terminal
pnpm --filter @relayforge/worker dev
```

No external API key is required to build or run RelayForge itself. Development database credentials in `docker-compose.yml` are local-only.

## API

Liveness and readiness:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

Create a destination:

```bash
curl -X POST http://localhost:3000/api/v1/destinations \
  -H 'Authorization: Bearer replace-me-for-local-development' \
  -H 'Content-Type: application/json' \
  -d '{"name":"warehouse","url":"https://example.invalid/webhook","enabled":true,"eventTypes":["invoice.paid"]}'
```

Create an idempotent event:

```bash
curl -X POST http://localhost:3000/api/v1/events \
  -H 'Authorization: Bearer replace-me-for-local-development' \
  -H 'Idempotency-Key: billing-INV-1024-paid' \
  -H 'Content-Type: application/json' \
  -d '{"type":"invoice.paid","source":"billing","payload":{"invoiceId":"INV-1024","amount":3999}}'
```

Other endpoints include event listing/filtering/cursor pagination, event details with delivery summary, destination enable/disable, event replay, dead-letter listing and one-time dead-letter replay.

## Verification

Fast local gate:

```bash
pnpm verify
```

Database gate (PostgreSQL required):

```bash
pnpm db:migrate
pnpm verify:migrations
pnpm test:integration
```

GitHub Actions runs both the static/unit/build profile and a real PostgreSQL integration profile on pull requests.

## Agent safety boundary

`AGENTS.md` is the human-readable operating contract. `.agent/policy.yaml` classifies safe, review-required and forbidden paths; `.agent/verification.yaml` is trusted verification configuration. `scripts/validate-agent-change.ts` rejects forbidden paths, traversal/symlink escapes, test deletion, obvious committed secrets and unrestricted shell-execution changes. Autonomous merge is outside the contract: draft pull requests are the maximum publication authority.

## Benchmark target

`benchmarks/tasks` contains issue-only historical-style tasks and no answer patches. The benchmark harness records automated outcomes separately from human review. Actual hidden evaluators and external agent runs must remain outside the coding agent's visible task context; public repository fixtures are not represented as hidden evidence.

RelayForge is designed to be targeted by the independent `Workflows-N8N` control plane, but the public repository works without n8n, Linear, or model credentials.

## Credential phases

RelayForge build: none beyond local PostgreSQL credentials. Direct external agent campaign: an OpenAI API key and narrowly scoped GitHub credential in the orchestration layer. Full Linear flow: additionally a Linear credential and relay secret; self-hosted n8n also needs `N8N_ENCRYPTION_KEY`. None belong in this repository.

## Claim boundary

This repository does **not** claim exactly-once delivery, enterprise readiness, zero data loss, comprehensive SSRF prevention, production scale, autonomous coding superiority, productivity gains, n8n adoption, or human reviewer satisfaction. Evidence and limitations are documented in `docs/R7_EVIDENCE.md` and the CI history.
