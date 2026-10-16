import type {
  CreateDestinationInput,
  CreateEventInput,
  DeadLetterListQuery,
  DeliveryJobState,
  DeliveryOutcome,
  ErrorCode,
  EventListQuery,
  EventStatus,
  PatchDestinationInput,
} from '@relayforge/contracts';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
  }
}
export class NotFoundError extends AppError {
  constructor(message: string) {
    super('NOT_FOUND', message, 404);
  }
}
export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}
export class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super('DATABASE_ERROR', message, 500);
  }
}

export interface EventRecord {
  id: string;
  type: string;
  source: string;
  payload: unknown;
  idempotencyKey?: string;
  status: EventStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface DestinationRecord {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  eventTypes?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliverySummary {
  total: number;
  pending: number;
  processing: number;
  retryScheduled: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  attemptCount: number;
}

export interface EventDetail {
  event: EventRecord;
  delivery: DeliverySummary;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface CreateEventResult {
  event: EventRecord;
  created: boolean;
  jobsCreated: number;
}

export interface ReplayResult {
  replayId: string;
  jobsCreated: number;
}

export interface DeadLetterRecord {
  id: string;
  eventId: string;
  destinationId: string;
  reason: string;
  attempts: number;
  createdAt: Date;
  replayedAt?: Date;
}

export interface ClaimedDelivery {
  jobId: string;
  attemptNumber: number;
  event: EventRecord;
  destination: DestinationRecord;
}

export interface DeliveryAttemptInput {
  jobId: string;
  eventId: string;
  destinationId: string;
  attemptNumber: number;
  outcome: DeliveryOutcome;
  statusCode?: number;
  errorCode?: string;
  durationMs?: number;
}

export interface ApiStore {
  createEvent(input: CreateEventInput): Promise<CreateEventResult>;
  getEvent(id: string): Promise<EventDetail>;
  listEvents(query: EventListQuery): Promise<Page<EventRecord>>;
  createDestination(input: CreateDestinationInput): Promise<DestinationRecord>;
  listDestinations(): Promise<DestinationRecord[]>;
  patchDestination(id: string, input: PatchDestinationInput): Promise<DestinationRecord>;
  replayEvent(id: string): Promise<ReplayResult>;
  listDeadLetters(query: DeadLetterListQuery): Promise<Page<DeadLetterRecord>>;
  replayDeadLetter(id: string): Promise<{ jobId: string }>;
  ping(): Promise<void>;
}

export interface WorkerStore {
  claimDueJob(now: Date): Promise<ClaimedDelivery | null>;
  markDelivered(attempt: DeliveryAttemptInput): Promise<void>;
  scheduleRetry(attempt: DeliveryAttemptInput, nextAttemptAt: Date): Promise<void>;
  markPermanentFailure(attempt: DeliveryAttemptInput, reason: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function calculateRetryDelayMs(attemptNumber: number, policy: RetryPolicy): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new RangeError('attemptNumber must be a positive integer');
  }
  const exponent = Math.max(0, attemptNumber - 1);
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
}

const legalTransitions: Readonly<Record<DeliveryJobState, readonly DeliveryJobState[]>> = {
  pending: ['processing'],
  processing: ['delivered', 'retry_scheduled', 'permanent_failure', 'dead_lettered'],
  retry_scheduled: ['processing'],
  delivered: [],
  permanent_failure: ['dead_lettered'],
  dead_lettered: [],
};

export function canTransitionJob(from: DeliveryJobState, to: DeliveryJobState): boolean {
  return legalTransitions[from].includes(to);
}

export function assertJobTransition(from: DeliveryJobState, to: DeliveryJobState): void {
  if (!canTransitionJob(from, to)) {
    throw new ConflictError(`Illegal delivery job transition: ${from} -> ${to}`);
  }
}

interface CursorPayload {
  createdAt: string;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id } satisfies CursorPayload),
  ).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as { createdAt?: unknown }).createdAt !== 'string' ||
      typeof (value as { id?: unknown }).id !== 'string'
    ) {
      throw new Error('invalid shape');
    }
    const createdAt = new Date((value as CursorPayload).createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error('invalid date');
    return { createdAt, id: (value as CursorPayload).id };
  } catch {
    throw new ValidationError('Invalid pagination cursor');
  }
}

export function eventMatchesDestination(
  eventType: string,
  destination: DestinationRecord,
): boolean {
  return (
    destination.enabled &&
    (destination.eventTypes === undefined ||
      destination.eventTypes.length === 0 ||
      destination.eventTypes.includes(eventType))
  );
}

export function transformPayload(
  event: EventRecord,
  destination: DestinationRecord,
): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    source: event.source,
    payload: event.payload,
    destinationId: destination.id,
    createdAt: event.createdAt.toISOString(),
  };
}
