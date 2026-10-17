import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', '.turbo', 'coverage', 'dist', 'node_modules']);
const ignoredFiles = new Set(['source-manifest.json']);

interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

async function walk(directory: string, relative = ''): Promise<ManifestEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const manifest: ManifestEntry[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      manifest.push(...(await walk(absolutePath, relativePath)));
      continue;
    }
    if (!entry.isFile() || ignoredFiles.has(relativePath)) continue;
    const bytes = await readFile(absolutePath);
    const metadata = await stat(absolutePath);
    manifest.push({
      path: relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: metadata.size,
    });
  }
  return manifest;
}

const files = await walk(root);
process.stdout.write(
  `${JSON.stringify(
    {
      version: 1,
      algorithm: 'sha256',
      scope: 'repository source excluding VCS, dependency caches, and generated build output',
      files,
    },
    null,
    2,
  )}\n`,
);
