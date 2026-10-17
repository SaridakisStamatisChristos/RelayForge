# RelayForge

RelayForge is a TypeScript/Node.js event-relay service for reliably accepting, persisting, and delivering application events to HTTPS webhook destinations. It decouples producers from outbound delivery, keeps retry and failure state durable in PostgreSQL, and exposes explicit replay and dead-letter controls instead of hiding failed work.

## Why RelayForge

Direct webhook delivery couples application requests to remote availability and makes failure recovery difficult to reason about. RelayForge moves that responsibility into a durable relay:

- producers submit events once with an idempotency key;
- PostgreSQL stores the event and creates delivery jobs transactionally;
- workers claim due jobs safely across concurrent processes;
- delivery outcomes are classified as success, transient failure, or permanent failure;
- transient failures are retried with bounded deterministic backoff;
- permanent or exhausted failures become dead letters;
- operators can inspect and replay failed work with provenance preserved.

RelayForge provides **at-least-once** delivery. It does not claim exactly-once semantics.

## Architecture

```mermaid
flowchart LR
  Producer["Event producer"] -->|"POST /api/v1/events"| API["Fastify API"]
  API --> Contracts["Zod contracts"]
  Contracts --> Core["Domain + retry rules"]
  Core --> DB["Database package"]
  DB --> PG[("PostgreSQL")]

  Worker["Delivery worker"] -->|"claim due job"| PG
  PG -->|"job + event + destination"| Worker
  Worker --> Delivery["HTTPS delivery client"]
  Delivery --> Destination["Webhook destination"]

  Destination -->|"2xx"| Delivered["Delivered"]
  Destination -->|"transient failure"| Retry["Retry scheduled"]
  Destination -->|"permanent / exhausted"| Dead["Dead letter"]

  Delivered --> DB
  Retry --> DB
  Dead --> DB
  Replay["Replay API"] --> DB

  Config["Validated configuration"] -.-> API
  Config -.-> Worker
  Observability["Structured logging + redaction"] -.-> API
  Observability -.-> Worker
```

PostgreSQL is the coordination boundary. Event idempotency is database-enforced, event creation and initial job creation share one transaction, workers claim jobs with transactional locking, attempts are recorded durably, and replay/dead-letter operations preserve provenance.

See [docs/architecture.md](docs/architecture.md) for the delivery state machine, worker lease behavior, replay semantics, and package dependency boundaries.

## Core capabilities

- **Idempotent event ingestion** with database uniqueness and semantic conflict detection.
- **Transactional fan-out** from an accepted event to eligible destination jobs.
- **Concurrent-safe worker claims** using PostgreSQL row locking and bounded processing leases.
- **Bounded retry policy** with deterministic exponential backoff.
- **Attempt history and dead letters** for permanent or exhausted delivery failures.
- **Controlled replay** for events and one-time dead-letter replay.
- **Destination filtering and enable/disable controls**.
- **Liveness and readiness endpoints** with database-backed readiness.
- **HTTPS destination validation and SSRF defenses** in the outbound delivery path.
- **Structured logging conventions and redaction metadata**.
- **Repository verification gates** for formatting, linting, types, package boundaries, secret scanning, tests, builds, migrations, and PostgreSQL integration.

## Repository layout

```text
apps/
  api/             Fastify HTTP API
  worker/          polling delivery worker
packages/
  config/          validated environment configuration
  contracts/       Zod API/domain contracts
  core/            domain types, ports, retry and state rules
  database/        PostgreSQL repository, migrations and locking
  delivery/        outbound HTTPS delivery and failure classification
  observability/   logging field conventions and redaction metadata
scripts/           repository verification and maintenance utilities
benchmarks/        development benchmark schemas, tasks and result tooling
docs/              architecture, operations, security, testing and development docs
```

The runtime packages intentionally remain separated. `pnpm check:boundaries` enforces the declared internal dependency graph.

## Requirements

- Node.js 22
- pnpm 10
- PostgreSQL 17-compatible server
- Docker and Docker Compose for the default local database workflow

## Local development

```bash
corepack enable
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate
pnpm --filter @relayforge/api dev
```

Start the worker in another terminal:

```bash
pnpm --filter @relayforge/worker dev
```

No external provider API key is required to build or run RelayForge. The credentials in `docker-compose.yml` are for local development only.

## Usage

### Health

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

`/health` reports process liveness. `/ready` verifies the PostgreSQL dependency and returns `503` when the service cannot perform required work.

### Create a destination

```bash
curl -X POST http://localhost:3000/api/v1/destinations \
  -H 'Authorization: Bearer replace-me-for-local-development' \
  -H 'Content-Type: application/json' \
  -d '{"name":"warehouse","url":"https://example.invalid/webhook","enabled":true,"eventTypes":["invoice.paid"]}'
```

### Submit an idempotent event

```bash
curl -X POST http://localhost:3000/api/v1/events \
  -H 'Authorization: Bearer replace-me-for-local-development' \
  -H 'Idempotency-Key: billing-INV-1024-paid' \
  -H 'Content-Type: application/json' \
  -d '{"type":"invoice.paid","source":"billing","payload":{"invoiceId":"INV-1024","amount":3999}}'
```

The API also supports event listing/filtering/cursor pagination, event details with delivery summaries, destination enable/disable, event replay, dead-letter listing, and one-time dead-letter replay.

## Testing and verification

Run the complete local static/unit/build gate:

```bash
pnpm verify
```

Run the PostgreSQL-backed verification profile:

```bash
pnpm db:migrate
pnpm verify:migrations
pnpm test:integration
```

GitHub Actions runs both profiles on pull requests. The CI workflow also generates a source manifest artifact for revision-level integrity evidence.

See [docs/testing.md](docs/testing.md) for test scope and [docs/development.md](docs/development.md) for repository safeguards and contribution workflow.

## Security

Protected API routes use a bearer token from `API_AUTH_TOKEN`. Destination URLs must use HTTPS, embedded credentials are rejected, redirects are disabled, DNS answers are validated, and outbound connections are pinned to validated resolution results.

These controls are defense in depth rather than a universal SSRF guarantee. See [docs/security.md](docs/security.md) for the implemented boundary and deployment assumptions.

## Operations

Operational behavior, worker recovery, migration rules, readiness semantics, and replay behavior are documented in [docs/operations.md](docs/operations.md).

## Current limitations

RelayForge intentionally does **not** claim:

- exactly-once delivery;
- production-scale capacity or a published throughput envelope;
- zero data loss under every infrastructure failure mode;
- universal SSRF prevention across arbitrary future transports or proxy configurations;
- enterprise identity, compliance certification, or production-readiness certification.

Delivery is at-least-once. A reclaimed job may repeat an outbound request when a previous worker delivered successfully but failed before persisting the outcome. Production deployments should add environment-appropriate backup/restore procedures, outbound egress controls, capacity validation, and operational monitoring.

## License

RelayForge is proprietary software. See [LICENSE](LICENSE) for the applicable terms.
