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
    await expect(resolvePublicDestinationAddress('localhost', resolver)).rejects.toBeInstanceOf(
      UnsafeDestinationError,
    );
    await expect(
      resolvePublicDestinationAddress('service.localhost', resolver),
    ).rejects.toBeInstanceOf(UnsafeDestinationError);

    const normalized = assertSafeDestinationUrl('https://2130706433/hook');
    expect(normalized.hostname).toBe('127.0.0.1');
    await expect(
      resolvePublicDestinationAddress(normalized.hostname, resolver),
    ).rejects.toBeInstanceOf(UnsafeDestinationError);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects mixed public and private DNS answers', async () => {
    const resolver = vi.fn(async () => [
      { address: '8.8.8.8', family: 4 as const },
      { address: '10.0.0.9', family: 4 as const },
    ]);
    await expect(
      resolvePublicDestinationAddress('mixed.example', resolver),
    ).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it('rejects metadata-style IPv4 and IPv6 destinations', async () => {
    await expect(resolvePublicDestinationAddress('169.254.169.254')).rejects.toBeInstanceOf(
      UnsafeDestinationError,
    );
    await expect(resolvePublicDestinationAddress('fd00:ec2::254')).rejects.toBeInstanceOf(
      UnsafeDestinationError,
    );
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
      if (!options.lookup) throw new Error('expected pinned lookup');
      options.lookup('rebound.example', { all: false }, (error, address, family) => {
        if (error) throw error;
        if (typeof address !== 'string') throw new Error('expected one pinned address');
        lookupAddress = address;
        lookupFamily = family;
      });
      queueMicrotask(() =>
        onResponse(
          {
            statusCode: 202,
            resume() {
              return this;
            },
          } as unknown as IncomingMessage,
        ),
      );
      return fakeRequest;
    };

    const transport = new PinnedHttpsTransport({ resolver, requestFactory });
    await expect(
      transport.postJson(new URL('https://rebound.example/hook'), '{}', 1_000),
    ).resolves.toBe(202);

    expect(resolver).toHaveBeenCalledOnce();
    expect(lookupAddress).toBe('8.8.8.8');
    expect(lookupFamily).toBe(4);
    expect(capturedAgent).toBe(false);
  });
});
