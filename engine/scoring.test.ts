/**
 * Scoring engine tests — spec §4. The engine "cannot be wrong" (BUILD_BRIEF §1, §5.2),
 * so this suite hand-works examples straight from the spec AND brute-forces every one of
 * the 4^6 = 4096 possible score combinations to prove the invariants:
 *   - gates can only LOWER, never raise (§3.2)
 *   - S is reachable only with a perfect drop-stick (§4 gate 3)
 *   - gateFired is recorded iff the tier was actually lowered (§8 "which gate lowered")
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assignTier, rawTotal, baseTierFromRaw, minTier } from './scoring.ts';
import { TIER_RANK, SCORE_KEYS } from './types.ts';
import type { Scores, Tier, TestScore } from './types.ts';

/** Build a Scores object from the six values in fixed spec order. */
function s(
  squat: TestScore,
  dropStick: TestScore,
  balance: TestScore,
  pushup: TestScore,
  broad: TestScore,
  pogo: TestScore,
): Scores {
  return { squat, dropStick, balance, pushup, broad, pogo };
}

// ---------------------------------------------------------------------------
// Hand-worked cases from the spec (raw total, base tier, final tier, gate)
// ---------------------------------------------------------------------------

interface Case {
  name: string;
  scores: Scores;
  raw: number;
  base: Tier;
  final: Tier;
  gate: ReturnType<typeof assignTier>['gateFired'];
}

const CASES: Case[] = [
  {
    name: 'all 3s → perfect S, no gate',
    scores: s(3, 3, 3, 3, 3, 3),
    raw: 18,
    base: 'S',
    final: 'S',
    gate: 'none',
  },
  {
    name: 'raw 17 with the single 2 on balance (dropStick=3) → S stands',
    scores: s(3, 3, 2, 3, 3, 3),
    raw: 17,
    base: 'S',
    final: 'S',
    gate: 'none',
  },
  {
    name: 'raw 17 but the 2 is dropStick → S drops to A (perfect-stick gate)',
    scores: s(3, 2, 3, 3, 3, 3),
    raw: 17,
    base: 'S',
    final: 'A',
    gate: 'capA', // dropStick===2 caps at A; fires before the S→A gate, same outcome
  },
  {
    name: 'solid A, dropStick=3, all >=2 → A, no gate',
    scores: s(2, 3, 2, 3, 2, 2),
    raw: 14,
    base: 'A',
    final: 'A',
    gate: 'none',
  },
  {
    name: 'A base but squat=1 → capped to C (landing/strength control gate)',
    scores: s(1, 3, 3, 3, 3, 3),
    raw: 16,
    base: 'A',
    final: 'C',
    gate: 'capC',
  },
  {
    name: 'A base but dropStick=1 → capped to C',
    scores: s(3, 1, 3, 3, 3, 3),
    raw: 16,
    base: 'A',
    final: 'C',
    gate: 'capC',
  },
  {
    name: 'headline §3.2: powerful athlete, dropStick=0 → routed DOWN to C',
    scores: s(3, 0, 3, 3, 3, 3),
    raw: 15,
    base: 'A',
    final: 'C',
    gate: 'capC',
  },
  {
    name: 'A base, dropStick=2 but condition does not lower an A → A, no gate recorded',
    scores: s(3, 2, 3, 2, 3, 3),
    raw: 16,
    base: 'A',
    final: 'A',
    gate: 'none', // cap-at-A on an already-A tier is a no-op; nothing was lowered
  },
  {
    name: 'B base, dropStick=2 → cap-at-A never raises a B; stays B, no gate',
    scores: s(2, 2, 2, 2, 1, 1),
    raw: 10,
    base: 'B',
    final: 'B',
    gate: 'none',
  },
  {
    name: 'B base but squat=1 → capped to C',
    scores: s(1, 2, 2, 2, 2, 2),
    raw: 11,
    base: 'B',
    final: 'C',
    gate: 'capC',
  },
  {
    name: 'all 1s → C base, cap-C condition holds but is a no-op → C, no gate',
    scores: s(1, 1, 1, 1, 1, 1),
    raw: 6,
    base: 'C',
    final: 'C',
    gate: 'none',
  },
  // Band boundaries
  {
    name: 'boundary raw=8 → B',
    scores: s(2, 2, 2, 2, 0, 0),
    raw: 8,
    base: 'B',
    final: 'B',
    gate: 'none',
  },
  {
    name: 'boundary raw=7 → C',
    scores: s(2, 2, 1, 1, 1, 0),
    raw: 7,
    base: 'C',
    final: 'C',
    gate: 'none',
  },
  {
    name: 'boundary raw=12 → B',
    scores: s(3, 3, 2, 2, 1, 1),
    raw: 12,
    base: 'B',
    final: 'B',
    gate: 'none',
  },
  {
    name: 'boundary raw=13 → A',
    scores: s(3, 3, 3, 2, 1, 1),
    raw: 13,
    base: 'A',
    final: 'A',
    gate: 'none',
  },
  {
    name: 'boundary raw=16 → A (dropStick=3)',
    scores: s(3, 3, 3, 3, 3, 1),
    raw: 16,
    base: 'A',
    final: 'A',
    gate: 'none',
  },
];

