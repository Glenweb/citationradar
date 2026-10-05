import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { Pool } from 'pg';
import { env } from './env';

/**
 * Dual-driver data layer.
 *
 * Neon's HTTP driver is the right choice on Vercel — no TCP pool to leak across
 * serverless invocations. But it only speaks to Neon, so local development against a
 * plain Postgres would be impossible with it alone. We therefore pick the driver from
 * the connection string's host and expose one interface to the rest of the app.
 *
 *   *.neon.tech  → @neondatabase/serverless (HTTP)
 *   anything else → pg (TCP pool)
 *
 * Both paths parameterise values; neither ever interpolates into SQL text.
 */

type Driver = 'neon' | 'pg';

let driver: Driver | null = null;
let neonClient: NeonQueryFunction<false, false> | null = null;
let pgPool: Pool | null = null;

function resolveDriver(url: string): Driver {
  try {
    return /\.neon\.tech$/i.test(new URL(url).hostname) ? 'neon' : 'pg';
  } catch {
    return 'pg';
  }
}

function init() {
  if (driver) return;
  const url = env.databaseUrl;
  driver = resolveDriver(url);
  if (driver === 'neon') {
    neonClient = neon(url);
  } else {
    pgPool = new Pool({
      connectionString: url,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
  }
}

export function activeDriver(): Driver {
  init();
  return driver!;
}

/**
 * Convert a tagged template into `$1, $2 …` placeholder SQL.
 * `sql`SELECT * FROM t WHERE id = ${id}`` → ('SELECT * FROM t WHERE id = $1', [id])
 */
function toPlaceholders(strings: readonly string[], values: unknown[]): [string, unknown[]] {
  let text = '';
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i] ?? '';
    if (i < values.length) text += `$${i + 1}`;
  }
  return [text, values];
}

/**
 * Run a parameterised query and return all rows.
 *
 *   const rows = await sql<Site>`SELECT * FROM sites WHERE workspace_id = ${wsId}`;
 */
export async function sql<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  init();
  if (driver === 'neon') {
    return (await neonClient!(strings, ...values)) as unknown as T[];
  }
  const [text, params] = toPlaceholders(strings, values);
  const res = await pgPool!.query(text, params);
  return res.rows as T[];
}

/** Run a parameterised query and return the first row, or null. */
export async function sqlOne<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T | null> {
  const rows = await sql<T>(strings, ...values);
  return rows[0] ?? null;
}

/**
 * Raw placeholder query, for the rare dynamic case (e.g. a variable-length IN list).
 * Callers build the placeholder text; values stay parameterised.
 */
export async function sqlRaw<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  init();
  if (driver === 'neon') {
    const q = neonClient! as unknown as {
      query: (t: string, p: unknown[]) => Promise<unknown>;
    };
    return (await q.query(text, params)) as T[];
  }
  const res = await pgPool!.query(text, params);
  return res.rows as T[];
}

export async function dbHealthy(): Promise<{ ok: boolean; driver?: Driver; error?: string }> {
  try {
    await sql`SELECT 1`;
    return { ok: true, driver: activeDriver() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
