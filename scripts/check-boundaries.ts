import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageDirs = [
  'apps/api',
  'apps/worker',
  'packages/contracts',
  'packages/core',
  'packages/database',
  'packages/delivery',
  'packages/observability',
  'packages/config',
] as const;
const allowed: Readonly<Record<string, readonly string[]>> = {
  '@relayforge/api': [
    '@relayforge/contracts',
    '@relayforge/core',
    '@relayforge/database',
    '@relayforge/config',
    '@relayforge/observability',
  ],
  '@relayforge/worker': [
    '@relayforge/contracts',
    '@relayforge/core',
    '@relayforge/database',
    '@relayforge/delivery',
    '@relayforge/config',
    '@relayforge/observability',
  ],
  '@relayforge/delivery': [
    '@relayforge/contracts',
    '@relayforge/core',
    '@relayforge/observability',
  ],
  '@relayforge/database': ['@relayforge/contracts', '@relayforge/core'],
  '@relayforge/core': ['@relayforge/contracts'],
  '@relayforge/config': [],
  '@relayforge/observability': [],
  '@relayforge/contracts': [],
};

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const violations: string[] = [];
for (const dir of packageDirs) {
  const pkg = JSON.parse(await readFile(path.join(root, dir, 'package.json'), 'utf8')) as {
    name?: unknown;
  };
  if (typeof pkg.name !== 'string') throw new Error(`${dir}/package.json has no package name`);
  const allow = new Set(allowed[pkg.name] ?? []);
  for (const base of ['src', 'test']) {
    const sourceDir = path.join(root, dir, base);
    let files: string[] = [];
    try {
      files = await walk(sourceDir);
    } catch {
      continue;
    }
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(
        /(?:from\s+|import\s*\()(['"])(@relayforge\/[^'"/]+)\1/gu,
      )) {
        const dep = match[2];
        if (dep && dep !== pkg.name && !allow.has(dep))
          violations.push(`${path.relative(root, file)} imports forbidden ${dep}`);
      }
      for (const match of text.matchAll(/(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/gu)) {
        const specifier = match[2];
        if (!specifier) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        const packageRoot = path.resolve(root, dir);
        if (!resolved.startsWith(`${packageRoot}${path.sep}`) && resolved !== packageRoot) {
          violations.push(`${path.relative(root, file)} escapes package boundary via ${specifier}`);
        }
      }
    }
  }
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Package boundaries verified.');
}
