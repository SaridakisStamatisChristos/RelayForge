import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { DeliveryOutcome } from '@relayforge/contracts';
import type { DestinationRecord, EventRecord } from '@relayforge/core';
import { transformPayload } from '@relayforge/core';

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  statusCode?: number;
  errorCode?: string;
  durationMs: number;
}

export interface DeliveryClient {
  deliver(event: EventRecord, destination: DestinationRecord): Promise<DeliveryResult>;
}

export class UnsafeDestinationError extends Error {
  constructor(message = 'Destination is not permitted by the outbound network policy') {
    super(message);
    this.name = 'UnsafeDestinationError';
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type DestinationResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const retryableStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504]);

const ipv4DeniedCidrs = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const;

const ipv6DeniedCidrs = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const;

export function classifyStatus(statusCode: number): DeliveryOutcome {
  if (statusCode >= 200 && statusCode <= 299) return 'success';
  if (retryableStatusCodes.has(statusCode)) return 'retryable_failure';
  if (statusCode >= 400 && statusCode <= 499) return 'permanent_failure';
  if (statusCode >= 500 && statusCode <= 599) return 'retryable_failure';
  return 'permanent_failure';
}

export function classifyNetworkError(error: unknown): {
  outcome: 'retryable_failure' | 'permanent_failure';
  errorCode: string;
} {
  if (error instanceof UnsafeDestinationError) {
    return { outcome: 'permanent_failure', errorCode: 'UNSAFE_DESTINATION' };
  }
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return { outcome: 'retryable_failure', errorCode: 'TIMEOUT' };
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'NETWORK_ERROR';
  return { outcome: 'retryable_failure', errorCode: code };
}

export function assertSafeDestinationUrl(rawUrl: string, allowHttpForTests = false): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && !(allowHttpForTests && url.protocol === 'http:')) {
    throw new UnsafeDestinationError('Destination URL must use https://');
  }
  if (url.username || url.password) {
    throw new UnsafeDestinationError('Destination URL must not contain credentials');
  }
  return url;
}

function unwrapIpv6Brackets(address: string): string {
  return address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function ipv4InCidr(address: number, baseAddress: string, prefixLength: number): boolean {
  const base = ipv4ToNumber(baseAddress);
  if (base === null) return false;
  const blockSize = 2 ** (32 - prefixLength);
  return Math.floor(address / blockSize) === Math.floor(base / blockSize);
}

function canonicalizeIpv6(address: string): string | null {
  try {
    const url = new URL(`http://[${unwrapIpv6Brackets(address)}]/`);
    return unwrapIpv6Brackets(url.hostname);
  } catch {
    return null;
  }
}

function ipv6ToBigInt(address: string): bigint | null {
  const canonical = canonicalizeIpv6(address);
  if (!canonical || isIP(canonical) !== 6) return null;
  const halves = canonical.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if ((halves.length === 1 && left.length !== 8) || missing < 0) return null;
  const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (parts.length !== 8) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/iu.test(part)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(part, 16));
  }
  return value;
}

function ipv6InCidr(address: bigint, baseAddress: string, prefixLength: number): boolean {
  const base = ipv6ToBigInt(baseAddress);
  if (base === null) return false;
  const shift = BigInt(128 - prefixLength);
  return address >> shift === base >> shift;
}

export function isPublicIpAddress(rawAddress: string): boolean {
  const address = unwrapIpv6Brackets(rawAddress);
  const family = isIP(address);
  if (family === 4) {
    const numeric = ipv4ToNumber(address);
    if (numeric === null) return false;
    return !ipv4DeniedCidrs.some(([base, prefix]) => ipv4InCidr(numeric, base, prefix));
  }
  if (family === 6) {
    const numeric = ipv6ToBigInt(address);
    if (numeric === null) return false;
    if (!ipv6InCidr(numeric, '2000::', 3)) return false;
    return !ipv6DeniedCidrs.some(([base, prefix]) => ipv6InCidr(numeric, base, prefix));
  }
  return false;
}

