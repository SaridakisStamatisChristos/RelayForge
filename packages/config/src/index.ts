import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  API_AUTH_TOKEN: z.string().min(12),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  DELIVERY_BASE_DELAY_MS: z.coerce.number().int().min(1).max(60_000).default(1_000),
  DELIVERY_MAX_DELAY_MS: z.coerce.number().int().min(1).max(3_600_000).default(60_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(10).max(60_000).default(250),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}
