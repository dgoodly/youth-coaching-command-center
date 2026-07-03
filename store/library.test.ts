/**
 * Library loader/schema tests — prove the real 121-exercise library loads and validates,
 * and that the two independent availability conditions (min_tier gate + 0-set convention)
 * behave per EXERCISE_LIBRARY.md §2A.6 / §3 step 1. Plumbing only — no selection logic here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadLibrary, loadExercises, equipmentAvailable, byFamily, validate } from './library.ts';
import { isAvailableAtTier, tierDose, isAllDose, SLOT_ORDER, type Exercise } from '../engine/program.ts';
import { TIERS } from '../engine/types.ts';

const lib = await loadLibrary();
const ex = lib.exercises;

/** Minimal valid Exercise for validator unit tests; override only what a case cares about. */
function makeExercise(over: Partial<Exercise> & { id: string }): Exercise {
  return {
    name: over.id, slot: 'trunk', pattern: 'anti_extension', plane: 'sagittal',
    laterality: 'bilateral', min_tier: 'C', difficulty: 1, variation_family: 'fam',
    stick: false, valgus_relevant: false, equipment: ['none'], dose: { all: 'x' },
    cue: '', progression_to: null, regression_to: null, notes: '', ...over,
  };
}

test('real library loads: 121 exercises, 8 slots, links resolve', () => {
  assert.equal(ex.length, 121, '121 exercises');
  assert.equal(lib.slots.length, 8, '8 slots incl. trunk');
  assert.ok(lib.slots.includes('trunk'), 'trunk slot present');
  // validate() already ran in loadLibrary(); a throw would have failed the load.
});

test('every exercise sits in a known slot', () => {
  for (const e of ex) assert.ok(SLOT_ORDER.includes(e.slot), `${e.id} slot ${e.slot}`);
});

test('0-set convention: a per-tier exercise gated by dose is unavailable at that tier', () => {
  // j_broad_consec is min_tier A with C/B 0-set → available at A/S only.
  const consec = ex.find((e) => e.id === 'j_broad_consec');
  assert.ok(consec, 'fixture exists');
  assert.equal(isAvailableAtTier(consec!, 'C'), false, 'not at C');
  assert.equal(isAvailableAtTier(consec!, 'B'), false, 'not at B');
  assert.equal(isAvailableAtTier(consec!, 'A'), true, 'yes at A');
  assert.equal(isAvailableAtTier(consec!, 'S'), true, 'yes at S');
  assert.equal(tierDose(consec!, 'C'), null, 'no C dose');
  assert.ok(tierDose(consec!, 'A'), 'has A dose');
});

test('min_tier gate: an exercise is never available below its min_tier', () => {
  for (const e of ex) {
    for (const tier of TIERS) {
      if (isAvailableAtTier(e, tier)) {
        // available implies gate satisfied
        const rank = { C: 0, B: 1, A: 2, S: 3 } as const;
        assert.ok(rank[tier] >= rank[e.min_tier], `${e.id} available at ${tier} < min ${e.min_tier}`);
      }
    }
  }
});

test('every slot has at least one exercise available at C (C sessions are populatable)', () => {
  for (const slot of lib.slots) {
    const anyC = ex.some((e) => e.slot === slot && isAvailableAtTier(e, 'C'));
    assert.ok(anyC, `slot ${slot} has a C-available option`);
  }
});

test('warm-up / funnel / cooldown use the { all } dose shape', () => {
  for (const e of ex) {
    if (e.slot === 'warmup_base' || e.slot === 'cooldown') {
      assert.ok(isAllDose(e.dose), `${e.id} should use { all } dose`);
    }
  }
});

test('equipment filter respects the available set', () => {
  const sled = ex.find((e) => e.equipment.includes('sled'));
  assert.ok(sled, 'a sled exercise exists');
  assert.equal(equipmentAvailable(sled!, new Set(['none'])), false, 'no sled on hand → excluded');
  assert.equal(equipmentAvailable(sled!, new Set(['none', 'sled'])), true, 'sled on hand → included');
  assert.equal(equipmentAvailable(sled!, new Set(['*'])), true, 'allow-all');
});

test('variation families group multiple swappable members', () => {
  const fams = byFamily(ex);
  assert.ok(fams.size >= 30, 'about 31 families');
  const horiz = fams.get('horizontal_jump_bilat');
  assert.ok(horiz && horiz.length >= 4, 'horizontal_jump_bilat has a rotation ladder');
});

test('the real library has no cross-family progression/regression links', () => {
  // Guards the #1 fix: a link that crosses variation_family silently breaks selectFill's
  // block-stability check. This asserts the shipped data stays clean (validate() only warns).
  const byId = new Map(ex.map((e) => [e.id, e]));
  const crossing: string[] = [];
  for (const e of ex) {
    for (const key of ['progression_to', 'regression_to'] as const) {
      const target = e[key] ? byId.get(e[key]!) : undefined;
      if (target && target.variation_family !== e.variation_family) {
        crossing.push(`${e.id}.${key} → ${e[key]} (${e.variation_family} → ${target.variation_family})`);
      }
    }
  }
  assert.deepEqual(crossing, [], `cross-family links present: ${crossing.join('; ')}`);
});

test('validate warns (does not throw) on a cross-family progression link', () => {
  const exercises: Exercise[] = [
    makeExercise({ id: 'a', variation_family: 'fam1', progression_to: 'b' }),
    makeExercise({ id: 'b', variation_family: 'fam2' }),
  ];
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (msg?: unknown) => void warnings.push(String(msg));
  try {
    assert.doesNotThrow(() => validate(exercises)); // only hard-fails on unresolvable links / bad enums
  } finally {
    console.warn = orig;
  }
  assert.ok(warnings.some((w) => w.includes('crosses variation_family')), 'expected a cross-family warning');
});