async function defaultResolver(hostname: string): Promise<readonly ResolvedAddress[]> {
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => {
    const family = isIP(row.address);
    if (family !== 4 && family !== 6) throw new Error('DNS resolver returned an invalid IP address');
    return { address: row.address, family };
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Operation aborted', 'AbortError');
}

async function withAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export async function resolvePublicDestinationAddress(
  rawHostname: string,
  resolver: DestinationResolver = defaultResolver,
  signal?: AbortSignal,
): Promise<ResolvedAddress> {
  const hostname = unwrapIpv6Brackets(rawHostname).toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeDestinationError('Localhost destinations are not permitted');
  }

  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!isPublicIpAddress(hostname)) {
      throw new UnsafeDestinationError('Destination IP address is not publicly routable');
    }
    return { address: hostname, family: literalFamily };
  }

  const lookupPromise = resolver(hostname);
  const resolved = signal ? await withAbortSignal(lookupPromise, signal) : await lookupPromise;
  if (resolved.length === 0) {
    const error = new Error('Destination hostname did not resolve') as Error & { code: string };
    error.code = 'ENOTFOUND';
    throw error;
  }

  const validated: ResolvedAddress[] = [];
  for (const result of resolved) {
    const family = isIP(result.address);
    if (family !== 4 && family !== 6) {
      throw new UnsafeDestinationError('Destination DNS returned an invalid address');
    }
    if (!isPublicIpAddress(result.address)) {
      throw new UnsafeDestinationError('Destination hostname resolves to a non-public address');
    }
    validated.push({ address: unwrapIpv6Brackets(result.address), family });
  }
  const selected = validated[0];
  if (!selected) throw new Error('Destination hostname did not resolve');
  return selected;
}

export function createPinnedLookup(address: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

export interface OutboundRequest {
  once(event: 'error', listener: (error: Error) => void): this;
  end(data?: string): void;
}

export type HttpsRequestFactory = (
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => OutboundRequest;

const defaultHttpsRequestFactory: HttpsRequestFactory = (url, options, onResponse) =>
  httpsRequest(url, options, onResponse);

export interface DeliveryTransport {
  postJson(url: URL, body: string, timeoutMs: number): Promise<number>;
}

export interface PinnedHttpsTransportOptions {
  resolver?: DestinationResolver;
  requestFactory?: HttpsRequestFactory;
}

export class PinnedHttpsTransport implements DeliveryTransport {
  private readonly resolver: DestinationResolver;
  private readonly requestFactory: HttpsRequestFactory;

  constructor(options: PinnedHttpsTransportOptions = {}) {
    this.resolver = options.resolver ?? defaultResolver;
    this.requestFactory = options.requestFactory ?? defaultHttpsRequestFactory;
  }

  async postJson(url: URL, body: string, timeoutMs: number): Promise<number> {
    if (url.protocol !== 'https:') {
      throw new UnsafeDestinationError('Pinned transport requires https://');
    }
    const signal = AbortSignal.timeout(timeoutMs);
    const resolved = await resolvePublicDestinationAddress(url.hostname, this.resolver, signal);
    return new Promise<number>((resolve, reject) => {
      const request = this.requestFactory(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'RelayForge/0.1',
            'content-length': Buffer.byteLength(body),
          },
          signal,
          lookup: createPinnedLookup(resolved),
          agent: false,
        },
        (response) => {
          response.resume();
          if (response.statusCode === undefined) {
            reject(new Error('Destination response did not include a status code'));
            return;
          }
          resolve(response.statusCode);
        },
      );
      request.once('error', reject);
      request.end(body);
    });
  }
}

export interface HttpDeliveryClientOptions {
  timeoutMs?: number;
  allowHttpForTests?: boolean;
  transport?: DeliveryTransport;
}

export class HttpDeliveryClient implements DeliveryClient {
  private readonly timeoutMs: number;
  private readonly allowHttpForTests: boolean;
  private readonly transport: DeliveryTransport;

  constructor(options: HttpDeliveryClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.allowHttpForTests = options.allowHttpForTests ?? false;
    this.transport = options.transport ?? new PinnedHttpsTransport();
  }

  async deliver(event: EventRecord, destination: DestinationRecord): Promise<DeliveryResult> {
    const started = performance.now();
    try {
      const url = assertSafeDestinationUrl(destination.url, this.allowHttpForTests);
      const statusCode = await this.transport.postJson(
        url,
        JSON.stringify(transformPayload(event, destination)),
        this.timeoutMs,
      );
      return {
        outcome: classifyStatus(statusCode),
        statusCode,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
      };
    } catch (error) {
      const classified = classifyNetworkError(error);
      return {
        ...classified,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
      };
    }
  }
}
