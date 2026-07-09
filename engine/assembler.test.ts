/**
 * Assembler tests — run the REAL library + day templates across every tier × day so the
 * curation and selection pipeline are validated together, plus rotation and the hard
 * sequencing-guard behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleSession, assertSequencingRule, selectFill, type AssembledSession } from './assembler.ts';
import { SLOT_ORDER, type DayTemplate, type Exercise } from './program.ts';
import { loadExercises, loadDayTemplates } from '../store/library.ts';
import { advanceVariant, rotateBlockState } from '../store/blocks.ts';
import { TIERS, type Tier } from './types.ts';
import type { BlockState } from './types.ts';

const exercises = await loadExercises();
const templates = await loadDayTemplates();
const ALL_EQUIP = new Set(['*']);

function assemble(tier: Tier, day: number, over: Partial<Parameters<typeof assembleSession>[0]> = {}) {
  const template = templates.find((t) => t.day === day)!;
  return assembleSession({
    tier, day, exercises, template, valgusWatch: false, equipment: ALL_EQUIP, ...over,
  });
}
function block(s: AssembledSession, slot: string) {
  return s.blocks.find((b) => b.slot === slot);
}

/** Minimal valid Exercise for selectFill unit tests; override only what a case cares about. */
function makeExercise(over: Partial<Exercise> & { id: string }): Exercise {
  return {
    name: over.id, slot: 'jump', pattern: 'horizontal_jump', plane: 'sagittal',
    laterality: 'bilateral', min_tier: 'C', difficulty: 1, variation_family: 'fam',
    stick: false, valgus_relevant: false, equipment: ['none'], dose: { all: 'x' },
    metrics: [], cue: '', progression_to: null, regression_to: null, notes: '', ...over,
  };
}

test('every tier × day assembles without violating the sequencing rule', () => {
  for (const tier of TIERS) {
    for (const t of templates) {
      assert.doesNotThrow(() => assemble(tier, t.day), `${tier}/${t.day}`);
    }
  }
});

test('fixed skeleton order + exactly one funnel matching emphasis', () => {
  for (const tier of TIERS) {
    for (const t of templates) {
      const { session } = assemble(tier, t.day);
      const order = session.blocks.map((b) => SLOT_ORDER.indexOf(b.slot));
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `ordered ${tier}/${t.day}`);
      const funnels = session.blocks.filter((b) => b.slot === 'funnel_linear' || b.slot === 'funnel_cod');
      assert.equal(funnels.length, 1, `one funnel ${tier}/${t.day}`);
      const expect = session.emphasis === 'linear-speed' ? 'funnel_linear' : 'funnel_cod';
      assert.equal(funnels[0]!.slot, expect);
    }
  }
});

test('every tier (incl. C) gets a non-empty warm-up, jump, sprint, and lift', () => {
  for (const tier of TIERS) {
    for (const t of templates) {
      const { session } = assemble(tier, t.day);
      assert.ok(block(session, 'warmup_base')!.items.length > 0, `base ${tier}/${t.day}`);
      for (const slot of ['jump', 'sprint', 'lift'] as const) {
        assert.ok(block(session, slot) && block(session, slot)!.items.length > 0, `${slot} ${tier}/${t.day}`);
      }
    }
  }
});

test('every tier × day gets a motor-skill enrichment block, placed after trunk and before cooldown', () => {
  for (const tier of TIERS) {
    for (const t of templates) {
      const { session } = assemble(tier, t.day);
      const ms = block(session, 'motor_skill');
      assert.ok(ms && ms.items.length > 0, `motor_skill present ${tier}/${t.day}`);
      const order = session.blocks.map((b) => b.slot);
      const msIdx = order.indexOf('motor_skill');
      const cdIdx = order.indexOf('cooldown');
      const trunkIdx = order.indexOf('trunk');
      if (trunkIdx !== -1) assert.ok(trunkIdx < msIdx, `motor_skill after trunk ${tier}/${t.day}`);
      if (cdIdx !== -1) assert.ok(msIdx < cdIdx, `motor_skill before cooldown ${tier}/${t.day}`);
      // Enrichment is never single-leg-only landing load — it's throw/catch, rotational, locomotor.
      assert.ok(['throw_catch', 'rotational_skill', 'locomotor_skill'].includes(ms.items[0]!.exercise.variation_family));
    }
  }
});

