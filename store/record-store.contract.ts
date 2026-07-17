/**
 * The RecordStore CONTRACT SUITE — the executable form of the contract documented in
 * `store/record-store.ts`. Every implementation runs this exact suite; an implementation
 * that needs a case weakened is wrong, not the case (the fake may deviate on performance
 * and unprovidable atomicity, never on validation or semantics).
 *
 * Not a test file itself (no `.test.ts` suffix): `store/disk.test.ts` and
 * `store/idb.test.ts` each import `runRecordStoreContract` and run it against their
 * implementation. Domain-level integration (e.g. `saveAssessment`'s dual-write) lives with
 * the disk suite, not here — this file asserts the store, nothing above it.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import type { AthleteProfile, HeightLogEntry, SetLogEntry } from '../engine/types.ts';
import type { RecordStore } from './record-store.ts';

export interface RecordStoreHarness {
  /** A ready store the suite shares across cases (collections reset between tests). */
  store: RecordStore;
  /** A brand-new store that has never been written — for the empty-read case. */
  fresh(): Promise<RecordStore> | RecordStore;
}

export function mkAthlete(id: string): AthleteProfile {
  return {
    athleteId: id, displayName: id, dob: null, sex: null, sports: [],
    trainingMonths: 0, valgusWatch: false, weeklySportHours: null,
    weeklyTrainingHours: null, restDaysPerWeek: null,
    createdAt: '2026-01-01T00:00:00Z', notes: '',
  };
}

export function mkSet(workoutId: string, exerciseId: string, setIndex: number, load: number): SetLogEntry {
  return {
    setLogId: `${workoutId}-${exerciseId}-${setIndex}`, workoutId, athleteId: 'ath-1',
    exerciseId, setIndex, values: { load, reps: 5 }, loggedAt: '2026-07-01T10:00:00Z',
  };
}

