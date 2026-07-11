/**
 * Set-log persistence tests (Phase B): the write path the logging form will depend on.
 *   - round-trip: a full exercise's sets write and read back, typed values intact;
 *   - read shapes: per-exercise (chronological) and per-workout (grouped by exercise);
 *   - write serialization: concurrent logs from two exercises don't drop a set.
 *
 * Hits the real filesystem, so it runs against an isolated temp DATA_DIR set BEFORE importing
 * the store (node --test gives each file its own process, so the env override doesn't leak).
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SetLogEntry } from '../engine/types.ts';
import type { NewSetLog } from './setlog.ts';

const dir = await mkdtemp(join(tmpdir(), 'cc-setlog-'));
process.env.CC_DATA_DIR = dir;
const { writeCollection, readCollection } = await import('./json-store.ts');
const { saveSetLog, toSetLogEntry, upsertSet, removeSet } = await import('./setlog.ts');
const { setLogFor, setLogForExercise, setLogForWorkout } = await import('./query.ts');

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await writeCollection('set_log', []);
});

/** One set for athlete `ath-1`, overridable. */
function set(over: Partial<NewSetLog> & { exerciseId: string; setIndex: number }): NewSetLog {
  return {
    workoutId: 'w1', athleteId: 'ath-1', values: {}, ...over,
  };
}

test('toSetLogEntry fills id + timestamp and keeps optional fields off when unset', () => {
  const e = toSetLogEntry(set({ exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 } }),
    new Date('2026-07-09T12:00:00Z'));
  assert.ok(e.setLogId, 'generated an id');
  assert.equal(e.loggedAt, '2026-07-09T12:00:00.000Z');
  assert.deepEqual(e.values, { load: 40, reps: 5 });
  assert.ok(!('rpe' in e), 'no rpe key when omitted');
  assert.ok(!('note' in e), 'no note key when omitted');
  assert.ok(!('prescribed' in e), 'no prescribed key when omitted');
});

test('round-trip: a full exercise\'s sets write and read back with typed values', async () => {
  await saveSetLog([
    set({ exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 },
      prescribed: { sets: 3, reps: 8, rest_sec: 90 } }),
    set({ exerciseId: 'l_goblet_squat', setIndex: 2, values: { load: 42.5, reps: 5 } }),
    set({ exerciseId: 'l_goblet_squat', setIndex: 3, values: { load: 42.5, reps: 4 } }),
  ]);
  const sets = await setLogForExercise('ath-1', 'l_goblet_squat');
  assert.equal(sets.length, 3);
  assert.deepEqual(sets.map((s) => s.setIndex), [1, 2, 3], 'chronological, set order preserved');
  assert.deepEqual(sets[1]!.values, { load: 42.5, reps: 5 }, 'decimal load survives the JSON round-trip');
  assert.deepEqual(sets[0]!.prescribed, { sets: 3, reps: 8, rest_sec: 90 }, 'prescription snapshot stored');
});

test('setLogForExercise isolates by athlete and exercise', async () => {
  await saveSetLog([
    set({ exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 } }),
    set({ exerciseId: 's_falling_start', setIndex: 1, values: { time_s: 2.4 } }),
    set({ athleteId: 'ath-2', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 60, reps: 5 } }),
  ]);
  const squat = await setLogForExercise('ath-1', 'l_goblet_squat');
  assert.equal(squat.length, 1, 'only ath-1\'s squat sets');
  assert.equal(squat[0]!.values.load, 40);
  assert.equal((await setLogFor('ath-1')).length, 2, 'ath-1 has two exercises logged');
});

test('setLogForWorkout groups a session\'s sets by exercise, in set order', async () => {
  await saveSetLog([
    set({ workoutId: 'w9', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 } }),
    set({ workoutId: 'w9', exerciseId: 'j_broad_stick', setIndex: 1, values: { distance_cm: 180, reps: 1 } }),
    set({ workoutId: 'w9', exerciseId: 'l_goblet_squat', setIndex: 2, values: { load: 42.5, reps: 5 } }),
    set({ workoutId: 'w-other', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 20, reps: 5 } }),
  ]);
  const byExercise = await setLogForWorkout('w9');
  assert.deepEqual([...byExercise.keys()], ['l_goblet_squat', 'j_broad_stick'], 'first-seen exercise order');
  assert.deepEqual(byExercise.get('l_goblet_squat')!.map((s) => s.setIndex), [1, 2], 'squat sets ordered');
  assert.equal(byExercise.get('j_broad_stick')!.length, 1);
});

test('upsertSet creates a set when none exists at that identity', async () => {
  const saved = await upsertSet(set({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 } }));
  assert.ok(saved.setLogId, 'generated an id');
  const all = await readCollection('set_log');
  assert.equal(all.length, 1);
  assert.deepEqual(all[0]!.values, { load: 40, reps: 5 });
});

test('upsertSet REPLACES a set at the same (workout, exercise, setIndex) — no duplicate', async () => {
  const first = await upsertSet(set({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 } }));
  const second = await upsertSet(set({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 45, reps: 5 } }));
  const all = await readCollection('set_log');
  assert.equal(all.length, 1, 're-saving the same set does not append a duplicate');
  assert.deepEqual(all[0]!.values, { load: 45, reps: 5 }, 'actuals replaced');
  assert.equal(second.setLogId, first.setLogId, 'identity preserved across the replace');
  assert.equal(second.loggedAt, first.loggedAt, 'original timestamp preserved — the set keeps its place in history');
});

test('upsertSet keys on identity: different setIndex / exercise / workout are distinct records', async () => {
  await upsertSet(set({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 } }));
  await upsertSet(set({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 2, values: { load: 40, reps: 5 } }));
  await upsertSet(set({ workoutId: 'w1', exerciseId: 's_falling_start', setIndex: 1, values: { time_s: 2.4 } }));
  await upsertSet(set({ workoutId: 'w2', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 20, reps: 5 } }));
  assert.equal((await readCollection('set_log')).length, 4);
});

test('removeSet deletes only the identified set and is idempotent for a never-logged row', async () => {
  await upsertSet(set({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 } }));
  await upsertSet(set({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 2, values: { load: 42, reps: 5 } }));
  await removeSet({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 2 });
  const all = await readCollection('set_log');
  assert.deepEqual(all.map((s) => s.setIndex), [1], 'only set 2 removed');
  // Removing a set that was never logged (an untouched pre-fill) writes nothing — the honest-log rule.
  await removeSet({ workoutId: 'w1', exerciseId: 'l_goblet_squat', setIndex: 9 });
  assert.equal((await readCollection('set_log')).length, 1, 'no-op on a non-existent set');
});

test('concurrent logs from two exercises both persist (write serialization)', async () => {
  // Fire two exercise batches without awaiting the first — the in-process mutex must keep both.
  await Promise.all([
    saveSetLog([
      set({ exerciseId: 'l_goblet_squat', setIndex: 1, values: { load: 40, reps: 5 } }),
      set({ exerciseId: 'l_goblet_squat', setIndex: 2, values: { load: 40, reps: 5 } }),
    ]),
    saveSetLog([
      set({ exerciseId: 's_falling_start', setIndex: 1, values: { time_s: 2.4 } }),
      set({ exerciseId: 's_falling_start', setIndex: 2, values: { time_s: 2.3 } }),
    ]),
  ]);
  const all = await readCollection('set_log');
  assert.equal(all.length, 4, 'no set dropped by an interleaved read-modify-write');
});
