import { describe, expect, it } from 'vitest';
import { createDestinationSchema, createEventSchema, eventListQuerySchema } from '../src/index.js';

describe('contracts', () => {
  it('rejects blank event type and non-JSON payloads', () => {
    expect(createEventSchema.safeParse({ type: ' ', source: 'x', payload: {} }).success).toBe(
      false,
    );
    expect(
      createEventSchema.safeParse({ type: 'x', source: 'x', payload: BigInt(1) }).success,
    ).toBe(false);
  });

  it('requires https destinations and non-empty event filters', () => {
    expect(
      createDestinationSchema.safeParse({ name: 'x', url: 'http://example.com', enabled: true })
        .success,
    ).toBe(false);
    expect(
      createDestinationSchema.safeParse({ name: 'x', url: 'https://example.com', enabled: true })
        .success,
    ).toBe(true);
    expect(
      createDestinationSchema.safeParse({
        name: 'x',
        url: 'https://example.com',
        enabled: true,
        eventTypes: [],
      }).success,
    ).toBe(false);
  });

  it('bounds pagination', () => {
    expect(eventListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(eventListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(eventListQuerySchema.parse({}).limit).toBe(20);
  });
});
