/**
 * Disk-store tests — the RecordStore contract as implemented by `createDiskStore`:
 *   - write serialization: overlapping mutations never lose an update (contract #2);
 *   - `appendAll` multi-collection commit (contract #3, disk approximation);
 *   - record-level ops: get/put/remove/updateRecord, incl. the pinned null semantics
 *     (null + existing → delete; null + absent → no-op);
 *   - `queryBy` indexed reads (contract #4);
 *   - duplicate-key rejection on append/appendAll/write — the validation rule the disk
 *     fake may NOT be more permissive about than IndexedDB (contract #5).
 *
 * Hits the real filesystem against an isolated temp dir. Instance-based: each suite
 * constructs its own store — no env-var-before-import tricks. In S2 the contract cases
 * here become the shared suite both implementations run.
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AthleteProfile, Assessment, HeightLogEntry, Scores, SetLogEntry } from '../engine/types.ts';
import { createDiskStore } from './disk.ts';
import { buildAssessmentRecord, saveAssessment } from './ingest.ts';

const dir = await mkdtemp(join(tmpdir(), 'cc-disk-'));
const store = createDiskStore(dir);

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Reset the collections this suite touches before each test.
beforeEach(async () => {
  await store.write('athletes', []);
  await store.write('assessments', []);
  await store.write('height_log', []);
  await store.write('set_log', []);
});

function mkAthlete(id: string): AthleteProfile {
  return {
    athleteId: id, displayName: id, dob: null, sex: null, sports: [],
    trainingMonths: 0, valgusWatch: false, weeklySportHours: null,
    weeklyTrainingHours: null, restDaysPerWeek: null,
    createdAt: '2026-01-01T00:00:00Z', notes: '',
  };
}

function mkSet(workoutId: string, exerciseId: string, setIndex: number, load: number): SetLogEntry {
  return {
    setLogId: `${workoutId}-${exerciseId}-${setIndex}`, workoutId, athleteId: 'ath-1',
    exerciseId, setIndex, values: { load, reps: 5 }, loggedAt: '2026-07-01T10:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Serialization + multi-collection commit (carried over from json-store.test.ts)
// ---------------------------------------------------------------------------

test('two overlapping appends to the same collection both persist (write serialization)', async () => {
  // Fire both without awaiting the first — without the per-instance mutex these interleave
  // (both read [], both write length-1) and one is lost.
  await Promise.all([store.append('athletes', mkAthlete('a')), store.append('athletes', mkAthlete('b'))]);
  const all = await store.read('athletes');
  assert.equal(all.length, 2, 'neither append was dropped');
  assert.deepEqual(all.map((a) => a.athleteId).sort(), ['a', 'b']);
});

test('many concurrent appends all land', async () => {
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.append('athletes', mkAthlete(`n${i}`))));
  assert.equal((await store.read('athletes')).length, 25);
});

test('read of a never-written collection returns []', async () => {
  const fresh = createDiskStore(join(dir, 'never-written'));
  assert.deepEqual(await fresh.read('wellness_log'), []);
});

test('appendAll commits across collections as one unit (assessment + height log)', async () => {
  const scores: Scores = { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 };
  const assessment = { assessmentId: 'x1', athleteId: 'ath-1', date: '2026-07-01', tester: 'Coach',
    scores, rawTotal: 14, baseTier: 'A', finalTier: 'A', gateFired: 'none',
    coachGutCall: null, heightCm: 150, videoRefs: [], notes: '' } satisfies Assessment;
  const height = { athleteId: 'ath-1', date: '2026-07-01', heightCm: 150, source: 'assessment' } satisfies HeightLogEntry;

  await store.appendAll([
    { collection: 'assessments', record: assessment },
    { collection: 'height_log', record: height },
  ]);

  assert.equal((await store.read('assessments')).length, 1);
  assert.equal((await store.read('height_log')).length, 1);
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

test('appendAll with no height entry writes only the assessment', async () => {
  const built = buildAssessmentRecord({
    athleteId: 'ath-3', date: '2026-07-03', tester: 'Coach',
    scores: { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 },
    coachGutCall: null, heightCm: null,
  });
  await saveAssessment(store, built);
  assert.equal((await store.read('assessments')).length, 1);
  assert.equal((await store.read('height_log')).length, 0);
});

// ---------------------------------------------------------------------------
// Record-level ops (contract: keyed collections)
// ---------------------------------------------------------------------------

test('get finds a record by scalar key; undefined when absent', async () => {
  await store.append('athletes', mkAthlete('a'));
  assert.equal((await store.get('athletes', 'a'))?.athleteId, 'a');
  assert.equal(await store.get('athletes', 'nope'), undefined);
});

test('put inserts, then replaces at the same key (no duplicate)', async () => {
  await store.put('athletes', mkAthlete('a'));
  await store.put('athletes', { ...mkAthlete('a'), notes: 'edited' });
  const all = await store.read('athletes');
  assert.equal(all.length, 1, 'replace, not append');
  assert.equal(all[0]!.notes, 'edited');
});

test('remove deletes by composite key and is idempotent when absent', async () => {
  await store.append('set_log', mkSet('w1', 'ex1', 1, 40));
  await store.append('set_log', mkSet('w1', 'ex1', 2, 42));
  await store.remove('set_log', ['w1', 'ex1', 2]);
  assert.deepEqual((await store.read('set_log')).map((s) => s.setIndex), [1]);
  await store.remove('set_log', ['w1', 'ex1', 9]); // absent → no-op, no throw
  assert.equal((await store.read('set_log')).length, 1);
});

test('updateRecord: returning a record inserts at an absent key and replaces at a present one', async () => {
  const created = await store.updateRecord('set_log', ['w1', 'ex1', 1], (existing) => {
    assert.equal(existing, undefined, 'absent on first write');
    return mkSet('w1', 'ex1', 1, 40);
  });
  assert.equal(created?.values.load, 40);
  const replaced = await store.updateRecord('set_log', ['w1', 'ex1', 1], (existing) => {
    assert.equal(existing?.values.load, 40, 'sees the stored record');
    return { ...existing!, values: { load: 45, reps: 5 } };
  });
  assert.equal(replaced?.values.load, 45);
  assert.equal((await store.read('set_log')).length, 1, 'replaced, not duplicated');
});

test('updateRecord: null + existing record → DELETE (pinned semantics)', async () => {
  await store.append('set_log', mkSet('w1', 'ex1', 1, 40));
  const result = await store.updateRecord('set_log', ['w1', 'ex1', 1], () => null);
  assert.equal(result, null);
  assert.equal((await store.read('set_log')).length, 0, 'deleted');
});

test('updateRecord: null + no existing record → NO-OP (pinned semantics)', async () => {
  await store.append('set_log', mkSet('w1', 'ex1', 1, 40));
  const result = await store.updateRecord('set_log', ['w1', 'ex9', 1], () => null);
  assert.equal(result, null);
  assert.equal((await store.read('set_log')).length, 1, 'nothing deleted, nothing written');
});

test('updateRecord rejects a mutate result whose key differs from the addressed key', async () => {
  await assert.rejects(
    store.updateRecord('set_log', ['w1', 'ex1', 1], () => mkSet('w1', 'ex1', 2, 40)),
    /differs/,
  );
});

// ---------------------------------------------------------------------------
// queryBy (contract #4)
// ---------------------------------------------------------------------------

test('queryBy returns exactly the records matching the indexed field', async () => {
  await store.append('set_log', mkSet('w1', 'ex1', 1, 40));
  await store.append('set_log', mkSet('w1', 'ex2', 1, 20));
  await store.append('set_log', mkSet('w2', 'ex1', 1, 60));
  const w1 = await store.queryBy('set_log', 'workoutId', 'w1');
  assert.equal(w1.length, 2);
  assert.ok(w1.every((s) => s.workoutId === 'w1'));
  assert.equal((await store.queryBy('set_log', 'athleteId', 'ath-1')).length, 3);
  assert.equal((await store.queryBy('set_log', 'athleteId', 'nobody')).length, 0);
});

// ---------------------------------------------------------------------------
// Duplicate-key rejection (contract #5 — disk may NOT be laxer than IDB here)
// ---------------------------------------------------------------------------

test('append rejects a record whose primary key already exists', async () => {
  await store.append('athletes', mkAthlete('a'));
  await assert.rejects(store.append('athletes', mkAthlete('a')), /duplicate primary key/);
  assert.equal((await store.read('athletes')).length, 1, 'nothing written');
});

test('appendAll rejects the WHOLE batch on a duplicate key — nothing lands', async () => {
  await store.append('athletes', mkAthlete('a'));
  await assert.rejects(
    store.appendAll([
      { collection: 'athletes', record: mkAthlete('b') },
      { collection: 'athletes', record: mkAthlete('a') }, // dup against stored
    ]),
    /duplicate primary key/,
  );
  assert.deepEqual((await store.read('athletes')).map((a) => a.athleteId), ['a'], 'batch fully rejected');
});

test('appendAll rejects duplicates WITHIN the batch too', async () => {
  await assert.rejects(
    store.appendAll([
      { collection: 'set_log', record: mkSet('w1', 'ex1', 1, 40) },
      { collection: 'set_log', record: mkSet('w1', 'ex1', 1, 45) },
    ]),
    /duplicate primary key/,
  );
  assert.equal((await store.read('set_log')).length, 0);
});

test('write rejects a keyed collection containing duplicate keys', async () => {
  await assert.rejects(store.write('athletes', [mkAthlete('a'), mkAthlete('a')]), /duplicate primary key/);
});

test('keyless collections accept repeated identical entries (append-only logs)', async () => {
  const h: HeightLogEntry = { athleteId: 'ath-1', date: '2026-07-01', heightCm: 150, source: 'manual' };
  await store.append('height_log', h);
  await store.append('height_log', { ...h, source: 'assessment' }); // same athlete+date is legal
  assert.equal((await store.read('height_log')).length, 2);
});
