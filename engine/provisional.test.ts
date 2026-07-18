/**
 * The §4.4 provisional rules (S4) — `assignTierWithContext`. All four rules, plus the
 * provenance split signed off in the S4 review: rawTotal/baseTier/gateFired are
 * MEASUREMENTS (pure functions of the real scores); only finalTier (routing) absorbs the
 * provisional rules. Every provisional hold must read identically in the record whichever
 * rule produced it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Scores, TestScore, Tier } from './types.ts';
import { assignTier, assignTierWithContext, gutCallVerdict } from './scoring.ts';

/** Scores in spec order: squat, dropStick, balance, pushup, broad, pogo. */
function s(squat: TestScore, dropStick: TestScore, balance: TestScore, pushup: TestScore, broad: TestScore, pogo: TestScore): Scores {
  return { squat, dropStick, balance, pushup, broad, pogo };
}

const PERFECT = s(3, 3, 3, 3, 3, 3); // raw 18 → S, no gates

// ---------------------------------------------------------------------------
// Rule 1 — an unreviewed assessment CAN LOWER a tier, immediately
// ---------------------------------------------------------------------------

test('rule 1: unreviewed drop lands today — prior A, scores compute C', () => {
  const scores = s(1, 2, 2, 2, 2, 2); // squat < 2 → capC
  const r = assignTierWithContext(scores, { reviewed: false, priorTier: 'A' });
  assert.equal(r.finalTier, 'C', 'the safe direction is fast');
  assert.equal(r.provisional, true);
  assert.equal(r.gateFired, 'capC', 'the real gate that fired');
  assert.equal(r.unrestrictedTier, 'C');
});

// ---------------------------------------------------------------------------
// Rule 2 — an unreviewed assessment can NEVER RAISE; promotion waits for film
// ---------------------------------------------------------------------------

test('rule 2: unreviewed promotion is held at the prior tier', () => {
  const r = assignTierWithContext(PERFECT, { reviewed: false, priorTier: 'B' });
  assert.equal(r.finalTier, 'B', 'held — promotion waits for film');
  assert.equal(r.provisional, true);
  assert.equal(r.unrestrictedTier, 'S', 'what review would release');
  // Provenance split: the hold is routing, not measurement.
  assert.equal(r.rawTotal, 18);
  assert.equal(r.baseTier, 'S');
  assert.equal(r.gateFired, 'none', 'no real gate fired — provisional explains the gap');
});

test('rule 2: unreviewed same-tier result passes through unheld (still provisional)', () => {
  const scores = s(2, 3, 2, 3, 2, 2); // raw 14 → A, no gates
  const r = assignTierWithContext(scores, { reviewed: false, priorTier: 'A' });
  assert.equal(r.finalTier, 'A');
  assert.equal(r.unrestrictedTier, 'A', 'no hold applied');
  assert.equal(r.provisional, true, 'provisional describes provenance, not whether a hold bound');
});

test('rules 1–2 chain: a hold becomes the next unreviewed assessment prior', () => {
  // Held at B (rule 2)…
  const first = assignTierWithContext(PERFECT, { reviewed: false, priorTier: 'B' });
  // …and the next unreviewed assessment, also computing S, is held at B again.
  const second = assignTierWithContext(PERFECT, { reviewed: false, priorTier: first.finalTier });
  assert.equal(second.finalTier, 'B', 'holds chain until a review lands');
});

// ---------------------------------------------------------------------------
// Rule 3 — first assessment: route as if dropStick were min(scored, 2)
// ---------------------------------------------------------------------------

test('rule 3: first assessment with a perfect stick routes at A — nobody trains at S on an unreviewed eye', () => {
  const r = assignTierWithContext(PERFECT, { reviewed: false, priorTier: null });
  assert.equal(r.finalTier, 'A', 'clamped dropStick lands the cap-at-A geometry');
  assert.equal(r.provisional, true);
  assert.equal(r.unrestrictedTier, 'S');
  // Provenance split (S4 review change #1): the record must not contradict itself.
  // dropStick was REALLY 3, so no gate fired on the real scores.
  assert.equal(r.rawTotal, 18, 'measurement: sum of the real scores');
  assert.equal(r.baseTier, 'S', 'measurement: band of the real raw total');
  assert.equal(r.gateFired, 'none', 'gateFired never comes from the clamped run');
});