export function runRecordStoreContract(label: string, harness: RecordStoreHarness): void {
  const { store } = harness;

  describe(`RecordStore contract — ${label}`, () => {
    beforeEach(async () => {
      await store.write('athletes', []);
      await store.write('assessments', []);
      await store.write('height_log', []);
      await store.write('set_log', []);
    });

    // -----------------------------------------------------------------------
    // Contract #1 — empty reads
    // -----------------------------------------------------------------------

    it('read of a never-written collection returns []', async () => {
      const fresh = await harness.fresh();
      assert.deepEqual(await fresh.read('wellness_log'), []);
    });

    // -----------------------------------------------------------------------
    // Contract #2 — serialization: concurrent mutations never lose an update
    // -----------------------------------------------------------------------

    it('two overlapping appends to the same collection both persist', async () => {
      // Fire both without awaiting the first — a non-serialized read-modify-write
      // interleaves (both read [], both write length-1) and one is lost.
      await Promise.all([store.append('athletes', mkAthlete('a')), store.append('athletes', mkAthlete('b'))]);
      const all = await store.read('athletes');
      assert.equal(all.length, 2, 'neither append was dropped');
      assert.deepEqual(all.map((a) => a.athleteId).sort(), ['a', 'b']);
    });

    it('many concurrent appends all land', async () => {
      await Promise.all(Array.from({ length: 25 }, (_, i) => store.append('athletes', mkAthlete(`n${i}`))));
      assert.equal((await store.read('athletes')).length, 25);
    });

    it('update runs its synchronous mutate exactly once and persists the result', async () => {
      await store.append('athletes', mkAthlete('a'));
      let calls = 0;
      const next = await store.update('athletes', (all) => {
        calls += 1;
        return [...all, mkAthlete('b')];
      });
      assert.equal(calls, 1, 'mutate ran exactly once');
      assert.equal(next.length, 2);
      assert.equal((await store.read('athletes')).length, 2);
    });

    // The clause where the implementations differ most (disk = promise-chain mutex,
    // IDB = transaction ordering), so it gets a REAL race, not sequential calls: N
    // concurrent read-modify-writes, each deriving its write from what it read. Any
    // interleaving loses updates and the final count comes up short.

    it('N concurrent updates each see the previous result — no lost update', async () => {
      const N = 20;
      await Promise.all(
        Array.from({ length: N }, () =>
          store.update('athletes', (all) => [...all, mkAthlete(`u${all.length}`)]),
        ),
      );
      const all = await store.read('athletes');
      assert.equal(all.length, N, `all ${N} read-modify-writes landed`);
      // Serialized execution means each mutate saw the one before it: ids are 0..N-1, no dups.
      assert.deepEqual(
        all.map((a) => a.athleteId).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))),
        Array.from({ length: N }, (_, i) => `u${i}`),
      );
    });

    it('N concurrent read-increment-writes of one record sum correctly', async () => {
      await store.append('set_log', mkSet('w1', 'ex1', 1, 0));
      const N = 20;
      await Promise.all(
        Array.from({ length: N }, () =>
          store.updateRecord('set_log', ['w1', 'ex1', 1], (existing) => ({
            ...existing!,
            values: { ...existing!.values, load: (existing!.values.load ?? 0) + 1 },
          })),
        ),
      );
      const final = await store.get('set_log', ['w1', 'ex1', 1]);
      assert.equal(final?.values.load, N, `every increment observed the one before it`);
    });

    // -----------------------------------------------------------------------
    // Contract #3 — appendAll is one unit
    // -----------------------------------------------------------------------

    it('appendAll commits across collections as one unit', async () => {
      const height: HeightLogEntry = { athleteId: 'ath-1', date: '2026-07-01', heightCm: 150, source: 'assessment' };
      await store.appendAll([
        { collection: 'athletes', record: mkAthlete('a') },
        { collection: 'height_log', record: height },
      ]);
      assert.equal((await store.read('athletes')).length, 1);
      assert.equal((await store.read('height_log')).length, 1);
    });

    // -----------------------------------------------------------------------
    // Record-level ops on keyed collections
    // -----------------------------------------------------------------------

    it('get finds a record by scalar key; undefined when absent', async () => {
      await store.append('athletes', mkAthlete('a'));
      assert.equal((await store.get('athletes', 'a'))?.athleteId, 'a');
      assert.equal(await store.get('athletes', 'nope'), undefined);
    });

    it('put inserts, then replaces at the same key (no duplicate)', async () => {
      await store.put('athletes', mkAthlete('a'));
      await store.put('athletes', { ...mkAthlete('a'), notes: 'edited' });
      const all = await store.read('athletes');
      assert.equal(all.length, 1, 'replace, not append');
      assert.equal(all[0]!.notes, 'edited');
    });

    it('remove deletes by composite key and is idempotent when absent', async () => {
      await store.append('set_log', mkSet('w1', 'ex1', 1, 40));
      await store.append('set_log', mkSet('w1', 'ex1', 2, 42));
      await store.remove('set_log', ['w1', 'ex1', 2]);
      assert.deepEqual((await store.read('set_log')).map((s) => s.setIndex), [1]);
      await store.remove('set_log', ['w1', 'ex1', 9]); // absent → no-op, no throw
      assert.equal((await store.read('set_log')).length, 1);
    });

    it('updateRecord: returning a record inserts at an absent key and replaces at a present one', async () => {
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

    it('updateRecord: null + existing record → DELETE (pinned semantics)', async () => {
      await store.append('set_log', mkSet('w1', 'ex1', 1, 40));
      const result = await store.updateRecord('set_log', ['w1', 'ex1', 1], () => null);
      assert.equal(result, null);
      assert.equal((await store.read('set_log')).length, 0, 'deleted');
    });

    it('updateRecord: null + no existing record → NO-OP (pinned semantics)', async () => {
      await store.append('set_log', mkSet('w1', 'ex1', 1, 40));
      const result = await store.updateRecord('set_log', ['w1', 'ex9', 1], () => null);
      assert.equal(result, null);
      assert.equal((await store.read('set_log')).length, 1, 'nothing deleted, nothing written');
    });

    it('updateRecord rejects a mutate result whose key differs from the addressed key', async () => {
      await assert.rejects(
        store.updateRecord('set_log', ['w1', 'ex1', 1], () => mkSet('w1', 'ex1', 2, 40)),
        /differs/,
      );
      assert.equal((await store.read('set_log')).length, 0, 'nothing written');
    });

    // -----------------------------------------------------------------------
    // Contract #4 — indexed reads
    // -----------------------------------------------------------------------

    it('queryBy returns exactly the records matching the indexed field', async () => {
      await store.append('set_log', mkSet('w1', 'ex1', 1, 40));
      await store.append('set_log', mkSet('w1', 'ex2', 1, 20));
      await store.append('set_log', mkSet('w2', 'ex1', 1, 60));
      const w1 = await store.queryBy('set_log', 'workoutId', 'w1');
      assert.equal(w1.length, 2);
      assert.ok(w1.every((s) => s.workoutId === 'w1'));
      assert.equal((await store.queryBy('set_log', 'athleteId', 'ath-1')).length, 3);
      assert.equal((await store.queryBy('set_log', 'athleteId', 'nobody')).length, 0);
    });

    // -----------------------------------------------------------------------
    // Contract #5 — duplicate-key rejection (no implementation may be laxer)
    // -----------------------------------------------------------------------

    it('append rejects a record whose primary key already exists', async () => {
      await store.append('athletes', mkAthlete('a'));
      await assert.rejects(store.append('athletes', mkAthlete('a')), /duplicate primary key/);
      assert.equal((await store.read('athletes')).length, 1, 'nothing written');
    });

    it('appendAll rejects the WHOLE batch on a duplicate key — nothing lands', async () => {
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

    it('appendAll rejects duplicates WITHIN the batch too', async () => {
      await assert.rejects(
        store.appendAll([
          { collection: 'set_log', record: mkSet('w1', 'ex1', 1, 40) },
          { collection: 'set_log', record: mkSet('w1', 'ex1', 1, 45) },
        ]),
        /duplicate primary key/,
      );
      assert.equal((await store.read('set_log')).length, 0);
    });

    it('write rejects a keyed collection containing duplicate keys', async () => {
      await assert.rejects(store.write('athletes', [mkAthlete('a'), mkAthlete('a')]), /duplicate primary key/);
    });

    it('update rejects a mutate result containing duplicate keys, leaving the store unchanged', async () => {
      await store.append('athletes', mkAthlete('a'));
      await assert.rejects(
        store.update('athletes', () => [mkAthlete('b'), mkAthlete('b')]),
        /duplicate primary key/,
      );
      assert.deepEqual((await store.read('athletes')).map((a) => a.athleteId), ['a']);
    });

    it('keyless collections accept repeated identical entries (append-only logs)', async () => {
      const h: HeightLogEntry = { athleteId: 'ath-1', date: '2026-07-01', heightCm: 150, source: 'manual' };
      await store.append('height_log', h);
      await store.append('height_log', { ...h, source: 'assessment' }); // same athlete+date is legal
      assert.equal((await store.read('height_log')).length, 2);
    });
  });
}
