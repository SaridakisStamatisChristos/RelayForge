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
  return { ...context };
}

export const REDACTED_LOG_FIELDS = [
  'authorization',
  'api_auth_token',
  'database_url',
  'payload',
] as const;
