import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export type Decision = 'safe' | 'review_required' | 'policy_rejected';
export interface AgentPolicy { safe: string[]; review_required: string[]; forbidden: string[]; }
export interface Change { path: string; operation: 'add' | 'modify' | 'delete'; content?: string; }

function matches(pattern: string, candidate: string): boolean {
  if (pattern.endsWith('/**')) return candidate === pattern.slice(0, -3) || candidate.startsWith(pattern.slice(0, -2));
  return candidate === pattern;
}

export function classifyPath(policy: AgentPolicy, candidate: string): Decision {
  if (policy.forbidden.some((pattern) => matches(pattern, candidate))) return 'policy_rejected';
  if (policy.review_required.some((pattern) => matches(pattern, candidate))) return 'review_required';
  if (policy.safe.some((pattern) => matches(pattern, candidate))) return 'safe';
  return 'review_required';
}

export function validateRelativePath(candidate: string): void {
  if (candidate.length === 0 || path.isAbsolute(candidate) || candidate.includes('\\')) throw new Error('invalid_change_path');
  const normalized = path.posix.normalize(candidate);
  if (normalized === '..' || normalized.startsWith('../') || normalized !== candidate) throw new Error('path_traversal');
}

export async function assertNoSymlinkEscape(repoRoot: string, candidate: string): Promise<void> {
  validateRelativePath(candidate);
  const root = await realpath(repoRoot);
  const parts = candidate.split('/');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        const target = await realpath(current);
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('symlink_escape');
        current = target;
      }
    } catch (error) {
      if (error instanceof Error && ['symlink_escape', 'path_traversal'].includes(error.message)) throw error;
      break;
    }
  }
}

const secretPatterns = [/\bsk-[A-Za-z0-9_-]{20,}\b/u, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u];
const unsafeShellPatterns = [/from\s+['"]node:child_process['"]/u, /\bexec(?:File|Sync)?\s*\(/u, /\bspawn(?:Sync)?\s*\(/u];

export function evaluateChange(policy: AgentPolicy, change: Change): { decision: Decision; reason: string } {
  validateRelativePath(change.path);
  const pathDecision = classifyPath(policy, change.path);
  if (pathDecision === 'policy_rejected') return { decision: 'policy_rejected', reason: 'forbidden_path' };
  if (change.operation === 'delete' && /(^|\/)(test|tests)\//u.test(change.path)) return { decision: 'policy_rejected', reason: 'test_weakening' };
  const content = change.content ?? '';
  if (secretPatterns.some((pattern) => pattern.test(content))) return { decision: 'policy_rejected', reason: 'secret_detected' };
  if (unsafeShellPatterns.some((pattern) => pattern.test(content))) return { decision: 'policy_rejected', reason: 'unrestricted_shell_execution' };
  if (pathDecision === 'review_required') return { decision: 'review_required', reason: 'protected_path' };
  return { decision: 'safe', reason: 'allowed_path' };
}
