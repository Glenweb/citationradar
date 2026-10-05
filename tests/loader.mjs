/**
 * Test-only ESM resolver.
 *
 * The source uses the import style Next.js expects: extensionless relative specifiers
 * and the `@/*` path alias. Node's own resolver requires explicit extensions and knows
 * nothing about tsconfig paths, so rather than contort the source to suit the test
 * runner, this hook teaches the runner to resolve the source as written.
 *
 * Node's built-in type stripping handles the TypeScript itself.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..', 'src');
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

/** Try `spec`, `spec.ts`, `spec/index.ts`, … and return the first that exists. */
function firstExisting(basePath) {
  if (existsSync(basePath) && path.extname(basePath)) return basePath;
  for (const ext of EXTENSIONS) {
    const candidate = `${basePath}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(basePath, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  // `@/foo` → `<repo>/src/foo`
  if (specifier.startsWith('@/')) {
    const resolved = firstExisting(path.join(SRC, specifier.slice(2)));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  // Extensionless relative specifier inside the source tree.
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolved = firstExisting(path.resolve(parentDir, specifier));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  // `server-only` is a Next.js build-time guard with no runtime behaviour we need here.
  if (specifier === 'server-only') {
    return { url: pathToFileURL(path.join(import.meta.dirname, 'stub-empty.mjs')).href, shortCircuit: true };
  }

  return next(specifier, context);
}
