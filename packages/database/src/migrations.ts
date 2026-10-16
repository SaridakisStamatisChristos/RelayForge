import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

export interface MigrationFile {
  version: string;
  filename: string;
  checksum: string;
  sql: string;
}

const MIGRATION_LOCK_NAMESPACE = 0x5246;
const MIGRATION_LOCK_ID = 1;

export async function loadMigrations(
  directory = new URL('../migrations/', import.meta.url),
): Promise<MigrationFile[]> {
  const dirPath = directory instanceof URL ? fileURLToPath(directory) : path.resolve(directory);
  const names = (await readdir(dirPath))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  const migrations: MigrationFile[] = [];
  for (const filename of names) {
    const sql = await readFile(path.join(dirPath, filename), 'utf8');
    migrations.push({
      version: filename.slice(0, 3),
      filename,
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    });
  }
  return migrations;
}

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_ID,
    ]);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    for (const migration of await loadMigrations()) {
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE version = $1',
        [migration.version],
      );
      if (existing.rowCount === 1) {
        if (existing.rows[0]?.checksum !== migration.checksum) {
          throw new Error(`Migration checksum mismatch for ${migration.filename}`);
        }
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [
          migration.version,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      if (locked) {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [
          MIGRATION_LOCK_NAMESPACE,
          MIGRATION_LOCK_ID,
        ]);
      }
    } finally {
      client.release();
    }
  }
}

export async function verifyAppliedMigrations(pool: Pool): Promise<void> {
  const migrations = await loadMigrations();
  const applied = await pool.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  if (applied.rowCount !== migrations.length) {
    throw new Error(`Expected ${migrations.length} applied migrations, found ${applied.rowCount}`);
  }
  for (const migration of migrations) {
    const row = applied.rows.find((item) => item.version === migration.version);
    if (!row || row.checksum !== migration.checksum)
      throw new Error(`Migration verification failed: ${migration.filename}`);
  }
}