test('rule 3: clamp is a no-op when dropStick is already <= 2 — real gates show through', () => {
  const scores = s(2, 1, 3, 3, 3, 3); // dropStick < 2 → capC on the real scores
  const r = assignTierWithContext(scores, { reviewed: false, priorTier: null });
  assert.equal(r.finalTier, 'C');
  assert.equal(r.gateFired, 'capC', 'the real gate, really fired');
  assert.equal(r.unrestrictedTier, 'C');
  assert.equal(r.provisional, true);
});

test('rule 3 and rule 2 holds are indistinguishable in the stored shape', () => {
  // The property Donovan asked for: every provisional hold reads the same way.
  const rule3 = assignTierWithContext(PERFECT, { reviewed: false, priorTier: null }); // final A
  const rule2 = assignTierWithContext(PERFECT, { reviewed: false, priorTier: 'A' }); // final A
  assert.deepEqual(
    { rawTotal: rule3.rawTotal, baseTier: rule3.baseTier, finalTier: rule3.finalTier, gateFired: rule3.gateFired, provisional: rule3.provisional },
    { rawTotal: rule2.rawTotal, baseTier: rule2.baseTier, finalTier: rule2.finalTier, gateFired: rule2.gateFired, provisional: rule2.provisional },
  );
});

// ---------------------------------------------------------------------------
// Rule 4 — on review: recompute. Film is truth; promotion AND demotion land now.
// ---------------------------------------------------------------------------

test('rule 4: review releases a held promotion', () => {
  const r = assignTierWithContext(PERFECT, { reviewed: true, priorTier: 'B' });
  assert.equal(r.finalTier, 'S', 'film is truth — promotion lands');
  assert.equal(r.provisional, false);
  assert.equal(r.unrestrictedTier, 'S');
});

test('rule 4: review lands a demotion too, via the real gates', () => {
  const reviewed = s(3, 1, 3, 3, 3, 3); // film shows the stick was a 1 → capC
  const r = assignTierWithContext(reviewed, { reviewed: true, priorTier: 'S' });
  assert.equal(r.finalTier, 'C');
  assert.equal(r.gateFired, 'capC');
  assert.equal(r.provisional, false);
});

test('rule 4: reviewed result matches plain assignTier exactly — no residue from the rules', () => {
  for (const scores of [PERFECT, s(2, 2, 2, 2, 2, 2), s(1, 0, 3, 2, 1, 2)]) {
    const plain = assignTier(scores);
    const ctx = assignTierWithContext(scores, { reviewed: true, priorTier: 'C' });
    assert.deepEqual(
      { rawTotal: ctx.rawTotal, baseTier: ctx.baseTier, finalTier: ctx.finalTier, gateFired: ctx.gateFired },
      plain,
    );
  }
});

// ---------------------------------------------------------------------------
// Gut-call verdict — the eye predicts what the scores say, never provenance
// ---------------------------------------------------------------------------

function record(scores: Scores, coachGutCall: Tier | null, reviewed: Scores | null = null) {
  return { coachGutCall, scoresLive: scores, scoresReviewed: reviewed };
}

test('gut-call: a correct eye MATCHES even when rule 2 holds the tier below it', () => {
  // Kid improved to S; unreviewed, so routing holds at B — but the coach's eye was right.
  // Scoring the coach against the hold would print DIFFERS on the exact occasion the
  // eye-training loop exists to confirm. This is the inversion the fix removes.
  const held = assignTierWithContext(PERFECT, { reviewed: false, priorTier: 'B' });
  assert.equal(held.finalTier, 'B');
  assert.equal(gutCallVerdict(record(PERFECT, 'S')), 'match', 'compared to unrestrictedTier, not the hold');
});

test('gut-call: rule 3 likewise — S on a first assessment with a perfect stick is a match', () => {
  assert.equal(gutCallVerdict(record(PERFECT, 'S')), 'match');
  assert.equal(gutCallVerdict(record(PERFECT, 'A')), 'differs', 'the hold is not the prediction target');
});

test('gut-call: gates ARE part of the prediction target', () => {
  const gated = s(3, 1, 3, 3, 3, 3); // capC on the real scores
  assert.equal(gutCallVerdict(record(gated, 'C')), 'match', 'the eye is expected to see the gate');
  assert.equal(gutCallVerdict(record(gated, 'S')), 'differs');
});

test('gut-call: reviewed scores win the comparison, and no call is its own verdict', () => {
  const live = s(2, 3, 2, 3, 2, 2); // A live…
  const reviewed = s(1, 3, 2, 3, 2, 2); // …but film shows the squat was a 1 → capC
  assert.equal(gutCallVerdict(record(live, 'C', reviewed)), 'match', 'canonical = reviewed');
  assert.equal(gutCallVerdict(record(live, null)), 'no_call');
});
