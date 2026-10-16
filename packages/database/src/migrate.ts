import { Pool } from 'pg';
import { migrate } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
try {
  await migrate(pool);
  console.log('RelayForge migrations applied successfully.');
} finally {
  await pool.end();
}
