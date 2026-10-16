import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const ignored = new Set(['node_modules', '.git', 'dist', 'coverage', '.tmp']);
const patterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
];
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && !/\.(png|jpe?g|gif|zip|pdf)$/iu.test(entry.name)) out.push(full);
  }
  return out;
}
const findings: string[] = [];
for (const file of await walk(root)) {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (patterns.some((p) => p.test(text))) findings.push(path.relative(root, file));
}
if (findings.length) {
  console.error(`Potential committed secrets: ${findings.join(', ')}`);
  process.exitCode = 1;
} else console.log('Secret scan passed.');
