/**
 * JSON-store I/O tests — the write path the dashboard now depends on (Phase 1):
 *   - write serialization: two overlapping appends must not lose an update, and
 *   - dual-write atomicity: assessment + height entry commit together (assessment first).
 *
 * Unlike the other store tests (which exercise pure functions), these hit the real filesystem,
 * so they run against an isolated temp DATA_DIR set BEFORE importing the store. `node --test`
 * runs each test file in its own process, so this env override does not leak to sibling suites.
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AthleteProfile, Assessment, HeightLogEntry, Scores } from '../engine/types.ts';

// Point the store at a throwaway dir, then import it so DATA_DIR binds to the override.
const dir = await mkdtemp(join(tmpdir(), 'cc-store-'));
process.env.CC_DATA_DIR = dir;
const { append, appendAll, readCollection, writeCollection } = await import('./json-store.ts');
const { buildAssessmentRecord, saveAssessment } = await import('./ingest.ts');

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Reset the collections this suite touches before each test.
beforeEach(async () => {
  await writeCollection('athletes', []);
  await writeCollection('assessments', []);
  await writeCollection('height_log', []);
});

function mkAthlete(id: string): AthleteProfile {
  return {
    athleteId: id, displayName: id, dob: null, sex: null, sports: [],
    trainingMonths: 0, valgusWatch: false, weeklySportHours: null,
    weeklyTrainingHours: null, restDaysPerWeek: null,
    createdAt: '2026-01-01T00:00:00Z', notes: '',
  };
}

test('two overlapping appends to the same collection both persist (write serialization)', async () => {
  await writeCollection('athletes', []);
  // Fire both without awaiting the first — without the in-process mutex these interleave
  // (both read [], both write length-1) and one is lost.
  await Promise.all([append('athletes', mkAthlete('a')), append('athletes', mkAthlete('b'))]);
  const all = await readCollection('athletes');
  assert.equal(all.length, 2, 'neither append was dropped');
  assert.deepEqual(all.map((a) => a.athleteId).sort(), ['a', 'b']);
});

test('many concurrent appends all land', async () => {
  await writeCollection('athletes', []);
  await Promise.all(Array.from({ length: 25 }, (_, i) => append('athletes', mkAthlete(`n${i}`))));
  const all = await readCollection('athletes');
  assert.equal(all.length, 25);
});

test('appendAll commits across collections as one unit (assessment + height log)', async () => {
  const scores: Scores = { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 };
  const assessment = { assessmentId: 'x1', athleteId: 'ath-1', date: '2026-07-01', tester: 'Coach',
    scores, rawTotal: 14, baseTier: 'A', finalTier: 'A', gateFired: 'none',
    coachGutCall: null, heightCm: 150, videoRefs: [], notes: '' } satisfies Assessment;
  const height = { athleteId: 'ath-1', date: '2026-07-01', heightCm: 150, source: 'assessment' } satisfies HeightLogEntry;

  await appendAll([
    { collection: 'assessments', record: assessment },
    { collection: 'height_log', record: height },
  ]);

  assert.equal((await readCollection('assessments')).length, 1);
  assert.equal((await readCollection('height_log')).length, 1);
});

test('saveAssessment persists the assessment and its dual-written height entry together', async () => {
  const built = buildAssessmentRecord({
    athleteId: 'ath-2', date: '2026-07-02', tester: 'Coach',
    scores: { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 },
    coachGutCall: 'A', heightCm: 152, sittingHeightCm: 80,
  });
  await saveAssessment(built);

  const assessments = await readCollection('assessments');
  const heights = await readCollection('height_log');
  assert.equal(assessments.length, 1);
  assert.equal(heights.length, 1);
  assert.equal(heights[0]!.heightCm, 152);
  assert.equal(heights[0]!.sittingHeightCm, 80);
  assert.equal(heights[0]!.source, 'assessment');
  // The recompute-as-source-of-truth invariant still holds through the store path.
  assert.equal(assessments[0]!.finalTier, 'A');
});

test('appendAll with no height entry writes only the assessment', async () => {
  const built = buildAssessmentRecord({
    athleteId: 'ath-3', date: '2026-07-03', tester: 'Coach',
    scores: { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 },
    coachGutCall: null, heightCm: null,
  });
  await saveAssessment(built);
  assert.equal((await readCollection('assessments')).length, 1);
  assert.equal((await readCollection('height_log')).length, 0);
});
