#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql in filename order, recording each in `_migrations`.
 * Usage: node scripts/migrate.mjs [--reset]
 *
 * Statements are split on semicolons at top level (ignoring those inside quotes,
 * dollar-quoted blocks and comments) because the Neon HTTP driver executes one
 * statement per round trip.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exec, close, driver } from './_sql.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'db', 'migrations');
const reset = process.argv.includes('--reset');


/** Split a SQL file into executable statements. */
function splitStatements(text) {
  const out = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let dollarTag = null;

  while (i < text.length) {
    const ch = text[i];
    const next2 = text.slice(i, i + 2);

    if (!inSingle && !inDouble && !dollarTag) {
      if (next2 === '--') {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? text.length : nl + 1;
        continue;
      }
      if (next2 === '/*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? text.length : end + 2;
        continue;
      }
      const dollar = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (dollar) {
        dollarTag = dollar[0];
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
      if (ch === ';') {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
        i += 1;
        continue;
      }
    } else if (dollarTag && text.startsWith(dollarTag, i)) {
      buf += dollarTag;
      i += dollarTag.length;
      dollarTag = null;
      continue;
    }

    if (!dollarTag) {
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function run() {
  console.log(`driver: ${driver}`);
  if (reset) {
    console.log('↺ --reset: dropping public schema');
    await exec("DROP SCHEMA public CASCADE");
    await exec("CREATE SCHEMA public");
  }

  await exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const applied = new Set((await exec('SELECT name FROM _migrations')).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· ${file} (already applied)`);
      continue;
    }
    const text = await readFile(path.join(dir, file), 'utf8');
    const statements = splitStatements(text);
    process.stdout.write(`→ ${file} (${statements.length} statements) `);
    for (const [idx, stmt] of statements.entries()) {
      try {
        await exec(stmt);
      } catch (e) {
        console.error(`\n✗ ${file} statement ${idx + 1} failed:\n${stmt}\n\n${e.message}`);
        process.exit(1);
      }
    }
    await exec('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    console.log('✓');
    count += 1;
  }
  await close();
  console.log(count ? `\nApplied ${count} migration(s).` : '\nSchema already up to date.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
