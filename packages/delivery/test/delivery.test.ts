import { describe, expect, it, vi } from 'vitest';
import { HttpDeliveryClient, assertSafeDestinationUrl, classifyStatus } from '../src/index.js';

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
    [400, 'permanent_failure'],
    [404, 'permanent_failure'],
    [408, 'retryable_failure'],
    [429, 'retryable_failure'],
    [503, 'retryable_failure'],
  ] as const)('classifies %s', (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });

  it('rejects unsafe destination URL forms', () => {
    expect(() => assertSafeDestinationUrl('http://example.com')).toThrow();
    expect(() => assertSafeDestinationUrl('https://user:pass@example.com')).toThrow();
  });

  it('posts transformed payload without redirect following', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 202 }));
    const client = new HttpDeliveryClient({ fetchFn });
    const result = await client.deliver(event, destination);
    expect(result.outcome).toBe('success');
    expect(fetchFn).toHaveBeenCalledOnce();
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('error');
    expect(init?.body).toContain('invoice.paid');
  });

  it('treats network failures as retryable', async () => {
    const client = new HttpDeliveryClient({
      fetchFn: vi.fn(async () => Promise.reject(new Error('boom'))),
    });
    const result = await client.deliver(event, destination);
    expect(result.outcome).toBe('retryable_failure');
    expect(result.errorCode).toBe('NETWORK_ERROR');
  });
});
