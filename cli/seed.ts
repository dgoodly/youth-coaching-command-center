/**
 * Seed CLI — populate the local JSON store with SAMPLE (non-real) data so a fresh clone comes
 * up looking like a working command center: a small roster across tiers, assessments, height /
 * maturity history, and a few logged sessions with PRs and trends.
 *
 *   npm run seed              — populate an empty store (refuses if data already exists).
 *   npm run seed -- --force   — overwrite the working data with the seed set.
 *
 * Copies data/seed/<collection>.json → the working data dir (store DATA_DIR, honouring
 * CC_DATA_DIR). The seed lives in a committed subfolder; the working files stay gitignored, so
 * this can never overwrite — or leak — real athlete data. Non-destructive by default: it refuses
 * if any target collection already holds records, so it won't clobber a populated store.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdout, argv, exit } from 'node:process';

import { DATA_DIR } from '../store/json-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = resolve(HERE, '..', 'data', 'seed');
const line = (s = ''): void => void stdout.write(s + '\n');
const force = argv.includes('--force');

/** True if a store file already holds real records (non-empty, not `[]`). */
async function hasData(file: string): Promise<boolean> {
  if (!existsSync(file)) return false;
  const raw = (await readFile(file, 'utf8')).trim();
  return raw !== '' && raw !== '[]';
}

async function main(): Promise<void> {
  if (!existsSync(SEED_DIR)) throw new Error(`No seed data found at ${SEED_DIR}.`);
  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`No seed .json files in ${SEED_DIR}.`);

  await mkdir(DATA_DIR, { recursive: true });

  // Guard: never silently overwrite a store that already has data.
  if (!force) {
    const occupied: string[] = [];
    for (const f of files) if (await hasData(join(DATA_DIR, f))) occupied.push(f);
    if (occupied.length > 0) {
      line(`\n⚠ The store already has data (${occupied.join(', ')}).`);
      line('Re-run with `npm run seed -- --force` to overwrite it with the sample set.\n');
      exit(1);
    }
  }

  line('\n=== Seeding sample data ===\n');
  for (const f of files) {
    await writeFile(join(DATA_DIR, f), await readFile(join(SEED_DIR, f), 'utf8'), 'utf8');
    line(`  ✓ ${f}`);
  }
  line(`\nSeeded ${files.length} collections into ${DATA_DIR}.`);
  line('Start the dashboard: npm run dashboard\n');
}

await main();
