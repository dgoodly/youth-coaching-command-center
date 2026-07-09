/**
 * Library loader/schema tests — prove the real 127-exercise library loads and validates,
 * and that the two independent availability conditions (min_tier gate + 0-set convention)
 * behave per EXERCISE_LIBRARY.md §2A.6 / §3 step 1. Plumbing only — no selection logic here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLibrary, loadExercises, equipmentAvailable, byFamily, validate, loadPlans, loadDayTemplates, planForTier } from './library.ts';
import { isAvailableAtTier, tierDose, isAllDose, SLOT_ORDER, type Exercise } from '../engine/program.ts';
import { isMetricId } from '../engine/metrics.ts';
import { TIERS } from '../engine/types.ts';

/**
 * Metric-tagging policy by slot (METRIC_TAGGING_WORKSHEET.md). LIFT/SPRINT/JUMP/TRUNK log every
 * member; warm-up/funnels/cooldown log none. `motor_skill` is MIXED — only the two med-ball throws
 * are loggable (ball weight = `load`); throw-catch and locomotor drills are not.
 */
const LOGGED_SLOTS = new Set(['lift', 'sprint', 'jump', 'trunk']);
const NON_LOGGED_SLOTS = new Set(['warmup_base', 'funnel_linear', 'funnel_cod', 'cooldown']);
const LOGGABLE_MOTOR_SKILL = new Set(['m_rot_scoop_toss', 'm_rot_shuffle_throw']);

const lib = await loadLibrary();
const ex = lib.exercises;

/** Minimal valid Exercise for validator unit tests; override only what a case cares about. */
function makeExercise(over: Partial<Exercise> & { id: string }): Exercise {
  return {
    name: over.id, slot: 'trunk', pattern: 'anti_extension', plane: 'sagittal',
    laterality: 'bilateral', min_tier: 'C', difficulty: 1, variation_family: 'fam',
    stick: false, valgus_relevant: false, equipment: ['none'], dose: { all: 'x' },
    metrics: [], cue: '', progression_to: null, regression_to: null, notes: '', ...over,
  };
}

