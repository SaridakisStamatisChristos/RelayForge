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

const retryableStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504]);

export function classifyStatus(statusCode: number): DeliveryOutcome {
  if (statusCode >= 200 && statusCode <= 299) return 'success';
  if (retryableStatusCodes.has(statusCode)) return 'retryable_failure';
  if (statusCode >= 400 && statusCode <= 499) return 'permanent_failure';
  if (statusCode >= 500 && statusCode <= 599) return 'retryable_failure';
  return 'permanent_failure';
}

export function classifyNetworkError(error: unknown): {
  outcome: 'retryable_failure';
  errorCode: string;
} {
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
    throw new Error('Destination URL must use https://');
  }
  if (url.username || url.password) throw new Error('Destination URL must not contain credentials');
  return url;
}

export interface HttpDeliveryClientOptions {
  timeoutMs?: number;
  allowHttpForTests?: boolean;
  fetchFn?: typeof fetch;
}

export class HttpDeliveryClient implements DeliveryClient {
  private readonly timeoutMs: number;
  private readonly allowHttpForTests: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpDeliveryClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.allowHttpForTests = options.allowHttpForTests ?? false;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async deliver(event: EventRecord, destination: DestinationRecord): Promise<DeliveryResult> {
    const started = performance.now();
    try {
      const url = assertSafeDestinationUrl(destination.url, this.allowHttpForTests);
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'RelayForge/0.1' },
        body: JSON.stringify(transformPayload(event, destination)),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
      return {
        outcome: classifyStatus(response.status),
        statusCode: response.status,
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
