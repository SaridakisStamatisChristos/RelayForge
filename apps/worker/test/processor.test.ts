import { describe, expect, it } from 'vitest';
import type {
  ClaimedDelivery,
  DeliveryAttemptInput,
  WorkerStore,
} from '@relayforge/core';
import type { DeliveryClient, DeliveryResult } from '@relayforge/delivery';
import { DeliveryProcessor } from '../src/processor/processor.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const baseJob: ClaimedDelivery = {
  jobId: '11111111-1111-4111-8111-111111111111',
  attemptNumber: 1,
  event: {
    id: '22222222-2222-4222-8222-222222222222', type: 'invoice.paid', source: 'billing', payload: {},
    status: 'processing', createdAt: now, updatedAt: now,
  },
  destination: {
    id: '33333333-3333-4333-8333-333333333333', name: 'hook', url: 'https://example.com', enabled: true,
    createdAt: now, updatedAt: now,
  },
};

class FakeStore implements WorkerStore {
  delivered: DeliveryAttemptInput[] = [];
  retried: Array<{ attempt: DeliveryAttemptInput; next: Date }> = [];
  failed: Array<{ attempt: DeliveryAttemptInput; reason: string }> = [];
  constructor(private job: ClaimedDelivery | null) {}
  async claimDueJob(): Promise<ClaimedDelivery | null> { const value = this.job; this.job = null; return value; }
  async markDelivered(attempt: DeliveryAttemptInput): Promise<void> { this.delivered.push(attempt); }
  async scheduleRetry(attempt: DeliveryAttemptInput, next: Date): Promise<void> { this.retried.push({ attempt, next }); }
  async markPermanentFailure(attempt: DeliveryAttemptInput, reason: string): Promise<void> { this.failed.push({ attempt, reason }); }
}
class FakeDelivery implements DeliveryClient {
  constructor(private readonly result: DeliveryResult) {}
  async deliver(): Promise<DeliveryResult> { return this.result; }
}
const policy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000 };
const clock = { now: () => now };

describe('DeliveryProcessor', () => {
  it('completes successful deliveries', async () => {
    const store = new FakeStore(baseJob);
    const processor = new DeliveryProcessor(store, new FakeDelivery({ outcome: 'success', statusCode: 204, durationMs: 5 }), policy, clock);
    expect(await processor.processNext()).toBe(true);
    expect(store.delivered).toHaveLength(1);
  });

  it('schedules retryable failures using deterministic backoff', async () => {
    const store = new FakeStore(baseJob);
    const processor = new DeliveryProcessor(store, new FakeDelivery({ outcome: 'retryable_failure', statusCode: 503, durationMs: 5 }), policy, clock);
    await processor.processNext();
    expect(store.retried[0]?.next.toISOString()).toBe('2026-01-01T00:00:01.000Z');
  });

  it('dead-letters permanent responses', async () => {
    const store = new FakeStore(baseJob);
    await new DeliveryProcessor(store, new FakeDelivery({ outcome: 'permanent_failure', statusCode: 400, durationMs: 1 }), policy, clock).processNext();
    expect(store.failed[0]?.reason).toBe('http_400');
  });

  it('dead-letters after retry exhaustion instead of retrying forever', async () => {
    const store = new FakeStore({ ...baseJob, attemptNumber: 5 });
    await new DeliveryProcessor(store, new FakeDelivery({ outcome: 'retryable_failure', statusCode: 503, durationMs: 1 }), policy, clock).processNext();
    expect(store.retried).toHaveLength(0);
    expect(store.failed[0]?.reason).toBe('max_attempts_exhausted');
  });

  it('does not call outbound delivery for disabled destinations', async () => {
    const store = new FakeStore({ ...baseJob, destination: { ...baseJob.destination, enabled: false } });
    let calls = 0;
    const delivery: DeliveryClient = { deliver: async () => { calls += 1; return { outcome: 'success', durationMs: 0 }; } };
    await new DeliveryProcessor(store, delivery, policy, clock).processNext();
    expect(calls).toBe(0);
    expect(store.failed[0]?.reason).toBe('destination_disabled');
  });

  it('reports no work when no job is due', async () => {
    const store = new FakeStore(null);
    expect(await new DeliveryProcessor(store, new FakeDelivery({ outcome: 'success', durationMs: 0 }), policy, clock).processNext()).toBe(false);
  });
});