test('trunk appears only on Days 1/2/4, never Day 3', () => {
  for (const tier of TIERS) {
    assert.ok(block(assemble(tier, 1).session, 'trunk'), `trunk on 1 (${tier})`);
    assert.ok(block(assemble(tier, 2).session, 'trunk'), `trunk on 2 (${tier})`);
    assert.equal(block(assemble(tier, 3).session, 'trunk'), undefined, `no trunk on 3 (${tier})`);
    assert.ok(block(assemble(tier, 4).session, 'trunk'), `trunk on 4 (${tier})`);
  }
});

test('Day 1 trunk block-0 bias is anti_rotation (Pallof); Day 4 is rotation', () => {
  const d1 = block(assemble('B', 1).session, 'trunk')!;
  assert.equal(d1.items[0]!.exercise.variation_family, 'anti_rotation');
  const d4 = block(assemble('B', 4).session, 'trunk')!;
  assert.equal(d4.items[0]!.exercise.variation_family, 'rotation');
});

test('0-set / min_tier respected: no exercise appears at a tier where it is unavailable', () => {
  const rank = { C: 0, B: 1, A: 2, S: 3 } as const;
  for (const tier of TIERS) {
    for (const t of templates) {
      const { session } = assemble(tier, t.day);
      for (const b of session.blocks) {
        for (const it of b.items) {
          assert.ok(rank[tier] >= rank[it.exercise.min_tier], `${it.exercise.id} at ${tier}`);
        }
      }
    }
  }
});

test('Day 1 keeps summed jump difficulty within the ceiling for all tiers (protects max-V)', () => {
  const ceiling = templates.find((t) => t.day === 1)!.jump_difficulty_ceiling!;
  for (const tier of TIERS) {
    const { session } = assemble(tier, 1);
    assert.ok(session.jumpDifficultySum <= ceiling, `${tier} sum ${session.jumpDifficultySum} <= ${ceiling}`);
  }
});

test('Day 1 max-velocity slot: A/S run true max-velocity; C/B get a submaximal build-up (spec §5)', () => {
  // A/S: a genuine flying max-velocity drill (difficulty ≥ 5) → emphasis stays max_velocity.
  for (const tier of ['A', 'S'] as const) {
    const { session } = assemble(tier, 1);
    const sprint = block(session, 'sprint')!;
    assert.ok(
      sprint.items.some((it) => it.exercise.pattern === 'max_velocity' && it.exercise.difficulty >= 5),
      `true max-V ${tier}`,
    );
    assert.equal(session.sprintEmphasis, 'max_velocity', `emphasis ${tier}`);
  }
  // C/B: the slot is realized as the family's submaximal build-up (pattern max_velocity, difficulty
  // < 5) — spec §5 permits build-ups at C; NOT flat-out max-velocity. Labeled honestly, with a note.
  for (const tier of ['C', 'B'] as const) {
    const { session } = assemble(tier, 1);
    const sprint = block(session, 'sprint')!;
    assert.ok(sprint.items.length > 0, `sprint populated ${tier}`);
    assert.ok(sprint.items.every((it) => it.exercise.difficulty < 5), `submaximal ${tier}`);
    assert.equal(session.sprintEmphasis, 'acceleration+buildup', `emphasis ${tier}`);
    assert.ok(session.assemblyNotes.some((n) => /build-up/.test(n)), `build-up note ${tier}`);
  }
});

