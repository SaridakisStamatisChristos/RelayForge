import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type {
  CreateDestinationInput,
  CreateEventInput,
  DeadLetterListQuery,
  EventListQuery,
  PatchDestinationInput,
} from '@relayforge/contracts';
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
  decodeCursor,
  encodeCursor,
  type ApiStore,
  type ClaimedDelivery,
  type CreateEventResult,
  type DeadLetterRecord,
  type DeliveryAttemptInput,
  type DestinationRecord,
  type EventDetail,
  type EventRecord,
  type Page,
  type ReplayResult,
  type WorkerStore,
} from '@relayforge/core';

interface EventRow extends QueryResultRow {
  id: string;
  type: string;
  source: string;
  payload: unknown;
  idempotency_key: string | null;
  status: EventRecord['status'];
  created_at: Date;
  updated_at: Date;
}
interface DestinationRow extends QueryResultRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  event_types: string[] | null;
  created_at: Date;
  updated_at: Date;
}
interface DeadLetterRow extends QueryResultRow {
  id: string;
  event_id: string;
  destination_id: string;
  reason: string;
  attempts: number;
  created_at: Date;
  replayed_at: Date | null;
}

function eventFromRow(row: EventRow): EventRecord {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    payload: row.payload,
    ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function destinationFromRow(row: DestinationRow): DestinationRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    ...(row.event_types === null ? {} : { eventTypes: row.event_types }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function deadLetterFromRow(row: DeadLetterRow): DeadLetterRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    destinationId: row.destination_id,
    reason: row.reason,
    attempts: row.attempts,
    createdAt: row.created_at,
    ...(row.replayed_at === null ? {} : { replayedAt: row.replayed_at }),
  };
}

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function refreshEventStatus(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `WITH s AS (
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE state IN ('pending','retry_scheduled','processing'))::int AS active,
        count(*) FILTER (WHERE state = 'processing')::int AS processing,
        count(*) FILTER (WHERE state = 'delivered')::int AS delivered,
        count(*) FILTER (WHERE state = 'dead_lettered')::int AS dead_lettered
      FROM delivery_jobs WHERE event_id = $1
    )
    UPDATE events e SET status = CASE
      WHEN s.total = 0 THEN 'accepted'
      WHEN s.active > 0 AND s.processing > 0 THEN 'processing'
      WHEN s.active > 0 THEN 'pending'
      WHEN s.delivered = s.total THEN 'delivered'
      WHEN s.delivered > 0 THEN 'partially_delivered'
      WHEN s.dead_lettered > 0 THEN 'dead_lettered'
      ELSE 'failed'
    END, updated_at = now()
    FROM s WHERE e.id = $1`,
    [eventId],
  );
}

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}

export class PostgresRelayStore implements ApiStore, WorkerStore {
  constructor(private readonly pool: Pool) {}

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async createEvent(input: CreateEventInput): Promise<CreateEventResult> {
    try {
      return await inTransaction(this.pool, async (client) => {
        const id = randomUUID();
        const inserted = await client.query<EventRow>(
          `INSERT INTO events(id, type, source, payload, idempotency_key, status)
           VALUES ($1, $2, $3, $4::jsonb, $5, 'accepted')
           ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
           RETURNING *`,
          [id, input.type, input.source, JSON.stringify(input.payload), input.idempotencyKey ?? null],
        );
        if (inserted.rowCount === 0) {
          if (!input.idempotencyKey) throw new DatabaseError('Event insert unexpectedly returned no row');
          const existing = await client.query<EventRow & { matches: boolean }>(
            `SELECT *, (type = $2 AND source = $3 AND payload = $4::jsonb) AS matches
             FROM events WHERE idempotency_key = $1`,
            [input.idempotencyKey, input.type, input.source, JSON.stringify(input.payload)],
          );
          const row = existing.rows[0];
          if (!row) throw new DatabaseError('Idempotency conflict row could not be loaded');
          if (!row.matches) throw new ConflictError('Idempotency key was already used for a different event');
          return { event: eventFromRow(row), created: false, jobsCreated: 0 };
        }

        const row = inserted.rows[0];
        if (!row) throw new DatabaseError('Inserted event could not be loaded');
        const destinations = await client.query<DestinationRow>(
          `SELECT * FROM destinations
           WHERE enabled = TRUE AND (event_types IS NULL OR event_types @> jsonb_build_array($1::text))
           ORDER BY created_at, id`,
          [input.type],
        );
        for (const destination of destinations.rows) {
          await client.query(
            `INSERT INTO delivery_jobs(id, event_id, destination_id, state)
             VALUES ($1, $2, $3, 'pending')`,
            [randomUUID(), row.id, destination.id],
          );
        }
        if (destinations.rowCount > 0) await refreshEventStatus(client, row.id);
        const refreshed = await client.query<EventRow>('SELECT * FROM events WHERE id = $1', [row.id]);
        return {
          event: eventFromRow(refreshed.rows[0] ?? row),
          created: true,
          jobsCreated: destinations.rowCount ?? 0,
        };
      });
    } catch (error) {
      if (error instanceof ConflictError || error instanceof DatabaseError) throw error;
      throw new DatabaseError(error instanceof Error ? error.message : 'Failed to create event');
    }
  }

