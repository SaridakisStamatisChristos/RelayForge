import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

interface Task {
  taskId: string;
  baseCommit: string;
  issue: string;
  difficulty: string;
  provenance: 'simulated' | 'historical';
  allowedPaths: string[];
  forbiddenPaths: string[];
  verificationProfile: string;
  expectedBehavior: string[];
  evaluatorRef: string;
}
interface Result {
  taskId: string;
  status: string;
  firstPassCi: boolean | null;
  finalCi: boolean | null;
  reviewerAccepted?: boolean | null;
  repairs: number;
  policyViolations: number;
  unsafeAttempts: number;
  forbiddenPathAttempts: number;
  testWeakeningAttempts: number;
  regressions: number;
  changedFileCount: number;
  completionMs: number | null;
  tokenCount?: number | null;
  apiCostUsd?: number | null;
}
interface BenchmarkSummary {
  tasks_attempted: number;
  tasks_completed: number;
  first_pass_ci_rate: number | null;
  final_ci_rate: number | null;
  reviewer_acceptance_rate: number | null;
  average_repairs: number | null;
  median_completion_time_ms: number | null;
  policy_violations: number;
  unsafe_attempts: number;
  forbidden_path_attempts: number;
  test_weakening_attempts: number;
  regressions: number;
  changed_file_count: number;
  token_count: number | null;
  api_cost_usd: number | null;
}

async function jsonFiles(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((x) => x.endsWith('.json'))
    .sort()
    .map((x) => path.join(dir, x));
}
function validateTask(value: unknown, file: string): Task {
  if (typeof value !== 'object' || value === null) throw new Error(`${file}: task must be object`);
  const task = value as Partial<Task>;
  if (
    !task.taskId ||
    !task.issue ||
    !task.evaluatorRef ||
    !Array.isArray(task.allowedPaths) ||
    !Array.isArray(task.forbiddenPaths) ||
    !Array.isArray(task.expectedBehavior)
  )
    throw new Error(`${file}: missing fields`);
  if (!task.baseCommit || !/^[0-9a-f]{40}$/u.test(task.baseCommit))
    throw new Error(`${file}: baseCommit must be a real 40-hex commit`);
  if (!['easy', 'medium', 'hard', 'safety'].includes(task.difficulty ?? ''))
    throw new Error(`${file}: invalid difficulty`);
  if (!['simulated', 'historical'].includes(task.provenance ?? ''))
    throw new Error(`${file}: provenance must explicitly classify the task`);
  if (!['default', 'database'].includes(task.verificationProfile ?? ''))
    throw new Error(`${file}: invalid verification profile`);
  return task as Task;
}
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] ?? null;
  const lower = ordered[middle - 1];
  const upper = ordered[middle];
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}
const command = process.argv[2] ?? 'validate';
if (command === 'validate') {
  const files = await jsonFiles(path.join(process.cwd(), 'benchmarks/tasks'));
  if (files.length < 10) throw new Error('At least 10 benchmark tasks are required');
  const ids = new Set<string>();
  for (const file of files) {
    const task = validateTask(JSON.parse(await readFile(file, 'utf8')) as unknown, file);
    if (ids.has(task.taskId)) throw new Error(`duplicate task id ${task.taskId}`);
    ids.add(task.taskId);
  }
  console.log(`Validated ${files.length} benchmark task contracts.`);
} else if (command === 'summarize') {
  const dir = path.resolve(process.argv[3] ?? 'benchmarks/results');
  const files = await jsonFiles(dir);
  const results: Result[] = [];
  for (const file of files) {
    results.push(JSON.parse(await readFile(file, 'utf8')) as Result);
  }
  const completed = results.filter((x) => x.status === 'completed').length;
  const firstKnown = results.filter((x) => x.firstPassCi !== null);
  const finalKnown = results.filter((x) => x.finalCi !== null);
  const completionTimes = results.flatMap((x) => (x.completionMs === null ? [] : [x.completionMs]));
  const tokenCounts = results.flatMap((x) =>
    x.tokenCount === undefined || x.tokenCount === null ? [] : [x.tokenCount],
  );
  const apiCosts = results.flatMap((x) =>
    x.apiCostUsd === undefined || x.apiCostUsd === null ? [] : [x.apiCostUsd],
  );
  const report: BenchmarkSummary = {
    tasks_attempted: results.length,
    tasks_completed: completed,
    first_pass_ci_rate: firstKnown.length
      ? firstKnown.filter((x) => x.firstPassCi).length / firstKnown.length
      : null,
    final_ci_rate: finalKnown.length
      ? finalKnown.filter((x) => x.finalCi).length / finalKnown.length
      : null,
    reviewer_acceptance_rate: null,
    average_repairs: results.length
      ? results.reduce((sum, x) => sum + x.repairs, 0) / results.length
      : null,
    median_completion_time_ms: median(completionTimes),
    policy_violations: results.reduce((sum, x) => sum + x.policyViolations, 0),
    unsafe_attempts: results.reduce((sum, x) => sum + x.unsafeAttempts, 0),
    forbidden_path_attempts: results.reduce((sum, x) => sum + x.forbiddenPathAttempts, 0),
    test_weakening_attempts: results.reduce((sum, x) => sum + x.testWeakeningAttempts, 0),
    regressions: results.reduce((sum, x) => sum + x.regressions, 0),
    changed_file_count: results.reduce((sum, x) => sum + x.changedFileCount, 0),
    token_count: tokenCounts.length ? tokenCounts.reduce((sum, value) => sum + value, 0) : null,
    api_cost_usd: apiCosts.length ? apiCosts.reduce((sum, value) => sum + value, 0) : null,
  };
  const human = results.filter((x) => typeof x.reviewerAccepted === 'boolean');
  if (human.length)
    report.reviewer_acceptance_rate = human.filter((x) => x.reviewerAccepted).length / human.length;
  console.log(JSON.stringify(report, null, 2));
} else throw new Error(`Unknown command: ${command}`);
