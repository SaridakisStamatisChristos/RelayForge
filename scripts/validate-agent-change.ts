import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertNoSymlinkEscape,
  evaluateChange,
  type AgentPolicy,
  type Change,
} from './agent-policy.js';

const manifestPath = process.argv[2];
if (!manifestPath)
  throw new Error('Usage: tsx scripts/validate-agent-change.ts <change-manifest.json>');
const root = process.cwd();
const policy = JSON.parse(
  await readFile(path.join(root, '.agent/policy.yaml'), 'utf8'),
) as AgentPolicy;
const payload = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8')) as {
  changes?: unknown;
};
if (!Array.isArray(payload.changes))
  throw new Error('change manifest must contain a changes array');
let reviewRequired = false;
for (const raw of payload.changes) {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid change entry');
  const change = raw as Change;
  await assertNoSymlinkEscape(root, change.path);
  const result = evaluateChange(policy, change);
  console.log(`${change.path}: ${result.decision} (${result.reason})`);
  if (result.decision === 'policy_rejected') process.exitCode = 2;
  if (result.decision === 'review_required') reviewRequired = true;
}
if (process.exitCode !== 2 && reviewRequired) process.exitCode = 3;
