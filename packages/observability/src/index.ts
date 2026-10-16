export interface LogContext {
  request_id?: string;
  event_id?: string;
  destination_id?: string;
  delivery_job_id?: string;
  attempt_number?: number;
  duration_ms?: number;
  outcome?: string;
}

export function safeLogContext(context: LogContext): LogContext {
  return {
    ...(context.request_id === undefined ? {} : { request_id: context.request_id }),
    ...(context.event_id === undefined ? {} : { event_id: context.event_id }),
    ...(context.destination_id === undefined ? {} : { destination_id: context.destination_id }),
    ...(context.delivery_job_id === undefined ? {} : { delivery_job_id: context.delivery_job_id }),
    ...(context.attempt_number === undefined ? {} : { attempt_number: context.attempt_number }),
    ...(context.duration_ms === undefined ? {} : { duration_ms: context.duration_ms }),
    ...(context.outcome === undefined ? {} : { outcome: context.outcome }),
  };
}

export const REDACTED_LOG_FIELDS = [
  'authorization',
  'api_auth_token',
  'database_url',
  'payload',
] as const;
