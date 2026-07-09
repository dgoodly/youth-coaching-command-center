/**
 * Session-record tests (Phase C) — the two semantics the coach's notes pinned down:
 *   1. getOrCreateWorkout is ATOMIC: concurrent first-logs of the same session converge on ONE
 *      record, never a duplicate;
 *   2. `completed` is only ever the coach's explicit action — creation (i.e. logging) leaves it
 *      false, and a half-logged session must not read as done.
 *
 * Hits the real filesystem, so it runs against an isolated temp DATA_DIR set before importing.
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'cc-workout-'));
process.env.CC_DATA_DIR = dir;
const { writeCollection, readCollection } = await import('./json-store.ts');
const { getOrCreateWorkout, setWorkoutCompleted } = await import('./workout.ts');

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await writeCollection('workout_log', []);
});

const KEY = { athleteId: 'ath-1', date: '2026-07-09', sessionLabel: 'Day 1' } as const;

test('getOrCreateWorkout creates a session record with completed=false', async () => {
  const w = await getOrCreateWorkout(KEY, 'A');
  assert.ok(w.workoutId, 'has an id');
  assert.equal(w.completed, false, 'logging never marks a session done');
  assert.equal(w.servedForTier, 'A');
  assert.equal((await readCollection('workout_log')).length, 1);
});

test('getOrCreateWorkout finds the existing record for the same session (no duplicate)', async () => {
  const first = await getOrCreateWorkout(KEY, 'A');
  const second = await getOrCreateWorkout(KEY, 'A');
  assert.equal(second.workoutId, first.workoutId, 'same session → same record');
  assert.equal((await readCollection('workout_log')).length, 1, 'still one row');
});

test('a different date or session is a distinct record', async () => {
  await getOrCreateWorkout(KEY, 'A');
  await getOrCreateWorkout({ ...KEY, date: '2026-07-16' }, 'A');
  await getOrCreateWorkout({ ...KEY, sessionLabel: 'Day 2' }, 'A');
  assert.equal((await readCollection('workout_log')).length, 3);
});

test('concurrent first-logs of the same session converge on ONE record (atomic find-or-create)', async () => {
  // Fire many without awaiting — a non-atomic read-then-append would let several see "none yet"
  // and each create a duplicate.
  const results = await Promise.all(Array.from({ length: 12 }, () => getOrCreateWorkout(KEY, 'A')));
  const rows = await readCollection('workout_log');
  assert.equal(rows.length, 1, 'exactly one session record despite concurrent creates');
  const ids = new Set(results.map((w) => w.workoutId));
  assert.equal(ids.size, 1, 'every caller got the same workoutId');
});

test('setWorkoutCompleted flips the flag and reopen flips it back; unknown id → null', async () => {
  const w = await getOrCreateWorkout(KEY, 'A');
  const done = await setWorkoutCompleted(w.workoutId, true);
  assert.equal(done?.completed, true);
  assert.equal((await readCollection('workout_log'))[0]!.completed, true, 'persisted');

  const reopened = await setWorkoutCompleted(w.workoutId, false);
  assert.equal(reopened?.completed, false);

  assert.equal(await setWorkoutCompleted('nope', true), null, 'unknown id → null, no throw');
});
