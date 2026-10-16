import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
interface Task {
  taskId: string;
  baseCommit: string;
  issue: string;
  difficulty: string;
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
  unsafeAttempts?: number;
  regressions: number;
  changedFileCount: number;
  completionMs?: number | null;
}
interface BenchmarkSummary {
  tasks_attempted: number;
  tasks_completed: number;
  first_pass_ci_rate: number | null;
  final_ci_rate: number | null;
  reviewer_acceptance_rate: number | null;
  average_repairs: number | null;
  policy_violations: number;
  unsafe_attempts: number;
  regressions: number;
  changed_file_count: number;
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
  if (!['default', 'database'].includes(task.verificationProfile ?? ''))
    throw new Error(`${file}: invalid verification profile`);
  return task as Task;
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
      ? results.reduce((s, x) => s + x.repairs, 0) / results.length
      : null,
    policy_violations: results.reduce((s, x) => s + x.policyViolations, 0),
    unsafe_attempts: results.reduce((s, x) => s + (x.unsafeAttempts ?? 0), 0),
    regressions: results.reduce((s, x) => s + x.regressions, 0),
    changed_file_count: results.reduce((s, x) => s + x.changedFileCount, 0),
  };
  const human = results.filter((x) => typeof x.reviewerAccepted === 'boolean');
  if (human.length)
    report.reviewer_acceptance_rate = human.filter((x) => x.reviewerAccepted).length / human.length;
  console.log(JSON.stringify(report, null, 2));
} else throw new Error(`Unknown command: ${command}`);
