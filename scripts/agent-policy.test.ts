import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateChange, validateRelativePath, type AgentPolicy } from './agent-policy.js';

const policy: AgentPolicy = {
  safe: ['apps/worker/**','packages/core/**','tests/**'],
  review_required: ['.github/workflows/**'],
  forbidden: ['.agent/**','apps/api/src/auth/**','.github/CODEOWNERS'],
};

test('rejects forbidden auth and policy mutations', () => {
  assert.equal(evaluateChange(policy, { path: 'apps/api/src/auth/key.ts', operation: 'modify', content: 'x' }).decision, 'policy_rejected');
  assert.equal(evaluateChange(policy, { path: '.agent/policy.yaml', operation: 'modify', content: '{}' }).decision, 'policy_rejected');
});

test('requires review for CI', () => {
  assert.equal(evaluateChange(policy, { path: '.github/workflows/ci.yml', operation: 'modify', content: 'x' }).decision, 'review_required');
});

test('rejects test deletion, secrets, shell execution, and traversal', () => {
  assert.equal(evaluateChange(policy, { path: 'tests/failing.test.ts', operation: 'delete' }).reason, 'test_weakening');
  assert.equal(evaluateChange(policy, { path: 'packages/core/src/x.ts', operation: 'modify', content: `const x="${'sk-' + 'abcdefghijklmnopqrstuvwxyz'}"` }).reason, 'secret_detected');
  assert.equal(evaluateChange(policy, { path: 'packages/core/src/x.ts', operation: 'modify', content: "import { exec } from 'node:child_process'; exec('rm -rf /')" }).reason, 'unrestricted_shell_execution');
  assert.throws(() => validateRelativePath('../escape.ts'));
});