test('short funnel (Day 2) is trimmed vs full funnel (Day 1) at the same tier', () => {
  const d1 = block(assemble('A', 1).session, 'funnel_linear')!.items.length;
  const d2 = block(assemble('A', 2).session, 'funnel_linear')!.items.length;
  assert.ok(d2 <= 3, 'short funnel ≤ 3');
  assert.ok(d1 >= d2, 'full ≥ short');
});

test('short mode also trims a CoD funnel — not just linear (B4)', () => {
  const cod = templates.find((t) => t.emphasis === 'change-of-direction')!;
  const full = assembleSession({ tier: 'A', day: cod.day, exercises, template: cod, valgusWatch: false, equipment: ALL_EQUIP });
  const short = assembleSession({
    tier: 'A', day: cod.day, exercises, template: { ...cod, funnel_mode: 'short' }, valgusWatch: false, equipment: ALL_EQUIP,
  });
  const fullN = block(full.session, 'funnel_cod')!.items.length;
  const shortN = block(short.session, 'funnel_cod')!.items.length;
  assert.ok(fullN > 3, 'the CoD funnel has more than 3 drills at full length');
  assert.equal(shortN, 3, 'short mode trims the CoD funnel to 3');
  assert.ok(short.session.assemblyNotes.some((n) => /CoD funnel trimmed/.test(n)), 'trim noted');
});

test('valgus watch prefers a stick option near the family floor (selectFill branch)', () => {
  // Synthetic family: floor is non-stick (d2); a near-floor member IS stick (d3).
  const base: Omit<Exercise, 'id' | 'name' | 'difficulty' | 'stick'> = {
    slot: 'jump', pattern: 'p', plane: 'sagittal', laterality: 'bilateral', min_tier: 'C',
    variation_family: 'tf', valgus_relevant: false, equipment: ['none'], dose: { all: 'x' },
    metrics: [], cue: '', progression_to: null, regression_to: null, notes: '',
  };
  const plain: Exercise = { ...base, id: 'x_plain', name: 'plain', difficulty: 2, stick: false };
  const stick: Exercise = { ...base, id: 'x_stick', name: 'stick', difficulty: 3, stick: true };
  const synth = [plain, stick];
  const all = new Set(['*']);

  const opts = { tier: 'C' as const, blockIndex: 0, equipment: all, bandFloor: 1, preferBandFloor: false };
  // No valgus → floor (lowest difficulty) wins.
  assert.equal(selectFill(synth, ['tf'], { ...opts, valgusWatch: false }).exercise?.id, 'x_plain');
  // Valgus on → the stick option within +1 of the floor is preferred.
  assert.equal(selectFill(synth, ['tf'], { ...opts, valgusWatch: true }).exercise?.id, 'x_stick');
});

test('band-floor entry lifts an advanced athlete off the family floor', () => {
  // A-tier max_velocity family: buildup(d3) < band floor 4; flying_sprint(d5) is in band [4-6].
  // Band-floor mode should pick flying_sprint, not build-ups.
  const all = new Set(['*']);
  const opts = {
    tier: 'A' as const, blockIndex: 0, valgusWatch: false, equipment: all,
    bandFloor: 4, preferBandFloor: true,
  };
  const pick = selectFill(exercises, ['max_velocity'], opts).exercise;
  assert.equal(pick?.id, 's_flying_sprint');
  // Lowest mode (as used for ceilinged jump days) would instead pick the easiest.
  const low = selectFill(exercises, ['max_velocity'], { ...opts, preferBandFloor: false }).exercise;
  assert.equal(low?.id, 's_buildup');
});

test('block variant is stable within a block (existing slotVariants are reused)', () => {
  const first = assemble('A', 3);
  const key = Object.keys(first.slotVariants).find((k) => k.startsWith('3:jump:'))!;
  const chosen = first.slotVariants[key]!;
  // Re-assemble with the stored variants → same choice.
  const again = assemble('A', 3, { slotVariants: first.slotVariants });
  assert.equal(again.slotVariants[key], chosen);
});

