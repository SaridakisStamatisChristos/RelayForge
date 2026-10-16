import { z } from 'zod';

export const EVENT_TYPE_MAX = 128;
export const SOURCE_MAX = 128;
export const DESTINATION_NAME_MAX = 128;
export const IDEMPOTENCY_KEY_MAX = 256;

export const eventStatusSchema = z.enum([
  'accepted',
  'pending',
  'processing',
  'delivered',
  'partially_delivered',
  'failed',
  'dead_lettered',
]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const deliveryOutcomeSchema = z.enum(['success', 'retryable_failure', 'permanent_failure']);
export type DeliveryOutcome = z.infer<typeof deliveryOutcomeSchema>;

export const deliveryJobStateSchema = z.enum([
  'pending',
  'processing',
  'retry_scheduled',
  'delivered',
  'permanent_failure',
  'dead_lettered',
]);
export type DeliveryJobState = z.infer<typeof deliveryJobStateSchema>;

export const jsonValueSchema: z.ZodType<unknown> = z.json();

export const createEventSchema = z.object({
  type: z.string().trim().min(1).max(EVENT_TYPE_MAX),
  source: z.string().trim().min(1).max(SOURCE_MAX),
  payload: jsonValueSchema,
  idempotencyKey: z.string().trim().min(1).max(IDEMPOTENCY_KEY_MAX).optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const createDestinationSchema = z.object({
  name: z.string().trim().min(1).max(DESTINATION_NAME_MAX),
  url: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:', 'Destination URL must use https://'),
  enabled: z.boolean().default(true),
  eventTypes: z.array(z.string().trim().min(1).max(EVENT_TYPE_MAX)).min(1).max(100).optional(),
});
export type CreateDestinationInput = z.infer<typeof createDestinationSchema>;

export const patchDestinationSchema = z.object({ enabled: z.boolean() }).strict();
export type PatchDestinationInput = z.infer<typeof patchDestinationSchema>;

export const eventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(1024).optional(),
  type: z.string().trim().min(1).max(EVENT_TYPE_MAX).optional(),
  source: z.string().trim().min(1).max(SOURCE_MAX).optional(),
  status: eventStatusSchema.optional(),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;

export const deadLetterListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(1024).optional(),
});
export type DeadLetterListQuery = z.infer<typeof deadLetterListQuerySchema>;

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'UNAUTHORIZED',
  'DELIVERY_FAILURE',
  'DATABASE_ERROR',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
