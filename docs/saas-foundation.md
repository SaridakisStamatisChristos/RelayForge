# SaaS foundation assessment — 2026-10-19

This document records a **two-axis assessment**, not a claim that RelayForge is a multi-tenant or commercial SaaS today. The existing deployment is a single-operator, self-hostable service with one environment-scoped API token. The intended future product shape is an event-relay service usable by independent customers, but no specific buyer, merchant, pricing, IdP, sending domain or customer accounts are confirmed. The SaaSCore invocation supports exploring this evolution; it does not itself authorize a tenant migration.

## Existing mechanisms to reuse

- `apps/api/src/server.ts` and `apps/api/src/auth/api-key.ts`: one deployment-level bearer token, not per-customer credentials or resource authorization.
- `packages/database/migrations/001_initial.sql`: global `events`, `destinations`, `delivery_jobs`, `delivery_attempts`, `dead_letters` and `event_replays`. Idempotency keys are globally unique. **Do not expose these records as customer data until ownership is enforced end-to-end.**
- `packages/database/src/index.ts`: durable transaction/locking and replay state. Reuse the PostgreSQL source of truth rather than introducing another queue.
- `packages/delivery/src/index.ts`, `apps/worker/src/processor/processor.ts`: outbound HTTPS SSRF protection, deterministic retries, and bounded handling of a destination's `Retry-After` response hints (this branch).
- `/health` and `/ready` provide process/dependency signals, not a production restore/SLO qualification.

## Module decisions (present need / potential evolution)

- **Identity / authorization — REVIEW_REQUIRED.** The single operator token exists, but customer-scoped workload identity would require protected auth and reviewed database changes.
- **Users / organizations — REVIEW_REQUIRED.** Introduce only for confirmed separately owned customers; avoid speculative signup workflows.
- **Durable jobs / webhooks — REUSE and IMPLEMENT_NOW.** Preserve PostgreSQL as the source of truth and add bounded HTTP retry hints.
- **Usage / entitlements — DEFER_EXTERNAL.** No agreed consumption unit, enforcement model or paid plan.
- **Billing — DEFER_EXTERNAL.** Merchant, product pricing and tax decisions remain unconfirmed; no live charges.
- **Email — NOT_APPLICABLE.** No demonstrated recipient flow or authorized sender.
- **Administration / audit — REVIEW_REQUIRED.** Customer-scoped replay and privileged access require a verified principal and resource authority.
- **Operations / privacy — RECOMMENDED_LATER.** Hosted deployments require backup/restore qualification and explicit retention, export and deletion workflows.

## Protected changes: owner-review implementation contract

Repository governance in `AGENTS.md` and `.agent/policy.yaml` **forbids autonomous edits** under `apps/api/src/auth/**` and requires human review before modifications to `packages/database/migrations/**`, `packages/config/**` or CI. Neither these controls nor CODEOWNERS have been modified.

When the owner explicitly approves a customer-scoped SaaS architecture, prepare a separate PR with:

1. **Customer model first.** Decide whether remote customers are individual machine accounts, team workspaces, or isolated installations. Define authoritative workload principals, credential issuance/revocation, service actor privileges, tenant/account ownership, and migration owner before changing routes.
2. **Database isolation, forward only.** Introduce owners for events, destinations and all dependent jobs, attempts, replays and dead letters through reviewed additive migrations. Replace global idempotency uniqueness with an appropriate owner-scoped uniqueness contract only after compatibility analysis. Existing global records must remain quarantined or explicitly mapped by an owner-approved migration; never assign them to an arbitrary customer.
3. **Enforce at every boundary.** Authenticated create/read/list/filter/update/replay must scope database access. Cross-owner destinations must never receive events, including worker fan-out, lease reclaim, replay, export or callback paths. Where shared storage is chosen, independently validate database-level tenant isolation in addition to handler checks.
4. **Adversarial test gate.** Create at least two accounts/tenants with colliding idempotency keys and overlapping event types. Prove no cross-account read/list/pagination/replay/patch/fan-out/job claim or administrative mutation. Forge account IDs/claims, revoke credentials, race duplicate writes and test worker restarts and legacy unowned rows. Require zero foreign deliveries and zero foreign mutations.
5. **Opt-in cutover and rollback.** Existing operator mode stays the default until end-to-end tests, migration rehearsal, secrets ownership, reconciliation and independent security review are complete. Rollback must not silently drop ownership fields, redirect deliveries or re-expose historical data.

## Compatibility and deployment gate

This branch does **not** change API authentication, schema, credentials, worker lease/attempt semantics, pricing, providers, queues, emails or live external integrations. Legacy `DeliveryTransport.postJson()` remains status-only; a transport that implements `postJsonWithMetadata()` can supply `Retry-After` for a retryable response. Retry instructions never shorten the exponential backoff or bypass maximum attempts; delays are capped by the existing max-delay policy.

Code verification requires the repository's approved `.agent/verification.yaml` commands and positive/adversarial HTTP tests. A green mock/CI result does not establish production reliability or customer isolation. External delivery retains at-least-once semantics. No deployment, merchant setup, production customer data conversion, billing or email activation is authorized by this PR.
