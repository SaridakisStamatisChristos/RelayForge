# Operations

## Start

1. Start PostgreSQL (`docker compose up -d postgres`).
2. Apply migrations (`pnpm db:migrate`).
3. Start API and worker independently.

## Readiness

Use `/health` for process liveness and `/ready` for database-backed readiness. A database outage leaves liveness up but readiness at 503.

## Worker

The worker polls due jobs. It processes one claim at a time per process; horizontal worker concurrency is safe because claims use PostgreSQL row locking with `SKIP LOCKED`.

## Recovery

Migrations are forward-only in this initial release. Before changing an applied migration, add a new migration instead; checksum verification rejects drift. Backup/restore and destructive downgrade procedures are deployment-specific and are not claimed by this repository.

Dead letters can be inspected and replayed once through the API. Event replay is refused while active jobs exist, preventing duplicate replay races.