  async getEvent(id: string): Promise<EventDetail> {
    const event = await this.pool.query<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
    const row = event.rows[0];
    if (!row) throw new NotFoundError('Event not found');
    const summary = await this.pool.query<{
      total: number;
      pending: number;
      processing: number;
      retry_scheduled: number;
      delivered: number;
      failed: number;
      dead_lettered: number;
      attempt_count: number;
    }>(
      `SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE state = 'pending')::int AS pending,
        count(*) FILTER (WHERE state = 'processing')::int AS processing,
        count(*) FILTER (WHERE state = 'retry_scheduled')::int AS retry_scheduled,
        count(*) FILTER (WHERE state = 'delivered')::int AS delivered,
        count(*) FILTER (WHERE state = 'permanent_failure')::int AS failed,
        count(*) FILTER (WHERE state = 'dead_lettered')::int AS dead_lettered,
        COALESCE(sum(attempt_count), 0)::int AS attempt_count
       FROM delivery_jobs WHERE event_id = $1`,
      [id],
    );
    const s = summary.rows[0];
    if (!s) throw new DatabaseError('Could not summarize event deliveries');
    return {
      event: eventFromRow(row),
      delivery: {
        total: s.total,
        pending: s.pending,
        processing: s.processing,
        retryScheduled: s.retry_scheduled,
        delivered: s.delivered,
        failed: s.failed,
        deadLettered: s.dead_lettered,
        attemptCount: s.attempt_count,
      },
    };
  }