for (const c of CASES) {
  test(`assignTier: ${c.name}`, () => {
    const r = assignTier(c.scores);
    assert.equal(r.rawTotal, c.raw, 'rawTotal');
    assert.equal(r.baseTier, c.base, 'baseTier');
    assert.equal(r.finalTier, c.final, 'finalTier');
    assert.equal(r.gateFired, c.gate, 'gateFired');
  });
}

// ---------------------------------------------------------------------------
// Unit checks on the helpers
// ---------------------------------------------------------------------------

test('rawTotal sums all six in 0..18', () => {
  assert.equal(rawTotal(s(0, 0, 0, 0, 0, 0)), 0);
  assert.equal(rawTotal(s(3, 3, 3, 3, 3, 3)), 18);
  assert.equal(rawTotal(s(1, 2, 3, 0, 1, 2)), 9);
});

test('baseTierFromRaw matches the spec §4 bands at every boundary', () => {
  assert.equal(baseTierFromRaw(18), 'S');
  assert.equal(baseTierFromRaw(17), 'S');
  assert.equal(baseTierFromRaw(16), 'A');
  assert.equal(baseTierFromRaw(13), 'A');
  assert.equal(baseTierFromRaw(12), 'B');
  assert.equal(baseTierFromRaw(8), 'B');
  assert.equal(baseTierFromRaw(7), 'C');
  assert.equal(baseTierFromRaw(0), 'C');
});

test('minTier returns the lower-ranked tier (C<B<A<S)', () => {
  assert.equal(minTier('S', 'A'), 'A');
  assert.equal(minTier('A', 'S'), 'A');
  assert.equal(minTier('B', 'B'), 'B');
  assert.equal(minTier('C', 'S'), 'C');
});

// ---------------------------------------------------------------------------
// Brute-force invariants over ALL 4^6 = 4096 score combinations
// ---------------------------------------------------------------------------

function allScores(): Scores[] {
  const out: Scores[] = [];
  const v: TestScore[] = [0, 1, 2, 3];
  for (const a of v)
    for (const b of v)
      for (const c of v)
        for (const d of v)
          for (const e of v)
            for (const f of v) out.push(s(a, b, c, d, e, f));
  return out;
}

test('invariant: gates NEVER raise the tier (final rank <= base rank) for all 4096', () => {
  for (const sc of allScores()) {
    const r = assignTier(sc);
    assert.ok(
      TIER_RANK[r.finalTier] <= TIER_RANK[r.baseTier],
      `raised tier on ${JSON.stringify(sc)}: base ${r.baseTier} → final ${r.finalTier}`,
    );
  }
});

test('invariant: gateFired === "none" iff finalTier === baseTier, for all 4096', () => {
  for (const sc of allScores()) {
    const r = assignTier(sc);
    const lowered = r.finalTier !== r.baseTier;
    assert.equal(
      r.gateFired === 'none',
      !lowered,
      `gate/lowering mismatch on ${JSON.stringify(sc)}: gate=${r.gateFired}, base=${r.baseTier}, final=${r.finalTier}`,
    );
  }
});

test('invariant: final S only when dropStick === 3 (perfect-stick gate), for all 4096', () => {
  for (const sc of allScores()) {
    const r = assignTier(sc);
    if (r.finalTier === 'S') {
      assert.equal(sc.dropStick, 3, `S with dropStick=${sc.dropStick} on ${JSON.stringify(sc)}`);
    }
  }
});

test('invariant: squat<2 OR dropStick<2 ⟹ finalTier === C (landing-integrity cap), for all 4096', () => {
  for (const sc of allScores()) {
    const r = assignTier(sc);
    if (sc.squat < 2 || sc.dropStick < 2) {
      assert.equal(
        r.finalTier,
        'C',
        `weak foundational control but tier ${r.finalTier} on ${JSON.stringify(sc)}`,
      );
    }
    if (r.gateFired === 'capC') assert.equal(r.finalTier, 'C');
  }
});

test('invariant: S->A gate is provably unreachable given Gate 1/2, for all 4096 (documents dead branch)', () => {
  // Gate 3 (S requires a perfect stick) can only matter when tier is still S AND dropStick < 3.
  // But Gate 1 (dropStick < 2) and Gate 2 (dropStick === 2) already fire for every dropStick < 3,
  // dropping tier off S first — so gateFired can NEVER be 'S->A'. This pins that proof: if a
  // future change to Gate 1/2 makes the branch reachable, this fails loudly and forces someone
  // to verify the now-live branch behaves correctly (and update this test + scoring.ts's comment).
  for (const sc of allScores()) {
    const r = assignTier(sc);
    assert.notEqual(
      r.gateFired,
      'S->A',
      `S->A fired on ${JSON.stringify(sc)} — Gate 1/2 changed and the unreachability invariant broke. ` +
        `If intentional, update this test AND the Gate 3 comment in scoring.ts.`,
    );
  }
});
