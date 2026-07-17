/**
 * Architecture guard (review A1): the durable core must import ONLY from `engine/*`. Production
 * engine files may not import `store/*` (or cli/dashboard) — that's what lets the engine transfer
 * into a future app untouched. Test files are exempt (they load the real library to exercise it).
 * This test enforces the boundary that was previously convention-only, and had already given way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

test('no production engine/* file imports from store/cli/dashboard', async () => {
  const files = (await readdir(HERE)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  assert.ok(files.length >= 5, 'found the engine source files');
  const offenders: string[] = [];
  for (const f of files) {
    const src = await readFile(join(HERE, f), 'utf8');
    // Match a real import/export-from specifier that escapes the engine directory.
    if (/from\s+['"]\.\.\/(store|cli|dashboard)\//.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `engine files importing outside the core: ${offenders.join(', ')}`);
});

/**
 * The root tsconfig gained lib DOM for the IndexedDB store (S2), which means the compiler no
 * longer rejects `window`/`document` in engine code — the type-level portability seam is gone
 * until the configs split at S5. This makes the guarantee enforced rather than remembered:
 * production engine files must not touch browser globals. Comments and string literals are
 * stripped first ("PHV window" is prose, not a global).
 */
test('no production engine/* file references DOM globals (engine stays environment-free)', async () => {
  const DOM_GLOBALS =
    /\b(window|document|navigator|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|alert|location|history)\b|\bIDB[A-Z]\w*/;
  const files = (await readdir(HERE)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const offenders: string[] = [];
  for (const f of files) {
    const src = await readFile(join(HERE, f), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/[^\n]*/g, '') // line comments
      .replace(/`(?:\\.|[^`\\])*`/g, "''") // template literals
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, "''");
    const hit = DOM_GLOBALS.exec(code);
    if (hit) offenders.push(`${f} (${hit[0]})`);
  }
  assert.deepEqual(offenders, [], `engine files touching browser globals: ${offenders.join(', ')}`);
});