  async listEvents(query: EventListQuery): Promise<Page<EventRecord>> {
    const values: unknown[] = [];
    const where: string[] = [];
    const add = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (query.type) where.push(`type = ${add(query.type)}`);
    if (query.source) where.push(`source = ${add(query.source)}`);
    if (query.status) where.push(`status = ${add(query.status)}`);
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      const createdRef = add(cursor.createdAt);
      const idRef = add(cursor.id);
      where.push(`(created_at, id) < (${createdRef}, ${idRef}::uuid)`);
    }
    const limitRef = add(query.limit + 1);
    const result = await this.pool.query<EventRow>(
      `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC LIMIT ${limitRef}`,
      values,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(eventFromRow),
      ...(hasMore && last ? { nextCursor: encodeCursor(last.created_at, last.id) } : {}),
    };
  }

  async createDestination(input: CreateDestinationInput): Promise<DestinationRecord> {
    const result = await this.pool.query<DestinationRow>(
      `INSERT INTO destinations(id, name, url, enabled, event_types)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [randomUUID(), input.name, input.url, input.enabled, input.eventTypes ? JSON.stringify(input.eventTypes) : null],
    );
    const row = result.rows[0];
    if (!row) throw new DatabaseError('Destination insert returned no row');
    return destinationFromRow(row);
  }

  async listDestinations(): Promise<DestinationRecord[]> {
    const result = await this.pool.query<DestinationRow>('SELECT * FROM destinations ORDER BY created_at, id');
    return result.rows.map(destinationFromRow);
  }

  async patchDestination(id: string, input: PatchDestinationInput): Promise<DestinationRecord> {
    const result = await this.pool.query<DestinationRow>(
      'UPDATE destinations SET enabled = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [id, input.enabled],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Destination not found');
    return destinationFromRow(row);
  }

  async replayEvent(id: string): Promise<ReplayResult> {
    return inTransaction(this.pool, async (client) => {
      const event = await client.query<EventRow>('SELECT * FROM events WHERE id = $1 FOR UPDATE', [id]);
      const row = event.rows[0];
      if (!row) throw new NotFoundError('Event not found');
      const active = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM delivery_jobs
         WHERE event_id = $1 AND state IN ('pending','processing','retry_scheduled')`,
        [id],
      );
      if ((active.rows[0]?.count ?? 0) > 0) {
        throw new ConflictError('Event already has active delivery jobs');
      }
      const replayId = randomUUID();
      await client.query('INSERT INTO event_replays(id, event_id) VALUES ($1, $2)', [replayId, id]);
      const destinations = await client.query<DestinationRow>(
        `SELECT * FROM destinations WHERE enabled = TRUE
         AND (event_types IS NULL OR event_types @> jsonb_build_array($1::text)) ORDER BY created_at, id`,
        [row.type],
      );
      for (const destination of destinations.rows) {
        await client.query(
          `INSERT INTO delivery_jobs(id, event_id, destination_id, replay_id, state)
           VALUES ($1, $2, $3, $4, 'pending')`,
          [randomUUID(), id, destination.id, replayId],
        );
      }
      await refreshEventStatus(client, id);
      return { replayId, jobsCreated: destinations.rowCount ?? 0 };
    });
  }

  async listDeadLetters(query: DeadLetterListQuery): Promise<Page<DeadLetterRecord>> {
    const values: unknown[] = [];
    let where = '';
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      values.push(cursor.createdAt, cursor.id);
      where = 'WHERE (created_at, id) < ($1, $2::uuid)';
    }
    values.push(query.limit + 1);
    const limitRef = `$${values.length}`;
    const result = await this.pool.query<DeadLetterRow>(
      `SELECT * FROM dead_letters ${where} ORDER BY created_at DESC, id DESC LIMIT ${limitRef}`,
      values,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(deadLetterFromRow),
      ...(hasMore && last ? { nextCursor: encodeCursor(last.created_at, last.id) } : {}),
    };
  }

  async replayDeadLetter(id: string): Promise<{ jobId: string }> {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<DeadLetterRow & { enabled: boolean }>(
        `SELECT dl.*, d.enabled FROM dead_letters dl
         JOIN destinations d ON d.id = dl.destination_id
         WHERE dl.id = $1 FOR UPDATE OF dl`,
        [id],
      );
      const deadLetter = result.rows[0];
      if (!deadLetter) throw new NotFoundError('Dead letter not found');
      if (deadLetter.replayed_at) throw new ConflictError('Dead letter was already replayed');
      if (!deadLetter.enabled) throw new ConflictError('Destination is disabled');
      const jobId = randomUUID();
      await client.query(
        `INSERT INTO delivery_jobs(id, event_id, destination_id, state)
         VALUES ($1, $2, $3, 'pending')`,
        [jobId, deadLetter.event_id, deadLetter.destination_id],
      );
      await client.query('UPDATE dead_letters SET replayed_at = now() WHERE id = $1', [id]);
      await refreshEventStatus(client, deadLetter.event_id);
      return { jobId };
    });
  }

  async claimDueJob(now: Date): Promise<ClaimedDelivery | null> {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<
        QueryResultRow & {
          job_id: string;
          attempt_count: number;
          event_id: string;
          event_type: string;
          event_source: string;
          event_payload: unknown;
          event_idempotency_key: string | null;
          event_status: EventRecord['status'];
          event_created_at: Date;
          event_updated_at: Date;
          destination_id: string;
          destination_name: string;
          destination_url: string;
          destination_enabled: boolean;
          destination_event_types: string[] | null;
          destination_created_at: Date;
          destination_updated_at: Date;
        }
      >(
        `SELECT
          j.id AS job_id, j.attempt_count,
          e.id AS event_id, e.type AS event_type, e.source AS event_source, e.payload AS event_payload,
          e.idempotency_key AS event_idempotency_key, e.status AS event_status,
          e.created_at AS event_created_at, e.updated_at AS event_updated_at,
          d.id AS destination_id, d.name AS destination_name, d.url AS destination_url,
          d.enabled AS destination_enabled, d.event_types AS destination_event_types,
          d.created_at AS destination_created_at, d.updated_at AS destination_updated_at
         FROM delivery_jobs j
         JOIN events e ON e.id = j.event_id
         JOIN destinations d ON d.id = j.destination_id
         WHERE j.state IN ('pending','retry_scheduled')
           AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= $1)
         ORDER BY COALESCE(j.next_attempt_at, j.created_at), j.created_at, j.id
         FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
        [now],
      );
      const row = result.rows[0];
      if (!row) return null;
      const updated = await client.query<{ attempt_count: number }>(
        `UPDATE delivery_jobs SET state = 'processing', attempt_count = attempt_count + 1, updated_at = now()
         WHERE id = $1 RETURNING attempt_count`,
        [row.job_id],
      );
      await refreshEventStatus(client, row.event_id);
      return {
        jobId: row.job_id,
        attemptNumber: updated.rows[0]?.attempt_count ?? row.attempt_count + 1,
        event: eventFromRow({
          id: row.event_id,
          type: row.event_type,
          source: row.event_source,
          payload: row.event_payload,
          idempotency_key: row.event_idempotency_key,
          status: row.event_status,
          created_at: row.event_created_at,
          updated_at: row.event_updated_at,
        }),
        destination: destinationFromRow({
          id: row.destination_id,
          name: row.destination_name,
          url: row.destination_url,
          enabled: row.destination_enabled,
          event_types: row.destination_event_types,
          created_at: row.destination_created_at,
          updated_at: row.destination_updated_at,
        }),
      };
    });
  }

  private async recordAttempt(client: PoolClient, attempt: DeliveryAttemptInput): Promise<void> {
    await client.query(
      `INSERT INTO delivery_attempts(
        id, delivery_job_id, event_id, destination_id, attempt_number, status_code, outcome, error_code, duration_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        attempt.jobId,
        attempt.eventId,
        attempt.destinationId,
        attempt.attemptNumber,
        attempt.statusCode ?? null,
        attempt.outcome,
        attempt.errorCode ?? null,
        attempt.durationMs ?? null,
      ],
    );
  }

  async markDelivered(attempt: DeliveryAttemptInput): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await this.recordAttempt(client, attempt);
      const updated = await client.query(
        `UPDATE delivery_jobs SET state = 'delivered', next_attempt_at = NULL, updated_at = now()
         WHERE id = $1 AND state = 'processing'`,
        [attempt.jobId],
      );
      if (updated.rowCount !== 1) throw new ConflictError('Delivery job is not processing');
      await refreshEventStatus(client, attempt.eventId);
    });
  }

  async scheduleRetry(attempt: DeliveryAttemptInput, nextAttemptAt: Date): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await this.recordAttempt(client, attempt);
      const updated = await client.query(
        `UPDATE delivery_jobs SET state = 'retry_scheduled', next_attempt_at = $2, updated_at = now()
         WHERE id = $1 AND state = 'processing'`,
        [attempt.jobId, nextAttemptAt],
      );
      if (updated.rowCount !== 1) throw new ConflictError('Delivery job is not processing');
      await refreshEventStatus(client, attempt.eventId);
    });
  }

  async markPermanentFailure(attempt: DeliveryAttemptInput, reason: string): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await this.recordAttempt(client, attempt);
      const updated = await client.query(
        `UPDATE delivery_jobs SET state = 'dead_lettered', next_attempt_at = NULL, updated_at = now()
         WHERE id = $1 AND state = 'processing'`,
        [attempt.jobId],
      );
      if (updated.rowCount !== 1) throw new ConflictError('Delivery job is not processing');
      await client.query(
        `INSERT INTO dead_letters(id, delivery_job_id, event_id, destination_id, reason, attempts)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), attempt.jobId, attempt.eventId, attempt.destinationId, reason, attempt.attemptNumber],
      );
      await refreshEventStatus(client, attempt.eventId);
    });
  }
}
