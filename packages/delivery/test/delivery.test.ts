import { describe, expect, it, vi } from 'vitest';
import {
  HttpDeliveryClient,
  UnsafeDestinationError,
  assertSafeDestinationUrl,
  classifyNetworkError,
  classifyStatus,
  type DeliveryTransport,
} from '../src/index.js';

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'invoice.paid',
  source: 'billing',
  payload: { invoiceId: 'x' },
  status: 'pending' as const,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};
const destination = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'd',
  url: 'https://example.com/hook',
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('delivery classification', () => {
  it.each([
    [200, 'success'],
    [204, 'success'],
    [302, 'permanent_failure'],
    [400, 'permanent_failure'],
    [404, 'permanent_failure'],
    [408, 'retryable_failure'],
    [429, 'retryable_failure'],
    [503, 'retryable_failure'],
  ] as const)('classifies %s', (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });

  it('rejects unsafe destination URL forms', () => {
    expect(() => assertSafeDestinationUrl('http://example.com')).toThrow(UnsafeDestinationError);
    expect(() => assertSafeDestinationUrl('https://user:pass@example.com')).toThrow(
      UnsafeDestinationError,
    );
  });

  it('posts the transformed payload through the outbound transport', async () => {
    const postJson = vi.fn(async (_url: URL, body: string) => {
      expect(body).toContain('invoice.paid');
      return 202;
    });
    const transport: DeliveryTransport = { postJson };
    const client = new HttpDeliveryClient({ transport });
    const result = await client.deliver(event, destination);
    expect(result.outcome).toBe('success');
    expect(postJson).toHaveBeenCalledOnce();
  });

  it('treats network failures as retryable', async () => {
    const transport: DeliveryTransport = {
      postJson: vi.fn(async () => Promise.reject(new Error('boom'))),
    };
    const client = new HttpDeliveryClient({ transport });
    const result = await client.deliver(event, destination);
    expect(result.outcome).toBe('retryable_failure');
    expect(result.errorCode).toBe('NETWORK_ERROR');
  });

  it('treats outbound policy violations as permanent failures', async () => {
    const transport: DeliveryTransport = {
      postJson: vi.fn(async () =>
        Promise.reject(new UnsafeDestinationError('private destination')),
      ),
    };
    const client = new HttpDeliveryClient({ transport });
    const result = await client.deliver(event, destination);
    expect(result.outcome).toBe('permanent_failure');
    expect(result.errorCode).toBe('UNSAFE_DESTINATION');
  });

  it('classifies AbortSignal.timeout failures as retryable timeouts', async () => {
    const signal = AbortSignal.timeout(1);
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
    expect(classifyNetworkError(signal.reason)).toEqual({
      outcome: 'retryable_failure',
      errorCode: 'TIMEOUT',
    });
  });

  it('classifies explicit aborts as retryable timeouts', async () => {
    const transport: DeliveryTransport = {
      postJson: vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))),
    };
    const client = new HttpDeliveryClient({ transport });
    const result = await client.deliver(event, destination);
    expect(result.outcome).toBe('retryable_failure');
    expect(result.errorCode).toBe('TIMEOUT');
  });
});
