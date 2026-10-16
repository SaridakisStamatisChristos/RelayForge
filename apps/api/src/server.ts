import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import {
  IDEMPOTENCY_KEY_MAX,
  createDestinationSchema,
  createEventSchema,
  deadLetterListQuerySchema,
  eventListQuerySchema,
  patchDestinationSchema,
} from '@relayforge/contracts';
import { loadConfig } from '@relayforge/config';
import { AppError, ValidationError, type ApiStore } from '@relayforge/core';
import { PostgresRelayStore, createPool } from '@relayforge/database';
import { requireApiKey } from './auth/api-key.js';

export interface BuildServerOptions {
  store: ApiStore;
  authToken: string;
  logger?: boolean | Record<string, unknown>;
}

const uuidSchema = z.string().uuid();
const idempotencyHeaderSchema = z.string().trim().min(1).max(IDEMPOTENCY_KEY_MAX);

function parseId(value: unknown): string {
  return uuidSchema.parse(value);
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, disableRequestLogging: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.httpStatus).send({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ZodError) {
      void reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } });
      return;
    }
    request.log.error({ err: error }, 'Unhandled request error');
    void reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await options.store.ping();
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });

  void app.register(
    async (api) => {
      api.addHook('onRequest', requireApiKey(options.authToken));

      api.post('/events', async (request, reply) => {
        const input = createEventSchema.parse(request.body);
        const rawHeader = request.headers['idempotency-key'];
        const header = rawHeader === undefined ? undefined : idempotencyHeaderSchema.parse(rawHeader);
        if (header && input.idempotencyKey && header !== input.idempotencyKey) {
          throw new ValidationError('Header and body idempotency keys must match');
        }
        const effectiveInput = header ? { ...input, idempotencyKey: header } : input;
        const result = await options.store.createEvent(effectiveInput);
        return reply.status(result.created ? 202 : 200).send(result);
      });

      api.get('/events', async (request) => options.store.listEvents(eventListQuerySchema.parse(request.query)));

      api.get('/events/:id', async (request) => {
        const params = request.params as { id?: unknown };
        return options.store.getEvent(parseId(params.id));
      });

      api.post('/events/:id/replay', async (request, reply) => {
        const params = request.params as { id?: unknown };
        const result = await options.store.replayEvent(parseId(params.id));
        return reply.status(202).send(result);
      });

      api.post('/destinations', async (request, reply) => {
        const created = await options.store.createDestination(createDestinationSchema.parse(request.body));
        return reply.status(201).send(created);
      });

      api.get('/destinations', async () => ({ items: await options.store.listDestinations() }));

      api.patch('/destinations/:id', async (request) => {
        const params = request.params as { id?: unknown };
        return options.store.patchDestination(parseId(params.id), patchDestinationSchema.parse(request.body));
      });

      api.get('/dead-letters', async (request) =>
        options.store.listDeadLetters(deadLetterListQuerySchema.parse(request.query)),
      );

      api.post('/dead-letters/:id/replay', async (request, reply) => {
        const params = request.params as { id?: unknown };
        return reply.status(202).send(await options.store.replayDeadLetter(parseId(params.id)));
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const store = new PostgresRelayStore(pool);
  const app = buildServer({
    store,
    authToken: config.API_AUTH_TOKEN,
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.body.payload'],
    },
  });
  const shutdown = async (): Promise<void> => {
    await app.close();
    await store.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
