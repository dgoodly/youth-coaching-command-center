/**
 * Store-doctor tests — the assessment→height-log dual-write gap scan (issue #3). Pure: no I/O,
 * mirrors the ingest tests' fixture style.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findHeightLogGaps, backfillEntriesFor } from './doctor.ts';
import { buildAssessmentRecord, type FieldFormInput } from './ingest.ts';
import type { Assessment, HeightLogEntry, Scores } from '../engine/types.ts';

function mkAssessment(over: Partial<Assessment> = {}): Assessment {
  const scores: Scores = { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 };
  return {
    assessmentId: 'a1', athleteId: 'ath-1', date: '2026-06-30', tester: 'Parent',
    scores, rawTotal: 14, baseTier: 'A', finalTier: 'A', gateFired: 'none',
    coachGutCall: null, heightCm: 140, videoRefs: [], notes: '', ...over,
  };
}
function mkHeight(over: Partial<HeightLogEntry> = {}): HeightLogEntry {
  return { athleteId: 'ath-1', date: '2026-06-30', heightCm: 140, source: 'assessment', ...over };
}

test('flags an assessment whose height never made it into the height log', () => {
  const gaps = findHeightLogGaps([mkAssessment()], []); // no height entries at all
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0], { assessmentId: 'a1', athleteId: 'ath-1', date: '2026-06-30', heightCm: 140 });
});

test('no gap when a matching height entry exists (athleteId + date + heightCm)', () => {
  const gaps = findHeightLogGaps([mkAssessment()], [mkHeight()]);
  assert.deepEqual(gaps, []);
});

test('a differing height (same athlete/date, different cm) is still a gap', () => {
  const gaps = findHeightLogGaps([mkAssessment({ heightCm: 141 })], [mkHeight({ heightCm: 140 })]);
  assert.equal(gaps.length, 1, 'height mismatch is not a match');
});

test('assessments with null heightCm are ignored (no dual-write was owed)', () => {
  const gaps = findHeightLogGaps([mkAssessment({ heightCm: null })], []);
  assert.deepEqual(gaps, []);
});

test('backfillEntriesFor builds source=assessment entries that close the gaps', () => {
  const gaps = findHeightLogGaps([mkAssessment()], []);
  const entries = backfillEntriesFor(gaps);
  assert.deepEqual(entries, [{ athleteId: 'ath-1', date: '2026-06-30', heightCm: 140, source: 'assessment' }]);
  // Re-scanning with the backfilled entries applied must report no gaps.
  assert.deepEqual(findHeightLogGaps([mkAssessment()], entries), []);
});

test('a freshly-built assessment + its heightEntry has no gap (ties ingest to the invariant)', () => {
  const form: FieldFormInput = {
    athleteId: 'ath-9', date: '2026-07-01', tester: 'Parent',
    scores: { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 },
    coachGutCall: null, heightCm: 150,
  };
  const built = buildAssessmentRecord(form);
  assert.ok(built.heightEntry, 'ingest prepped a height entry for a non-null heightCm');
  assert.deepEqual(findHeightLogGaps([built.assessment], [built.heightEntry!]), []);
});
