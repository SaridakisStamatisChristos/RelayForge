# Architecture

RelayForge is a small monorepo with one synchronous API process, one database-backed worker loop, and PostgreSQL as the only required infrastructure dependency.

## Dependency graph

`contracts` has no internal dependency. `core -> contracts`. `database -> core, contracts`. `delivery -> core, contracts, observability`. `config` and `observability` are leaf utilities. The API depends on contracts/core/database/config/observability; the worker additionally depends on delivery. `pnpm check:boundaries` scans internal imports and rejects cross-boundary relative escapes.

## Ingestion transaction

Event insertion and initial delivery-job creation occur in one PostgreSQL transaction. `events.idempotency_key` has a database unique index. A conflicting key is loaded and its semantic event content is compared; reuse for different content is rejected.

## Worker claim

Workers select a due job with `FOR UPDATE OF j SKIP LOCKED`, then change it to `processing`, increment `attempt_count`, and assign a bounded processing lease in the same transaction. Expired `processing` leases are reclaimable, so a worker crash cannot strand a job indefinitely. Legacy `processing` rows without a lease become reclaimable only after the same grace period. Terminal and retry writes are fenced by the claimed `attempt_count`, preventing an older worker from completing a job after a newer worker has reclaimed it.

## Delivery state machine

`pending -> processing -> delivered | retry_scheduled | dead_lettered`; `retry_scheduled -> processing`. Retry delays are deterministic, exponential and bounded. Attempts are immutable rows. Permanent or exhausted failures create a dead letter in the same transaction as the terminal job update. Delivery remains at-least-once: reclaiming an expired lease can repeat an outbound request when the previous worker's delivery result was unknown.

## Replay

Event replay row-locks the event and rejects replay while any active delivery job exists. It records `event_replays` provenance and creates fresh jobs for currently eligible destinations without mutating the original event payload. Dead-letter replay row-locks a dead letter, permits one replay, creates a fresh job and records `replayed_at` atomically.

## Health

`/health` is liveness only. `/ready` verifies the PostgreSQL dependency and returns 503 when the service cannot perform required work.
