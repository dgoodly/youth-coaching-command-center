/**
 * Migration CLI — bring the disk store's records up to the current schema.
 *
 *   npm run migrate             — migrate the working data dir (honours CC_DATA_DIR)
 *
 * v1 → v2 (S4): the assessment reshape. Idempotent — new-shape records pass through
 * untouched, so running it twice is a no-op. The IndexedDB store migrates itself in
 * `onupgradeneeded`; this CLI is the disk carrier of the same pure function
 * (store/migrations.ts).
 */

import { stdout } from 'node:process';

import { createDiskStore } from '../store/disk.ts';
import { isLegacyAssessment, migrateAssessmentRecord } from '../store/migrations.ts';

const line = (s = ''): void => void stdout.write(s + '\n');
const store = createDiskStore();

async function main(): Promise<void> {
  line(`\n=== Schema migration (${store.dir}) ===\n`);
  let migrated = 0;
  await store.update('assessments', (all) =>
    all.map((record) => {
      if (!isLegacyAssessment(record)) return record;
      migrated += 1;
      return migrateAssessmentRecord(record);
    }),
  );
  const total = (await store.read('assessments')).length;
  if (migrated === 0) {
    line(`✓ Nothing to do — all ${total} assessment${total === 1 ? '' : 's'} already current.\n`);
  } else {
    line(`✓ Migrated ${migrated} of ${total} assessment${total === 1 ? '' : 's'} to the v2 shape (scoresLive/scoresReviewed, films).\n`);
  }
}

await main();
