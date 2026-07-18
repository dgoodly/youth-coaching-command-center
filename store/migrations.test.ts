/**
 * v1 → v2 assessment migration (S4) — the pure transform both carriers run
 * (cli/migrate.ts on disk, store/idb.ts onupgradeneeded on IndexedDB), plus the IDB
 * upgrade path itself: a v1 database built by hand reopens at v2 with its records
 * migrated, and an open connection yields to another context's upgrade (versionchange).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import type { Scores } from '../engine/types.ts';
import { isLegacyAssessment, migrateAssessmentRecord } from './migrations.ts';
import { createIdbStore } from './idb.ts';

const scores: Scores = { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 };

function legacy(over: Record<string, unknown> = {}) {
  return {
    assessmentId: 'a1', athleteId: 'ath-1', date: '2026-06-30', tester: 'Parent',
    scores, rawTotal: 14, baseTier: 'A' as const, finalTier: 'A' as const,
    gateFired: 'none' as const, coachGutCall: null, heightCm: 140,
    videoRefs: [] as string[], notes: '', ...over,
  };
}

// ---------------------------------------------------------------------------
// The pure transform
// ---------------------------------------------------------------------------

test('detects the legacy shape and not the current one', () => {
  assert.equal(isLegacyAssessment(legacy()), true);
  assert.equal(isLegacyAssessment(migrateAssessmentRecord(legacy())), false, 'idempotence guard');
  assert.equal(isLegacyAssessment(null), false);
  assert.equal(isLegacyAssessment({}), false);
});

test('grandfathers: live=scores, reviewed=null, provisional=false, tiers kept as stored', () => {
  const old = legacy({ finalTier: 'S', baseTier: 'S', rawTotal: 18, gateFired: 'none' });
  const migrated = migrateAssessmentRecord(old);
  assert.deepEqual(migrated.scoresLive, scores);
  assert.equal(migrated.scoresReviewed, null, 'NOT scores — the calibration delta must not lie');
  assert.equal(migrated.reviewedAt, null);
  assert.equal(migrated.reviewedBy, null);
  assert.equal(migrated.provisional, false, 'predates the concept — never retro-cap the roster');
  assert.equal(migrated.finalTier, 'S', 'grandfathered records keep the tier they were routed on');
  assert.equal(migrated.rawTotal, 18);
  assert.deepEqual(migrated.films, {});
  assert.ok(!('scores' in migrated), 'old field gone');
  assert.ok(!('videoRefs' in migrated), 'old field gone');
  assert.ok(!('filmsPurgeAt' in migrated), 'absent — no films exist to purge');
});

test('preserves optional provenance (paperMismatch) untouched', () => {
  const old = legacy({ paperMismatch: { rawTotal: { paper: 13, computed: 14 } } });
  assert.deepEqual(migrateAssessmentRecord(old).paperMismatch, { rawTotal: { paper: 13, computed: 14 } });
});

test('THROWS on a non-empty videoRefs — loud beats lossy', () => {
  assert.throws(
    () => migrateAssessmentRecord(legacy({ videoRefs: ['clips/marcus-dropstick.mp4'] })),
    /videoRefs/,
  );
});

// ---------------------------------------------------------------------------
// The IDB carrier: v1 database → open at v2 → records migrated
// ---------------------------------------------------------------------------

/** Build a version-1 database by hand, the way S2 shipped it, with one legacy record. */
function buildV1Database(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      // The S2 v1 shape: same stores/keyPaths (only record shapes changed in v2).
      db.createObjectStore('athletes', { keyPath: 'athleteId' });
      const assessments = db.createObjectStore('assessments', { keyPath: 'assessmentId' });
      assessments.createIndex('athleteId', 'athleteId');
      db.createObjectStore('height_log', { autoIncrement: true }).createIndex('athleteId', 'athleteId');
      db.createObjectStore('wellness_log', { autoIncrement: true }).createIndex('athleteId', 'athleteId');
      db.createObjectStore('workout_log', { keyPath: 'workoutId' }).createIndex('athleteId', 'athleteId');
      const sets = db.createObjectStore('set_log', { keyPath: ['workoutId', 'exerciseId', 'setIndex'] });
      sets.createIndex('athleteId', 'athleteId');
      sets.createIndex('workoutId', 'workoutId');
      db.createObjectStore('block_state', { keyPath: 'athleteId' });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('assessments', 'readwrite');
      tx.objectStore('assessments').add(legacy());
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

test('opening a v1 database through the v2 store migrates its assessments in onupgradeneeded', async () => {
  const factory = new IDBFactory();
  await buildV1Database(factory, 'command-center');
  const store = createIdbStore({ indexedDB: factory });
  const all = await store.read('assessments');
  assert.equal(all.length, 1);
  const a = all[0]!;
  assert.deepEqual(a.scoresLive, scores, 'migrated in the upgrade transaction');
  assert.equal(a.provisional, false);
  assert.ok(!('scores' in a), 'legacy field gone from the stored record');
  await store.close();
});

test('an open store connection yields to a newer-version open (versionchange auto-close)', async () => {
  const factory = new IDBFactory();
  const store = createIdbStore({ indexedDB: factory });
  await store.read('athletes'); // open the connection at DB_VERSION

  // Another context (tab vs. home-screen) wants v+1. Without the versionchange
  // auto-close, this open request would block forever behind our connection.
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('command-center', 99);
    request.onupgradeneeded = () => {}; // no schema change needed for the test
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

  // Our store reopens on next use… and promptly hits the future-version error, which is
  // the CORRECT behavior (a stale context must not write old-shape records into a newer
  // database) — the point here is that we yielded instead of deadlocking the upgrade.
  await assert.rejects(store.read('athletes'));
});
