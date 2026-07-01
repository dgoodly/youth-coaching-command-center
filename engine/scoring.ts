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

import type { Scores, Tier, GateFired, ScoringResult } from './types.ts';
import { TIER_RANK, SCORE_KEYS } from './types.ts';

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
  if (tier === 'S' && scores.dropStick < 3) {
    tier = 'A';
    gateFired = 'S->A';
  }

  return { rawTotal: raw, baseTier, finalTier: tier, gateFired };
}
