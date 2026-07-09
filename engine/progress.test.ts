/**
 * Progress/PR tests (Phase D) — the durable-core invariants the athlete surface leans on:
 *   - PR DIRECTION is per-metric via `higherIsBetter`: a heavier squat load is a PR; a FASTER
 *     sprint time is a PR (lower wins);
 *   - the trend series is best-per-session, chronological;
 *   - a single session degrades gracefully (a PR, but no trend yet) — the maturity two-entry rule.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeExerciseProgress } from './progress.ts';
import type { SetLogEntry } from './types.ts';

let seq = 0;
/** A set with the given values, in session `workoutId`, logged on `date` (date → ISO datetime). */
function set(workoutId: string, date: string, values: Record<string, number>, setIndex = 1): SetLogEntry {
  return { setLogId: `s${seq++}`, workoutId, athleteId: 'a1', exerciseId: 'ex', setIndex,
    values, loggedAt: `${date}T10:00:00.000Z` };
}

test('load PR is the MAX across all sets (higher is better)', () => {
  const p = computeExerciseProgress('l_goblet_squat', ['load', 'reps'], [
    set('w1', '2026-07-01', { load: 40, reps: 5 }, 1),
    set('w1', '2026-07-01', { load: 42.5, reps: 5 }, 2),
    set('w2', '2026-07-08', { load: 45, reps: 5 }, 1),
    set('w2', '2026-07-08', { load: 45, reps: 3 }, 2),
  ]);
  const load = p.metrics.find((m) => m.metricId === 'load')!;
  assert.equal(load.best, 45, 'heaviest load is the PR');
  assert.equal(load.bestAt, '2026-07-08T10:00:00.000Z');
  assert.equal(load.last, 45, 'last session best');
});

test('sprint time PR is the MIN (lower is better) — direction comes from the catalog', () => {
  const p = computeExerciseProgress('s_flying_sprint', ['time_s'], [
    set('w1', '2026-07-01', { time_s: 2.6 }),
    set('w2', '2026-07-08', { time_s: 2.4 }),
    set('w3', '2026-07-15', { time_s: 2.5 }),
  ]);
  const t = p.metrics.find((m) => m.metricId === 'time_s')!;
  assert.equal(t.best, 2.4, 'fastest time is the PR');
  assert.equal(t.bestAt, '2026-07-08T10:00:00.000Z');
  assert.equal(t.last, 2.5, 'most recent session, even though it is not the PR');
});

test('trend series is best-per-session, ordered oldest → newest', () => {
  const p = computeExerciseProgress('l_goblet_squat', ['load'], [
    // deliberately out of order + two sets per session
    set('w2', '2026-07-08', { load: 44 }, 1),
    set('w1', '2026-07-01', { load: 40 }, 1),
    set('w2', '2026-07-08', { load: 46 }, 2),
    set('w1', '2026-07-01', { load: 42 }, 2),
    set('w3', '2026-07-15', { load: 47 }, 1),
  ]);
  const load = p.metrics.find((m) => m.metricId === 'load')!;
  assert.deepEqual(load.series.map((pt) => pt.value), [42, 46, 47], 'per-session best, chronological');
  assert.deepEqual(load.series.map((pt) => pt.workoutId), ['w1', 'w2', 'w3']);
  assert.equal(p.sessionCount, 3);
  assert.equal(p.hasTrend, true);
});

test('a single session yields a PR but no trend (needs two entries — mirrors maturity)', () => {
  const p = computeExerciseProgress('l_goblet_squat', ['load', 'reps'], [
    set('w1', '2026-07-01', { load: 40, reps: 8 }),
  ]);
  assert.equal(p.sessionCount, 1);
  assert.equal(p.hasTrend, false, 'one session → no trend yet');
  const load = p.metrics.find((m) => m.metricId === 'load')!;
  assert.equal(load.best, 40, 'a single value is trivially the best');
  assert.equal(load.series.length, 1);
});

test('a declared-but-never-logged metric reports nulls (stable rows for the UI)', () => {
  const p = computeExerciseProgress('l_goblet_squat', ['load', 'reps'], [
    set('w1', '2026-07-01', { load: 40 }), // reps never entered
  ]);
  const reps = p.metrics.find((m) => m.metricId === 'reps')!;
  assert.equal(reps.best, null);
  assert.equal(reps.last, null);
  assert.deepEqual(reps.series, []);
});

test('no sets at all → every metric is empty, no trend', () => {
  const p = computeExerciseProgress('l_goblet_squat', ['load', 'reps'], []);
  assert.equal(p.sessionCount, 0);
  assert.equal(p.hasTrend, false);
  assert.ok(p.metrics.every((m) => m.best === null && m.series.length === 0));
});

test('a tied best keeps the EARLIEST achievement date', () => {
  const p = computeExerciseProgress('l_goblet_squat', ['load'], [
    set('w1', '2026-07-01', { load: 50 }),
    set('w2', '2026-07-08', { load: 50 }), // ties the PR — not a new one
  ]);
  const load = p.metrics.find((m) => m.metricId === 'load')!;
  assert.equal(load.best, 50);
  assert.equal(load.bestAt, '2026-07-01T10:00:00.000Z', 'earliest time the best was hit');
});
