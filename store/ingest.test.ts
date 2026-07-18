/**
 * Field-form ingest tests — the contract rules in `Field_Form_Data_Contract.md`.
 * Covers: recompute-as-source-of-truth, paper-mismatch surfacing, the Test-5 CAP RULE,
 * height dual-write prep, and input validation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAssessmentRecord, nextAssessmentDate, type FieldFormInput } from './ingest.ts';
import type { Scores } from '../engine/types.ts';

function form(over: Partial<FieldFormInput> = {}): FieldFormInput {
  const scores: Scores = { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 };
  return {
    athleteId: 'ath-1',
    date: '2026-06-30',
    tester: 'Parent',
    scores,
    coachGutCall: null,
    priorTier: null,
    heightCm: 140,
    ...over,
  };
}

test('recomputes raw/base/final from scores (source of truth)', () => {
  const { assessment } = buildAssessmentRecord(form());
  assert.equal(assessment.rawTotal, 14);
  assert.equal(assessment.baseTier, 'A');
  assert.equal(assessment.finalTier, 'A');
  assert.equal(assessment.gateFired, 'none');
});

test('CAP RULE: broadLandingFailed caps broad at 1 and warns', () => {
  const { assessment, warnings } = buildAssessmentRecord(
    form({ scores: { squat: 3, dropStick: 3, balance: 3, pushup: 3, broad: 3, pogo: 3 }, broadLandingFailed: true }),
  );
  assert.equal(assessment.scoresLive.broad, 1, 'broad capped to 1');
  assert.equal(assessment.rawTotal, 16, 'raw reflects the capped broad (18-2)');
  assert.ok(warnings.some((w) => w.includes('CAP RULE')), 'warns about the cap');
});

test('CAP RULE does not raise a broad already <= 1', () => {
  const { assessment } = buildAssessmentRecord(
    form({ scores: { squat: 3, dropStick: 3, balance: 3, pushup: 3, broad: 0, pogo: 3 }, broadLandingFailed: true }),
  );
  assert.equal(assessment.scoresLive.broad, 0);
});

test('paper mismatch is surfaced and the computed value wins', () => {
  const { assessment, warnings } = buildAssessmentRecord(
    form({ paper: { rawTotal: 15, finalTier: 'S' } }),
  );
  assert.equal(assessment.rawTotal, 14, 'computed wins');
  assert.equal(assessment.finalTier, 'A');
  assert.ok(assessment.paperMismatch, 'mismatch recorded');
  assert.deepEqual(assessment.paperMismatch?.rawTotal, { paper: 15, computed: 14 });
  assert.deepEqual(assessment.paperMismatch?.finalTier, { paper: 'S', computed: 'A' });
  assert.equal(warnings.length, 2);
});

test('no paperMismatch field when paper matches', () => {
  const { assessment } = buildAssessmentRecord(form({ paper: { rawTotal: 14, baseTier: 'A', finalTier: 'A' } }));
  assert.equal(assessment.paperMismatch, undefined);
});

test('height is prepped for dual-write to the height log (contract rule 4)', () => {
  const { heightEntry } = buildAssessmentRecord(form({ heightCm: 152.5 }));
  assert.ok(heightEntry);
  assert.equal(heightEntry?.heightCm, 152.5);
  assert.equal(heightEntry?.source, 'assessment');
  assert.equal(heightEntry?.date, '2026-06-30');
});

test('no height entry when heightCm is null', () => {
  const { heightEntry } = buildAssessmentRecord(form({ heightCm: null }));
  assert.equal(heightEntry, null);
});

test('coach gut-call is stored verbatim (validation field)', () => {
  const { assessment } = buildAssessmentRecord(form({ coachGutCall: 'B' }));
  assert.equal(assessment.coachGutCall, 'B');
});

test('invalid score throws (all six required, 0–3)', () => {
  assert.throws(
    () => buildAssessmentRecord(form({ scores: { squat: 4 as 3, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 } })),
    /Score "squat" must be an integer 0–3/,
  );
});

test('nextAssessmentDate adds whole weeks (default 5)', () => {
  assert.equal(nextAssessmentDate('2026-06-30'), '2026-08-04');
  assert.equal(nextAssessmentDate('2026-06-30', 4), '2026-07-28');
  assert.equal(nextAssessmentDate('2026-06-30', 6), '2026-08-11');
});