test('rotation advances a variant within its family (progression_to)', () => {
  // j_broad_stick.progression_to = j_broad_consec (A). At tier A, no ceiling → should advance.
  const next = advanceVariant(exercises, 'j_broad_stick', 'A', false);
  assert.notEqual(next, 'j_broad_stick');
  const nextEx = exercises.find((e) => e.id === next)!;
  assert.equal(nextEx.variation_family, 'horizontal_jump_bilat');
});

test('rotation does NOT push Day-1 jump difficulty up (ceiling protection)', () => {
  // Simulate a block with Day-1 jump variants, rotate, and confirm the ceiling still holds.
  const base = assemble('S', 1);
  const state: BlockState = {
    athleteId: 'x', blockStartDate: '2026-01-01', blockIndex: 0, slotVariants: base.slotVariants,
  };
  const rotated = rotateBlockState(state, exercises, templates, 'S');
  const after = assemble('S', 1, { blockIndex: rotated.blockIndex, slotVariants: rotated.slotVariants });
  const ceiling = templates.find((t) => t.day === 1)!.jump_difficulty_ceiling!;
  assert.ok(after.session.jumpDifficultySum <= ceiling, `post-rotation sum ${after.session.jumpDifficultySum} <= ${ceiling}`);
});

test('assembleSession THROWS on a misconfigured template (max-V + jumps over ceiling)', () => {
  const bad: DayTemplate = {
    day: 1, label: 'bad', emphasis: 'linear-speed', funnel_mode: 'full',
    sprint_emphasis: 'max_velocity', jump_difficulty_ceiling: 3,
    slots: {
      jump: [['depth_contrast']], // A/S depth work, difficulty 6–8 >> 3
      sprint: [['max_velocity']],
      lift: [['squat']], trunk: [],
    },
  };
  assert.throws(
    () => assembleSession({ tier: 'S', day: 1, exercises, template: bad, valgusWatch: false, equipment: ALL_EQUIP }),
    /Hard sequencing rule violated/,
  );
});

test('assertSequencingRule passes when no max-velocity is present regardless of plyo', () => {
  const s = assemble('S', 2).session; // high plyo, no max-V
  const t = templates.find((x) => x.day === 2)!;
  assert.doesNotThrow(() => assertSequencingRule(s, t));
});

test('assembleSession THROWS on a max-velocity day that declares no ceiling (misconfig, review A4)', () => {
  const bad: DayTemplate = {
    day: 9, label: 'no-ceiling max-V', emphasis: 'linear-speed', funnel_mode: 'full',
    sprint_emphasis: 'max_velocity', jump_difficulty_ceiling: null, // <-- the hole
    slots: { jump: [['pogo']], sprint: [['max_velocity']], lift: [['squat']], trunk: [] },
  };
  assert.throws(
    () => assembleSession({ tier: 'A', day: 9, exercises, template: bad, valgusWatch: false, equipment: ALL_EQUIP }),
    /declares no jump_difficulty_ceiling/,
  );
});

test('a persisted variant from a different family than the pool selects is not silently kept', () => {
  // Locks in the #1 fix at the assembler level: selectFill's block-stability check is
  // family-scoped, so a variant that was advanced across a family boundary (the cross-family
  // progression bug) is NOT kept — the pool-selected family wins. This keeps the correct
  // behavior explicit so nobody "fixes" a future cross-family link by loosening this check.
  const wrongFamily = makeExercise({ id: 'wrong', variation_family: 'famB', difficulty: 3 });
  const rightFamilyMember = makeExercise({ id: 'right', variation_family: 'famA', difficulty: 3 });
  const result = selectFill([wrongFamily, rightFamilyMember], ['famA'], {
    tier: 'B', blockIndex: 0, valgusWatch: false, equipment: new Set(['*']),
    bandFloor: 1, preferBandFloor: true, existingId: 'wrong',
  });
  assert.equal(result.exercise?.id, 'right'); // not 'wrong' — family scoping wins
});
