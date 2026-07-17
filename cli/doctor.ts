/**
 * Data doctor CLI — scan the JSON store for integrity gaps (disposable surface).
 *
 *   npm run doctor            — report only.
 *   npm run doctor -- --fix   — also backfill missing height-log entries.
 *
 * v1 checks the assessment→height-log dual-write invariant (see store/doctor.ts): every
 * assessment with a heightCm should have a matching height_log entry. The dual-write in
 * store/ingest.ts is not atomic, so a crash between its two writes can drop the height entry.
 */

import { stdout, argv } from 'node:process';

import { createDiskStore } from '../store/disk.ts';
import { findHeightLogGaps, backfillEntriesFor } from '../store/doctor.ts';

const line = (s = ''): void => void stdout.write(s + '\n');
const fix = argv.includes('--fix');
const store = createDiskStore();

async function main(): Promise<void> {
  const assessments = await store.read('assessments');
  const heightLog = await store.read('height_log');
  const gaps = findHeightLogGaps(assessments, heightLog);

  line('\n=== Data doctor ===\n');
  if (gaps.length === 0) {
    line('✓ Height log: every assessment with a height has a matching height_log entry.\n');
    return;
  }

  line(`⚠ ${gaps.length} assessment(s) with a height but no matching height_log entry:`);
  for (const g of gaps) {
    line(`  · ${g.athleteId}  ${g.date}  ${g.heightCm} cm  (assessment ${g.assessmentId})`);
  }

  if (!fix) {
    line('\nRun `npm run doctor -- --fix` to backfill these into the height log.\n');
    return;
  }

  const entries = backfillEntriesFor(gaps);
  await store.write('height_log', [...heightLog, ...entries]);
  line(`\n✓ Backfilled ${entries.length} height-log entr${entries.length === 1 ? 'y' : 'ies'} (source: assessment).\n`);
}

await main();
