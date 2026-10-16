import assert from 'node:assert/strict';
import test from 'node:test';
import { REDACTED_LOG_FIELDS, safeLogContext } from '../dist/index.js';

test('safeLogContext whitelists structured fields and drops unknown secret-shaped fields', () => {
  const context = safeLogContext({
    request_id: 'req-1',
    event_id: 'evt-1',
    authorization: 'Bearer secret',
    payload: { sensitive: true },
  });
  assert.deepEqual(context, { request_id: 'req-1', event_id: 'evt-1' });
  assert.equal('authorization' in context, false);
  assert.equal('payload' in context, false);
});

test('redaction registry includes high-risk fields', () => {
  assert.deepEqual([...REDACTED_LOG_FIELDS].sort(), [
    'api_auth_token',
    'authorization',
    'database_url',
    'payload',
  ]);
});
