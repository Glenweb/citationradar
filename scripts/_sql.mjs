/** Shared dual-driver SQL helper for scripts (mirrors src/lib/db.ts). */
import { neon } from '@neondatabase/serverless';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

const isNeon = (() => {
  try {
    return /\.neon\.tech$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
})();

let pool = null;
let neonSql = null;
if (isNeon) {
  neonSql = neon(url);
} else {
  pool = new pg.Pool({
    connectionString: url,
    max: 4,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
}

/** Execute placeholder SQL, returning rows. */
export async function exec(text, params = []) {
  if (isNeon) return await neonSql.query(text, params);
  const res = await pool.query(text, params);
  return res.rows;
}

export async function close() {
  if (pool) await pool.end();
}

export const driver = isNeon ? 'neon' : 'pg';
