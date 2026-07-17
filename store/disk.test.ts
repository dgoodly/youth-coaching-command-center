/**
 * Disk-store tests: the shared RecordStore contract (see `store/record-store.contract.ts`)
 * run against `createDiskStore`, plus disk-side domain integration — `saveAssessment`'s
 * dual-write riding `appendAll` end-to-end through the real filesystem.
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDiskStore } from './disk.ts';
import { buildAssessmentRecord, saveAssessment } from './ingest.ts';
import { runRecordStoreContract } from './record-store.contract.ts';

const dir = await mkdtemp(join(tmpdir(), 'cc-disk-'));
const store = createDiskStore(dir);
let freshCount = 0;

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

runRecordStoreContract('disk', {
  store,
  // A subdir that has never been written to — still cleaned up by the after() above.
  fresh: () => createDiskStore(join(dir, `fresh-${freshCount++}`)),
});

// ---------------------------------------------------------------------------
// Domain integration over disk: the assessment dual-write (contract rule 4)
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await store.write('assessments', []);
  await store.write('height_log', []);
});

test('saveAssessment persists the assessment and its dual-written height entry together', async () => {
  const built = buildAssessmentRecord({
    athleteId: 'ath-2', date: '2026-07-02', tester: 'Coach',
    scores: { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 },
    coachGutCall: 'A', heightCm: 152, sittingHeightCm: 80,
  });
  await saveAssessment(store, built);

  const assessments = await store.read('assessments');
  const heights = await store.read('height_log');
  assert.equal(assessments.length, 1);
  assert.equal(heights.length, 1);
  assert.equal(heights[0]!.heightCm, 152);
  assert.equal(heights[0]!.sittingHeightCm, 80);
  assert.equal(heights[0]!.source, 'assessment');
  // The recompute-as-source-of-truth invariant still holds through the store path.
  assert.equal(assessments[0]!.finalTier, 'A');
});

test('saveAssessment with no height entry writes only the assessment', async () => {
  const built = buildAssessmentRecord({
    athleteId: 'ath-3', date: '2026-07-03', tester: 'Coach',
    scores: { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 },
    coachGutCall: null, heightCm: null,
  });
  await saveAssessment(store, built);
  assert.equal((await store.read('assessments')).length, 1);
  assert.equal((await store.read('height_log')).length, 0);
});
