import {
  calculateRetryDelayMs,
  systemClock,
  type Clock,
  type DeliveryAttemptInput,
  type RetryPolicy,
  type WorkerStore,
} from '@relayforge/core';
import type { DeliveryClient, DeliveryResult } from '@relayforge/delivery';

function toAttempt(
  job: NonNullable<Awaited<ReturnType<WorkerStore['claimDueJob']>>>,
  result: DeliveryResult,
): DeliveryAttemptInput {
  return {
    jobId: job.jobId,
    eventId: job.event.id,
    destinationId: job.destination.id,
    attemptNumber: job.attemptNumber,
    outcome: result.outcome,
    ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    durationMs: result.durationMs,
  };
}

export class DeliveryProcessor {
  constructor(
    private readonly store: WorkerStore,
    private readonly delivery: DeliveryClient,
    private readonly retryPolicy: RetryPolicy,
    private readonly clock: Clock = systemClock,
  ) {}

  async processNext(): Promise<boolean> {
    const job = await this.store.claimDueJob(this.clock.now());
    if (!job) return false;

    if (!job.destination.enabled) {
      await this.store.markPermanentFailure(
        {
          jobId: job.jobId,
          eventId: job.event.id,
          destinationId: job.destination.id,
          attemptNumber: job.attemptNumber,
          outcome: 'permanent_failure',
          errorCode: 'DESTINATION_DISABLED',
          durationMs: 0,
        },
        'destination_disabled',
      );
      return true;
    }

    const result = await this.delivery.deliver(job.event, job.destination);
    const attempt = toAttempt(job, result);
    if (result.outcome === 'success') {
      await this.store.markDelivered(attempt);
      return true;
    }
    if (result.outcome === 'permanent_failure') {
      await this.store.markPermanentFailure(attempt, result.errorCode ?? `http_${result.statusCode ?? 'unknown'}`);
      return true;
    }
    if (job.attemptNumber >= this.retryPolicy.maxAttempts) {
      await this.store.markPermanentFailure(attempt, 'max_attempts_exhausted');
      return true;
    }
    const delayMs = calculateRetryDelayMs(job.attemptNumber, this.retryPolicy);
    await this.store.scheduleRetry(attempt, new Date(this.clock.now().getTime() + delayMs));
    return true;
  }
}
