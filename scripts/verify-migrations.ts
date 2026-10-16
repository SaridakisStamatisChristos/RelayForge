import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.join(process.cwd(), 'packages/database/migrations');
const names = (await readdir(directory))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name))
  .sort();
if (names.length === 0) throw new Error('No database migrations found');
for (let index = 0; index < names.length; index += 1) {
  const expected = String(index + 1).padStart(3, '0');
  const name = names[index];
  if (!name?.startsWith(`${expected}_`))
    throw new Error(`Migration sequence gap at ${name ?? '<missing>'}`);
  const sql = await readFile(path.join(directory, name), 'utf8');
  if (!/CREATE\s+TABLE/iu.test(sql)) throw new Error(`${name} contains no schema creation`);
  if (/\b(DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE)\b/iu.test(sql))
    throw new Error(`${name} contains destructive migration SQL`);
  console.log(`${name} sha256=${createHash('sha256').update(sql).digest('hex')}`);
}
