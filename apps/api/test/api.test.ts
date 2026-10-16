import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiStore,
  CreateEventResult,
  DeadLetterRecord,
  DestinationRecord,
  EventDetail,
  EventRecord,
  Page,
  ReplayResult,
} from '@relayforge/core';
import type {
  CreateDestinationInput,
  CreateEventInput,
  EventListQuery,
  PatchDestinationInput,
} from '@relayforge/contracts';
import { NotFoundError } from '@relayforge/core';
import { buildServer } from '../src/server.js';

class MemoryStore implements ApiStore {
  readonly events = new Map<string, EventRecord>();
  readonly destinations = new Map<string, DestinationRecord>();
  async ping(): Promise<void> {}
  async createEvent(input: CreateEventInput): Promise<CreateEventResult> {
    if (input.idempotencyKey) {
      const existing = [...this.events.values()].find(
        (event) => event.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { event: existing, created: false, jobsCreated: 0 };
    }
    const now = new Date();
    const event: EventRecord = {
      id: randomUUID(),
      type: input.type,
      source: input.source,
      payload: input.payload,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      status: 'accepted',
      createdAt: now,
      updatedAt: now,
    };
    this.events.set(event.id, event);
    return { event, created: true, jobsCreated: 0 };
  }
  async getEvent(id: string): Promise<EventDetail> {
    const event = this.events.get(id);
    if (!event) throw new NotFoundError('Event not found');
    return {
      event,
      delivery: {
        total: 0,
        pending: 0,
        processing: 0,
        retryScheduled: 0,
        delivered: 0,
        failed: 0,
        deadLettered: 0,
        attemptCount: 0,
      },
    };
  }
  async listEvents(query: EventListQuery): Promise<Page<EventRecord>> {
    const items = [...this.events.values()]
      .filter(
        (event) =>
          (!query.type || event.type === query.type) &&
          (!query.source || event.source === query.source) &&
          (!query.status || event.status === query.status),
      )
      .slice(0, query.limit);
    return { items };
  }
  async createDestination(input: CreateDestinationInput): Promise<DestinationRecord> {
    const now = new Date();
    const value: DestinationRecord = {
      id: randomUUID(),
      name: input.name,
      url: input.url,
      enabled: input.enabled,
      ...(input.eventTypes ? { eventTypes: input.eventTypes } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.destinations.set(value.id, value);
    return value;
  }
  async listDestinations(): Promise<DestinationRecord[]> {
    return [...this.destinations.values()];
  }
  async patchDestination(id: string, input: PatchDestinationInput): Promise<DestinationRecord> {
    const existing = this.destinations.get(id);
    if (!existing) throw new NotFoundError('Destination not found');
    const updated = { ...existing, enabled: input.enabled, updatedAt: new Date() };
    this.destinations.set(id, updated);
    return updated;
  }
  async replayEvent(): Promise<ReplayResult> {
    return { replayId: randomUUID(), jobsCreated: 0 };
  }
  async listDeadLetters(): Promise<Page<DeadLetterRecord>> {
    return { items: [] };
  }
  async replayDeadLetter(): Promise<{ jobId: string }> {
    return { jobId: randomUUID() };
  }
}

const token = 'test-token-12345';
let store: MemoryStore;
let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  store = new MemoryStore();
  app = buildServer({ store, authToken: token });
});
afterEach(async () => app.close());
const auth = { authorization: `Bearer ${token}` };

describe('API', () => {
  it('keeps liveness public and protects API routes', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/events' })).statusCode).toBe(401);
  });

  it('creates, filters, and retrieves events', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { ...auth, 'idempotency-key': 'evt-1' },
      payload: { type: 'invoice.paid', source: 'billing', payload: { id: 1 } },
    });
    expect(created.statusCode).toBe(202);
    const body = created.json<{ event: EventRecord }>();
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${body.event.id}`,
      headers: auth,
    });
    expect(detail.statusCode).toBe(200);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/events?source=billing',
      headers: auth,
    });
    expect(list.json<{ items: EventRecord[] }>().items).toHaveLength(1);
  });

  it('returns the existing event for duplicate idempotency keys', async () => {
    const request = {
      method: 'POST' as const,
      url: '/api/v1/events',
      headers: { ...auth, 'idempotency-key': 'evt-same' },
      payload: { type: 'x', source: 's', payload: {} },
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ created: boolean }>().created).toBe(false);
  });

  it('rejects malformed events and non-https destinations', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/events',
          headers: auth,
          payload: { type: '', source: 'x', payload: {} },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/destinations',
          headers: auth,
          payload: { name: 'd', url: 'http://example.com', enabled: true },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('creates and disables destinations', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/destinations',
      headers: auth,
      payload: { name: 'd', url: 'https://example.com', enabled: true },
    });
    const destination = created.json<DestinationRecord>();
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/destinations/${destination.id}`,
      headers: auth,
      payload: { enabled: false },
    });
    expect(patched.json<DestinationRecord>().enabled).toBe(false);
  });

  it('exposes event and dead-letter replay through protected HTTP routes', async () => {
    const eventReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${randomUUID()}/replay`,
      headers: auth,
    });
    expect(eventReplay.statusCode).toBe(202);
    expect(eventReplay.json<ReplayResult>().replayId).toMatch(/^[0-9a-f-]{36}$/u);

    const deadLetters = await app.inject({
      method: 'GET',
      url: '/api/v1/dead-letters',
      headers: auth,
    });
    expect(deadLetters.statusCode).toBe(200);
    expect(deadLetters.json<Page<DeadLetterRecord>>().items).toEqual([]);

    const deadLetterReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/dead-letters/${randomUUID()}/replay`,
      headers: auth,
    });
    expect(deadLetterReplay.statusCode).toBe(202);
    expect(deadLetterReplay.json<{ jobId: string }>().jobId).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
