/**
 * Scoring engine — DURABLE CORE. Implements `Youth_Tiering_Assessment_Spec.md` §4 exactly.
 *
 * Two steps:
 *   Step 1 — sum the six 0–3 scores → base tier from the raw-total bands.
 *   Step 2 — apply hard gates that can only LOWER the tier, never raise it.
 *
 * Design intent (BUILD_BRIEF §3.2 — do not soften without flagging to the coach):
 *   Landing integrity is THE gate. A powerful, well-balanced athlete who cannot control
 *   landings is routed DOWN, not up. Gates only ever reduce the tier. This is a youth
 *   long-term-development model: injury avoidance and movement control outrank output.
 *
 * Pure functions only — identical behavior in this tool and the future app (BUILD_BRIEF §1).
 * No I/O, no dates, no randomness.
 */

import type {
  Assessment,
  GateFired,
  ProvisionalScoringResult,
  Scores,
  ScoringResult,
  Tier,
  TierContext,
} from './types.ts';
import { TIER_RANK, SCORE_KEYS, canonicalScores } from './types.ts';

/** Spec §4 step-1 raw-total bands (max raw = 18). Listed high → low. */
const BANDS: ReadonlyArray<{ min: number; tier: Tier }> = [
  { min: 17, tier: 'S' }, // 17–18
  { min: 13, tier: 'A' }, // 13–16
  { min: 8, tier: 'B' }, //  8–12
  { min: 0, tier: 'C' }, //  0–7
];

/** Sum the six scores → raw total (0–18). */
export function rawTotal(scores: Scores): number {
  let sum = 0;
  for (const key of SCORE_KEYS) sum += scores[key];
  return sum;
}

/** Spec §4 step 1 — base tier from the raw-total bands, BEFORE gates. */
export function baseTierFromRaw(raw: number): Tier {
  for (const band of BANDS) {
    if (raw >= band.min) return band.tier;
  }
  // Unreachable for raw >= 0; defensive only.
  return 'C';
}

/** Return the lower-ranked of two tiers (C < B < A < S). Used by the lower-only gates. */
export function minTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

/**
 * Spec §4 — assign a tier from the six scores.
 *
 * Returns full provenance: rawTotal, baseTier (before gates), finalTier (after gates,
 * the routing value), and which gate fired (validation, BUILD_BRIEF §3.7).
 *
 * Gate order is exactly the spec's (§4 impl note): cap-at-C, then cap-at-A, then
 * S-requires-perfect-stick. Each can only lower the tier.
 */
export function assignTier(scores: Scores): ScoringResult {
  const raw = rawTotal(scores);
  const baseTier = baseTierFromRaw(raw);

  let tier: Tier = baseTier;
  let gateFired: GateFired = 'none';

  // Gate 1 — cap at C: foundational control missing. (Test 1 squat < 2 OR Test 2 dropStick < 2)
  if (scores.squat < 2 || scores.dropStick < 2) {
    const lowered = minTier(tier, 'C');
    if (lowered !== tier) {
      tier = lowered;
      gateFired = 'capC';
    }
  }
  // Gate 2 — cap at A: single-leg landing not solid enough for S-tier. (Test 2 dropStick === 2)
  // `else if`: if the cap-at-C condition already held, that is the binding (lower) gate.
  else if (scores.dropStick === 2) {
    const lowered = minTier(tier, 'A');
    if (lowered !== tier) {
      tier = lowered;
      gateFired = 'capA';
    }
  }

  // Gate 3 — S requires a perfect stick: if still S but dropStick < 3, drop to A.
  //
  // NOTE (verified exhaustively over all 4096 score combinations): under the current Gate 1/2
  // conditions this branch is structurally UNREACHABLE. Gate 1 (dropStick < 2) and Gate 2
  // (dropStick === 2) both test dropStick directly and fire BEFORE this point whenever
  // dropStick < 3 — so by the time Gate 3 runs, tier is no longer 'S' unless dropStick === 3
  // already. This is intentional defense-in-depth: it mirrors spec §4's stated 3-step
  // algorithm verbatim and stays correct if Gate 1/2 are ever loosened. It is NOT dead in a
  // way that can silently rot — engine/scoring.test.ts asserts `gateFired === 'S->A'` never
  // occurs, so any future change to Gate 1/2 that makes this branch reachable fails loudly and
  // forces a re-verification that it still does the right thing.
  if (tier === 'S' && scores.dropStick < 3) {
    tier = 'A';
    gateFired = 'S->A';
  }

  return { rawTotal: raw, baseTier, finalTier: tier, gateFired };
}

