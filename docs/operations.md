# Operations

## Start

1. Start PostgreSQL (`docker compose up -d postgres`).
2. Apply migrations (`pnpm db:migrate`).
3. Start API and worker independently.

## Readiness

Use `/health` for process liveness and `/ready` for database-backed readiness. A database outage leaves liveness up but readiness at 503.

## Worker

The worker polls due jobs. It processes one claim at a time per process; horizontal worker concurrency is safe because claims use PostgreSQL row locking with `SKIP LOCKED`. Each `processing` claim carries a bounded lease. If a worker exits or loses database connectivity after claiming, another worker can reclaim the job after the lease expires. The attempt number fences stale workers from committing an outcome after a reclaim.

## Recovery

Migrations are forward-only in this initial release. Before changing an applied migration, add a new migration instead; checksum verification rejects drift. Migration execution is serialized with a PostgreSQL advisory lock so concurrent startup migration runners cannot apply the same migration simultaneously. Backup/restore and destructive downgrade procedures are deployment-specific and are not claimed by this repository.

Dead letters can be inspected and replayed once through the API. Event replay is refused while active jobs exist, preventing duplicate replay races. Delivery is at-least-once rather than exactly-once, so an expired processing lease may result in a repeated outbound request when the previous attempt's outcome was unknown.
