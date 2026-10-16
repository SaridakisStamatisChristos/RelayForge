import { loadConfig } from '@relayforge/config';
import { createPool, PostgresRelayStore } from '@relayforge/database';
import { HttpDeliveryClient } from '@relayforge/delivery';
import { DeliveryProcessor } from './processor/processor.js';

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const store = new PostgresRelayStore(pool);
  const processor = new DeliveryProcessor(store, new HttpDeliveryClient(), {
    maxAttempts: config.DELIVERY_MAX_ATTEMPTS,
    baseDelayMs: config.DELIVERY_BASE_DELAY_MS,
    maxDelayMs: config.DELIVERY_MAX_DELAY_MS,
  });
  let stopping = false;
  process.once('SIGTERM', () => {
    stopping = true;
  });
  process.once('SIGINT', () => {
    stopping = true;
  });

  try {
    while (!stopping) {
      try {
        const processed = await processor.processNext();
        if (!processed) await sleep(config.WORKER_POLL_INTERVAL_MS);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'worker_iteration_failed',
            error: error instanceof Error ? error.message : 'unknown',
          }),
        );
        await sleep(config.WORKER_POLL_INTERVAL_MS);
      }
    }
  } finally {
    await store.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
