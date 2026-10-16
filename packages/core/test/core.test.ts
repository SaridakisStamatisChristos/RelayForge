import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  assertJobTransition,
  calculateRetryDelayMs,
  decodeCursor,
  encodeCursor,
  eventMatchesDestination,
} from '../src/index.js';

const policy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000 };

describe('retry policy', () => {
  it('is deterministic and bounded', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => calculateRetryDelayMs(attempt, policy))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000,
    ]);
    expect(calculateRetryDelayMs(20, policy)).toBe(60_000);
  });
});

describe('job transitions', () => {
  it('accepts legal transitions and rejects illegal ones', () => {
    expect(() => assertJobTransition('pending', 'processing')).not.toThrow();
    expect(() => assertJobTransition('delivered', 'processing')).toThrow();
  });
});

describe('cursor', () => {
  it('round-trips and rejects malformed cursors', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(decodeCursor(encodeCursor(date, 'abc'))).toEqual({ createdAt: date, id: 'abc' });
    expect(() => decodeCursor('not-a-cursor')).toThrow(ValidationError);
  });
});

describe('destination filtering', () => {
  const base = {
    id: 'd',
    name: 'd',
    url: 'https://example.com',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  it('respects enabled flag and event filters', () => {
    expect(eventMatchesDestination('a', base)).toBe(true);
    expect(eventMatchesDestination('a', { ...base, enabled: false })).toBe(false);
    expect(eventMatchesDestination('a', { ...base, eventTypes: ['b'] })).toBe(false);
    expect(eventMatchesDestination('a', { ...base, eventTypes: ['a'] })).toBe(true);
  });
});