test('real library loads: 127 exercises, 9 slots, links resolve', () => {
  assert.equal(ex.length, 127, '127 exercises');
  assert.equal(lib.slots.length, 9, '9 slots incl. trunk + motor_skill');
  assert.ok(lib.slots.includes('trunk'), 'trunk slot present');
  assert.ok(lib.slots.includes('motor_skill'), 'motor_skill slot present');
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

test('workout plans load, reference real days, and every tier resolves to a plan', async () => {
  const plans = await loadPlans();
  const validDays = new Set((await loadDayTemplates()).map((t) => t.day));
  for (const p of plans) {
    assert.ok(p.days.length > 0, `${p.tier} plan has days`);
    for (const d of p.days) assert.ok(validDays.has(d), `${p.tier} plan day ${d} has a template`);
  }
  // Every tier has an explicit plan now (no fallback needed): C 2-day, B/A 3-day, S full split.
  assert.deepEqual((await planForTier('S'))?.days, [1, 2, 3, 4], 'S = full 4-day split');
  assert.deepEqual((await planForTier('A'))?.days, [1, 2, 4], 'A = 3-day 1·2·4');
  assert.deepEqual((await planForTier('B'))?.days, [1, 2, 4], 'B = 3-day 1·2·4');
  assert.deepEqual((await planForTier('C'))?.days, [1, 2], 'C = 2-day 1·2');
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

test('validate rejects an invalid laterality, plane, or non-numeric dose value (A5/A6)', () => {
  assert.throws(() => validate([makeExercise({ id: 'x', laterality: 'mixed' as never })]), /invalid laterality/);
  assert.throws(() => validate([makeExercise({ id: 'x', plane: 'diagonal' as never })]), /invalid plane/);
  assert.throws(
    () => validate([makeExercise({ id: 'x', dose: { C: { sets: 3, reps: 5, rest_sec: 's' as never } } })]),
    /numeric sets & rest_sec/,
  );
  assert.throws(
    () => validate([makeExercise({ id: 'x', dose: { C: { sets: '4' as never, reps: 5, rest_sec: 60 } } })]),
    /numeric sets & rest_sec/,
  );
});

test('the shipped library has valid laterality and numeric dose values everywhere (A5/A6)', () => {
  for (const e of ex) {
    assert.ok(['bilateral', 'unilateral'].includes(e.laterality), `${e.id} laterality ${e.laterality}`);
    if (!isAllDose(e.dose)) {
      for (const [tier, d] of Object.entries(e.dose)) {
        assert.equal(typeof d!.sets, 'number', `${e.id} ${tier} sets`);
        assert.equal(typeof d!.rest_sec, 'number', `${e.id} ${tier} rest_sec`);
      }
    }
  }
});

test('validate rejects an unresolvable metric id, accepts [] and known ids (Phase A)', () => {
  assert.throws(
    () => validate([makeExercise({ id: 'x', metrics: ['distnace_cm'] })]),
    /unknown metric "distnace_cm"/,
    'a typo in a metric id fails loudly',
  );
  assert.throws(
    () => validate([makeExercise({ id: 'x', metrics: 'load' as never })]),
    /metrics must be an array/,
    'a non-array metrics field fails',
  );
  assert.doesNotThrow(() => validate([makeExercise({ id: 'x', metrics: [] })]), 'empty is valid (non-logged)');
  assert.doesNotThrow(() => validate([makeExercise({ id: 'x', metrics: ['load', 'reps'] })]), 'known ids pass');
});

test('shipped library: metric-tagging matches the per-slot policy, incl. mixed motor_skill (Phase A)', () => {
  const bad: string[] = [];
  for (const e of ex) {
    const n = e.metrics.length;
    if (LOGGED_SLOTS.has(e.slot)) {
      if (n === 0) bad.push(`${e.id} (${e.slot}) has no metrics`);
    } else if (NON_LOGGED_SLOTS.has(e.slot)) {
      if (n > 0) bad.push(`${e.id} (${e.slot}) unexpectedly has metrics`);
    } else if (e.slot === 'motor_skill') {
      const shouldLog = LOGGABLE_MOTOR_SKILL.has(e.id);
      if (shouldLog && n === 0) bad.push(`${e.id} (motor_skill) should be loggable but has none`);
      if (!shouldLog && n > 0) bad.push(`${e.id} (motor_skill) should be non-logged but has metrics`);
    } else {
      bad.push(`${e.id} unknown slot ${e.slot}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('shipped library: the two loggable motor-skill throws log ball weight (load) (Phase A)', () => {
  for (const id of LOGGABLE_MOTOR_SKILL) {
    const e = ex.find((x) => x.id === id);
    assert.ok(e, `${id} exists`);
    assert.deepEqual(e!.metrics, ['load'], `${id} logs ball weight only`);
  }
  // Med-ball trunk moves log load too (weight, not reps) — worksheet decision.
  for (const id of ['t_mb_slam', 't_mb_throw']) {
    assert.deepEqual(ex.find((x) => x.id === id)!.metrics, ['load'], `${id} logs ball weight`);
  }
});

test('shipped library: every referenced metric id resolves in the catalog (Phase A)', () => {
  const unresolved: string[] = [];
  for (const e of ex) {
    for (const m of e.metrics) if (!isMetricId(m)) unresolved.push(`${e.id} → "${m}"`);
  }
  assert.deepEqual(unresolved, [], `unresolved metric ids: ${unresolved.join(', ')}`);
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

test('no sprint prescribes a flat-out distance ≥ 40 yd (flying-sprint safety rule)', () => {
  // COACHING_INSTRUCTIONS SPRINT: max-velocity uses flying structure (~20yd build + short fly
  // zone), and flat-out 40–60+ yd youth sprints are banned (hamstring / speed-endurance drift).
  // Every sprint dose distance must stay sub-40 yd; flying reps ("15 build/20 fly") encode only
  // the fly-zone length, well under 40. Catches a re-added "sprint with intent"-style entry.
  const offenders: string[] = [];
  for (const e of ex) {
    if (e.slot !== 'sprint' || isAllDose(e.dose)) continue;
    for (const [tier, d] of Object.entries(e.dose)) {
      const reps = d?.reps;
      if (typeof reps !== 'string') continue;
      for (const m of reps.matchAll(/(\d+)\s*(?:-\s*(\d+)\s*)?yd/g)) {
        const yards = [Number(m[1]), m[2] ? Number(m[2]) : null].filter((n): n is number => n !== null);
        for (const y of yards) {
          if (y >= 40) offenders.push(`${e.id} (${tier}: "${reps}") → ${y}yd`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `flat-out sprint distances ≥ 40yd found: ${offenders.join('; ')}`);
});

test('loadLibrary reflects on-disk edits without a stale cache (#4)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-lib-'));
  const file = join(dir, 'lib.json');
  const write = (exercises: Exercise[]) => writeFile(file, JSON.stringify({ exercises }), 'utf8');
  try {
    await write([makeExercise({ id: 'x1' })]);
    const first = await loadLibrary(file);
    assert.equal(first.exercises.length, 1, 'first load');

    await write([makeExercise({ id: 'x1' }), makeExercise({ id: 'x2' })]);
    const second = await loadLibrary(file);
    assert.equal(second.exercises.length, 2, 'second load reflects the edit — no stale cache');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
