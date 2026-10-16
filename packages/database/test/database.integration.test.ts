import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '@relayforge/core';
import { PostgresRelayStore } from '../src/index.js';
import { migrate, verifyAppliedMigrations } from '../src/migrations.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const store = new PostgresRelayStore(pool);

beforeAll(async () => {
  await migrate(pool);
  await verifyAppliedMigrations(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE dead_letters, delivery_attempts, delivery_jobs, event_replays, destinations, events CASCADE');
});
afterAll(async () => {
  await pool.end();
});

async function destination() {
  return store.createDestination({ name: 'webhook', url: 'https://example.com/hook', enabled: true });
}

describe('database invariants', () => {
  it('enforces sequential and concurrent idempotency in PostgreSQL', async () => {
    await destination();
    const input = { type: 'invoice.paid', source: 'billing', payload: { id: 1 }, idempotencyKey: 'same-key' };
    const first = await store.createEvent(input);
    const second = await store.createEvent(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);

    const concurrent = await Promise.all(Array.from({ length: 8 }, () => store.createEvent({
      type: 'invoice.paid', source: 'billing', payload: { id: 2 }, idempotencyKey: 'race-key',
    })));
    expect(new Set(concurrent.map((result) => result.event.id)).size).toBe(1);
    const count = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM events WHERE idempotency_key = $1', ['race-key']);
    expect(count.rows[0]?.count).toBe(1);
  });

  it('rejects reusing an idempotency key for different content', async () => {
    await store.createEvent({ type: 'a', source: 's', payload: { x: 1 }, idempotencyKey: 'key' });
    await expect(store.createEvent({ type: 'a', source: 's', payload: { x: 2 }, idempotencyKey: 'key' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('claims one job once when workers race', async () => {
    await destination();
    await store.createEvent({ type: 'invoice.paid', source: 'billing', payload: {} });
    const claims = await Promise.all([store.claimDueJob(new Date()), store.claimDueJob(new Date())]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('persists attempts and dead letters atomically', async () => {
    await destination();
    const created = await store.createEvent({ type: 'invoice.paid', source: 'billing', payload: {} });
    const claim = await store.claimDueJob(new Date());
    expect(claim).not.toBeNull();
    if (!claim) return;
    await store.markPermanentFailure({
      jobId: claim.jobId,
      eventId: claim.event.id,
      destinationId: claim.destination.id,
      attemptNumber: claim.attemptNumber,
      outcome: 'permanent_failure',
      statusCode: 400,
      durationMs: 3,
    }, 'http_400');
    const detail = await store.getEvent(created.event.id);
    expect(detail.delivery.attemptCount).toBe(1);
    expect(detail.delivery.deadLettered).toBe(1);
    expect(detail.event.status).toBe('dead_lettered');
  });

  it('serializes duplicate event replay races', async () => {
    await destination();
    const created = await store.createEvent({ type: 'invoice.paid', source: 'billing', payload: {} });
    const claim = await store.claimDueJob(new Date());
    if (!claim) throw new Error('expected claim');
    await store.markDelivered({
      jobId: claim.jobId,
      eventId: claim.event.id,
      destinationId: claim.destination.id,
      attemptNumber: claim.attemptNumber,
      outcome: 'success',
      statusCode: 200,
    });
    const results = await Promise.allSettled([store.replayEvent(created.event.id), store.replayEvent(created.event.id)]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
  });
});
