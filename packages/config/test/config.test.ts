import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index.js';

describe('config', () => {
  it('parses valid configuration', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      API_AUTH_TOKEN: 'a-secure-test-token',
    });
    expect(config.PORT).toBe(3000);
    expect(config.DELIVERY_MAX_ATTEMPTS).toBe(5);
  });

  it('rejects invalid database URL and short token', () => {
    expect(() => loadConfig({ DATABASE_URL: 'http://x', API_AUTH_TOKEN: 'short' })).toThrow();
  });
});
