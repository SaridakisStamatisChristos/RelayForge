import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  PinnedHttpsTransport,
  UnsafeDestinationError,
  assertSafeDestinationUrl,
  isPublicIpAddress,
  resolvePublicDestinationAddress,
  type HttpsRequestFactory,
  type OutboundRequest,
} from '../src/index.js';

const blockedAddresses = [
  '0.0.0.0',
  '10.0.0.1',
  '100.100.100.200',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.1.1',
  '192.0.2.1',
  '198.18.0.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  '64:ff9b::a9fe:a9fe',
  'fc00::1',
  'fe80::1',
  'ff02::1',
  '2001:db8::1',
  '2002:7f00:1::',
  '3fff::1',
] as const;

async function expectUnsafe(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(UnsafeDestinationError);
}

describe('SSRF protection', () => {
  it('allows representative public IPv4 and IPv6 addresses', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('1.1.1.1')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicIpAddress('2001:4860:4860::8888')).toBe(true);
  });

  it('blocks private, metadata, and special IP ranges', () => {
    for (const address of blockedAddresses) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it('rejects localhost names and alternate IPv4 loopback forms', async () => {
    const resolver = vi.fn(async () => [{ address: '8.8.8.8', family: 4 as const }]);
    await expectUnsafe(resolvePublicDestinationAddress('localhost', resolver));
    await expectUnsafe(resolvePublicDestinationAddress('service.localhost', resolver));

    const normalized = assertSafeDestinationUrl('https://2130706433/hook');
    expect(normalized.hostname).toBe('127.0.0.1');
    await expectUnsafe(resolvePublicDestinationAddress(normalized.hostname, resolver));
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects mixed public and private DNS answers', async () => {
    const resolver = vi.fn(async () => [
      { address: '8.8.8.8', family: 4 as const },
      { address: '10.0.0.9', family: 4 as const },
    ]);
    await expectUnsafe(resolvePublicDestinationAddress('mixed.example', resolver));
  });

  it('rejects metadata-style IPv4 and IPv6 destinations', async () => {
    await expectUnsafe(resolvePublicDestinationAddress('169.254.169.254'));
    await expectUnsafe(resolvePublicDestinationAddress('fd00:ec2::254'));
  });

  it('provides Retry-After metadata without changing the pinned transport contract', async () => {
    const fakeRequest: OutboundRequest = {
      once: () => fakeRequest,
      end: () => undefined,
    };
    const requestFactory: HttpsRequestFactory = (_url, _options, onResponse) => {
      const response = {
        statusCode: 429,
        headers: { 'retry-after': '7' },
        resume() {
          return this;
        },
      } as unknown as IncomingMessage;
      onResponse(response);
      return fakeRequest;
    };
    const transport = new PinnedHttpsTransport({
      resolver: async () => [{ address: '8.8.8.8', family: 4 as const }],
      requestFactory,
    });
    const url = new URL('https://example.com/hook');
    expect(await transport.postJsonWithMetadata(url, '{}', 1_000)).toEqual({
      statusCode: 429,
      retryAfter: '7',
    });
    expect(await transport.postJson(url, '{}', 1_000)).toBe(429);
  });

  it('pins the validated DNS answer without a second resolution', async () => {
    let resolverCalls = 0;
    const resolver = vi.fn(async () => {
      resolverCalls += 1;
      return resolverCalls === 1
        ? [{ address: '8.8.8.8', family: 4 as const }]
        : [{ address: '10.0.0.9', family: 4 as const }];
    });

    let lookupAddress: string | undefined;
    let lookupFamily: number | undefined;
    let capturedAgent: boolean | undefined;
    const fakeRequest: OutboundRequest = {
      once: () => fakeRequest,
      end: () => undefined,
    };
    const requestFactory: HttpsRequestFactory = (_url, options, onResponse) => {
      capturedAgent = options.agent as boolean | undefined;
      const lookup = options.lookup;
      if (!lookup) throw new Error('expected pinned lookup');
      lookup('rebound.example', { all: false }, (error, address, family) => {
        if (error) throw error;
        if (typeof address !== 'string') throw new Error('expected one pinned address');
        lookupAddress = address;
        lookupFamily = family;
      });
      const response = {
        statusCode: 202,
        resume() {
          return this;
        },
      } as unknown as IncomingMessage;
      onResponse(response);
      return fakeRequest;
    };

    const transport = new PinnedHttpsTransport({ resolver, requestFactory });
    const statusCode = await transport.postJson(
      new URL('https://rebound.example/hook'),
      '{}',
      1_000,
    );

    expect(statusCode).toBe(202);
    expect(resolver).toHaveBeenCalledOnce();
    expect(lookupAddress).toBe('8.8.8.8');
    expect(lookupFamily).toBe(4);
    expect(capturedAgent).toBe(false);
  });
});
