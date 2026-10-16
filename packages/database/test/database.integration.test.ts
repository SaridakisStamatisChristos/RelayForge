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
  await pool.query(
    'TRUNCATE dead_letters, delivery_attempts, delivery_jobs, event_replays, destinations, events CASCADE',
  );
});
afterAll(async () => {
  await pool.end();
});

async function destination() {
  return store.createDestination({
    name: 'webhook',
    url: 'https://example.com/hook',
    enabled: true,
  });
}

describe('database invariants', () => {
  it('enforces sequential and concurrent idempotency in PostgreSQL', async () => {
    await destination();
    const input = {
      type: 'invoice.paid',
      source: 'billing',
      payload: { id: 1 },
      idempotencyKey: 'same-key',
    };
    const first = await store.createEvent(input);
    const second = await store.createEvent(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);

    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.createEvent({
          type: 'invoice.paid',
          source: 'billing',
          payload: { id: 2 },
          idempotencyKey: 'race-key',
        }),
      ),
    );
    expect(new Set(concurrent.map((result) => result.event.id)).size).toBe(1);
    const count = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM events WHERE idempotency_key = $1',
      ['race-key'],
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  it('rejects reusing an idempotency key for different content', async () => {
    await store.createEvent({ type: 'a', source: 's', payload: { x: 1 }, idempotencyKey: 'key' });
    await expect(
      store.createEvent({ type: 'a', source: 's', payload: { x: 2 }, idempotencyKey: 'key' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('creates jobs only for enabled destinations matching event-type filters', async () => {
    await store.createDestination({
      name: 'match',
      url: 'https://example.com/match',
      enabled: true,
      eventTypes: ['invoice.paid'],
    });
    await store.createDestination({
      name: 'other-type',
      url: 'https://example.com/other',
      enabled: true,
      eventTypes: ['invoice.failed'],
    });
    await store.createDestination({
      name: 'unfiltered',
      url: 'https://example.com/open',
      enabled: true,
    });
    await store.createDestination({
      name: 'disabled',
      url: 'https://example.com/disabled',
      enabled: false,
      eventTypes: ['invoice.paid'],
    });

    const created = await store.createEvent({
      type: 'invoice.paid',
      source: 'billing',
      payload: {},
    });
    expect(created.jobsCreated).toBe(2);
    const jobs = await pool.query<{ name: string }>(
      `SELECT d.name FROM delivery_jobs j
       JOIN destinations d ON d.id = j.destination_id
       WHERE j.event_id = $1 ORDER BY d.name`,
      [created.event.id],
    );
    expect(jobs.rows.map((row) => row.name)).toEqual(['match', 'unfiltered']);
  });

  it('rolls back event persistence when initial job creation fails', async () => {
    await destination();
    await pool.query(`
      CREATE OR REPLACE FUNCTION relayforge_test_fail_job_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced delivery job failure';
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER relayforge_test_fail_job_insert
      BEFORE INSERT ON delivery_jobs
      FOR EACH ROW EXECUTE FUNCTION relayforge_test_fail_job_insert()
    `);
    try {
      await expect(
        store.createEvent({ type: 'invoice.paid', source: 'rollback-test', payload: {} }),
      ).rejects.toThrow();
    } finally {
      await pool.query('DROP TRIGGER relayforge_test_fail_job_insert ON delivery_jobs');
      await pool.query('DROP FUNCTION relayforge_test_fail_job_insert()');
    }
    const count = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM events WHERE source = $1',
      ['rollback-test'],
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it('paginates events without duplicates across cursor pages', async () => {
    for (let index = 0; index < 5; index += 1) {
      await store.createEvent({ type: 'page.test', source: 'paging', payload: { index } });
    }
    const first = await store.listEvents({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    if (!first.nextCursor) throw new Error('expected first page cursor');
    const second = await store.listEvents({ limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((event) => event.id)).size).toBe(4);
  });

  it('claims one job once when workers race', async () => {
    await destination();
    await store.createEvent({ type: 'invoice.paid', source: 'billing', payload: {} });
    const claims = await Promise.all([
      store.claimDueJob(new Date()),
      store.claimDueJob(new Date()),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('persists attempts and dead letters atomically', async () => {
    await destination();
    const created = await store.createEvent({
      type: 'invoice.paid',
      source: 'billing',
      payload: {},
    });
    const claim = await store.claimDueJob(new Date());
    expect(claim).not.toBeNull();
    if (!claim) return;
    await store.markPermanentFailure(
      {
        jobId: claim.jobId,
        eventId: claim.event.id,
        destinationId: claim.destination.id,
        attemptNumber: claim.attemptNumber,
        outcome: 'permanent_failure',
        statusCode: 400,
        durationMs: 3,
      },
      'http_400',
    );
    const detail = await store.getEvent(created.event.id);
    expect(detail.delivery.attemptCount).toBe(1);
    expect(detail.delivery.deadLettered).toBe(1);
    expect(detail.event.status).toBe('dead_lettered');
  });

  it('replays a dead letter once and records replay provenance', async () => {
    await destination();
    await store.createEvent({ type: 'invoice.paid', source: 'billing', payload: {} });
    const claim = await store.claimDueJob(new Date());
    if (!claim) throw new Error('expected claim');
    await store.markPermanentFailure(
      {
        jobId: claim.jobId,
        eventId: claim.event.id,
        destinationId: claim.destination.id,
        attemptNumber: claim.attemptNumber,
        outcome: 'permanent_failure',
        statusCode: 400,
      },
      'http_400',
    );
    const deadLetters = await store.listDeadLetters({ limit: 50 });
    const deadLetter = deadLetters.items[0];
    if (!deadLetter) throw new Error('expected dead letter');
    const replay = await store.replayDeadLetter(deadLetter.id);
    expect(replay.jobId).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(store.replayDeadLetter(deadLetter.id)).rejects.toBeInstanceOf(ConflictError);
    const refreshed = await store.listDeadLetters({ limit: 50 });
    expect(refreshed.items[0]?.replayedAt).toBeInstanceOf(Date);
  });

  it('serializes duplicate event replay races', async () => {
    await destination();
    const created = await store.createEvent({
      type: 'invoice.paid',
      source: 'billing',
      payload: {},
    });
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
    const results = await Promise.allSettled([
      store.replayEvent(created.event.id),
      store.replayEvent(created.event.id),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
  });
});