/**
 * Brief §4.4 — assign a tier WITH provenance context: the provisional rules, which are
 * "gates only lower" applied to provenance instead of movement quality. {@link assignTier}
 * stays byte-identical (it IS spec §4); this wraps it.
 *
 * | # | Rule | Here |
 * |---|------|------|
 * | 1 | Unreviewed can LOWER a tier immediately        | `minTier(gates, prior)` keeps a drop |
 * | 2 | Unreviewed can never RAISE — promotion waits   | `minTier(gates, prior)` holds a rise |
 * | 3 | First assessment: dropStick treated as `min(scored, 2)` | nobody trains at S on an unreviewed eye |
 * | 4 | On review: recompute — film is truth           | plain {@link assignTier}, no holds |
 *
 * PROVENANCE SPLIT (signed off in the S4 review): `rawTotal`, `baseTier`, and `gateFired`
 * are MEASUREMENTS — pure functions of the real canonical scores, never of clamped or
 * held values. Only `finalTier` (routing) absorbs the provisional rules. So every
 * provisional hold reads the same way in a record — base X · gate <real> · final Y ·
 * provisional true — whichever rule produced it, and a record can never contradict
 * itself (e.g. `dropStick: 3` alongside `gateFired: 'capA'`).
 */
export function assignTierWithContext(scores: Scores, ctx: TierContext): ProvisionalScoringResult {
  // The measurement: gates on the real scores. Everything except finalTier comes from here.
  const real = assignTier(scores);

  if (ctx.reviewed) {
    // Rule 4 — film is truth. Promotion lands now; demotion lands now. No holds.
    return { ...real, provisional: false, unrestrictedTier: real.finalTier };
  }

  let finalTier: Tier;
  if (ctx.priorTier === null) {
    // Rule 3 — first assessment, nothing to lower from: route as if dropStick were at
    // most 2, so the existing cap-at-A geometry lands the tier at A or below. Only the
    // routing value: the clamped run's rawTotal/baseTier/gateFired are discarded.
    finalTier = assignTier({ ...scores, dropStick: Math.min(scores.dropStick, 2) as Scores['dropStick'] }).finalTier;
  } else {
    // Rules 1–2 — against the athlete's current routing tier: a drop lands today (the
    // safe direction should be fast); a rise waits for film (the risky direction costs
    // a measurement). See TierContext.priorTier for why holds chain across unreviewed
    // assessments.
    finalTier = minTier(real.finalTier, ctx.priorTier);
  }

  return { ...real, finalTier, provisional: true, unrestrictedTier: real.finalTier };
}

export type GutCallVerdict = 'match' | 'differs' | 'no_call';

/**
 * The gut-call verdict (§3.7 / brief §4.4) — THE single derivation. The CLI reveal, the
 * dashboard, and the Lab (S15) all call this; do not re-derive it inline anywhere.
 *
 * The coach is predicting WHAT THE SCORES SAY — gates included, provenance excluded. So
 * the comparison is against the gates' own result on the canonical scores
 * (unrestrictedTier), NEVER the held/provisional `finalTier`: a coach can't predict
 * whether the film's been watched, and must not read DIFFERS for being right on the one
 * occasion the eye-training loop exists to confirm (a kid getting better, held by rule 2).
 * Same principle as the paper cross-check in store/ingest.ts — no human in this loop has
 * a provisional concept.
 */
export function gutCallVerdict(
  a: Pick<Assessment, 'coachGutCall' | 'scoresLive' | 'scoresReviewed'>,
): GutCallVerdict {
  if (a.coachGutCall === null) return 'no_call';
  const unrestricted = assignTier(canonicalScores(a)).finalTier;
  return a.coachGutCall === unrestricted ? 'match' : 'differs';
}
