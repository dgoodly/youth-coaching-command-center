/**
 * Exercise-library schema types — a faithful mirror of `library/exercise_library.json`
 * (schema defined in EXERCISE_LIBRARY.md §2; the JSON is the source of truth). Field names
 * are snake_case to match the JSON exactly, so the coach edits one shape and there is no
 * mapping layer to drift.
 *
 * Two independent ratings, kept SEPARATE by design (BUILD_BRIEF §2A.3, do-not-re-litigate):
 *   - `min_tier` (C/B/A/S) — the safety/selection GATE.
 *   - `difficulty` (1–10)  — inherent demand, for session load-balancing + progression order.
 *
 * This file is schema + dose/availability helpers only. The selection/rotation/assembler
 * LOGIC lives in engine/assembler.ts (built separately, per EXERCISE_LIBRARY.md §3–§4).
 */

import type { Tier } from './types.ts';
import { TIER_RANK } from './types.ts';

/** The 8 session slots (EXERCISE_LIBRARY.md §2). Note `trunk` — folds into the back of lift days. */
export type Slot =
  | 'warmup_base'
  | 'funnel_linear'
  | 'funnel_cod'
  | 'jump'
  | 'sprint'
  | 'lift'
  | 'trunk'
  | 'cooldown';

/**
 * Fixed skeleton order (BUILD_BRIEF §3.5 + the trunk addition): warm-up base → funnel →
 * Jump → Sprint → Lift → Trunk → cooldown. Exactly one funnel per session (chosen by the
 * day's emphasis). Trunk sits after lift ("folded into the back of lift days").
 */
export const SLOT_ORDER: readonly Slot[] = [
  'warmup_base',
  'funnel_linear',
  'funnel_cod',
  'jump',
  'sprint',
  'lift',
  'trunk',
  'cooldown',
] as const;

export type Plane = 'sagittal' | 'frontal' | 'transverse' | 'mixed';
export type Laterality = 'bilateral' | 'unilateral';

/** Per-tier prescription. `reps` may be a number OR a string ("15yd", "3+1", "6 ea"). */
export interface TierDose {
  sets: number;
  reps: number | string;
  rest_sec: number;
}

/**
 * Dose is EITHER a single `{ all }` string (warm-up / funnel / cooldown — scale by trimming
 * for lower maturity) OR a per-tier map. In the per-tier map, `sets: 0` means "NOT prescribed
 * at this tier" (BUILD_BRIEF §2A.6) — distinct from `min_tier` gating.
 */
export type AllDose = { all: string };
export type PerTierDose = Partial<Record<Tier, TierDose>>;
export type Dose = AllDose | PerTierDose;

export interface Exercise {
  id: string;
  name: string;
  slot: Slot;
  /** The quality/movement trained (e.g. 'horizontal_jump', 'hinge', 'max_velocity'). */
  pattern: string;
  plane: Plane;
  laterality: Laterality;
  /** Safety/selection gate. */
  min_tier: Tier;
  /** Inherent demand 1–10 (session balancing + progression order). */
  difficulty: number;
  /** Rotation group — members train the same job in the same slot and are swappable (§4). */
  variation_family: string;
  /** Whether a landing/catch is trained (landing-integrity / valgus theme). */
  stick: boolean;
  /** Knee-tracking exercise — prioritized for athletes with a valgus watch. */
  valgus_relevant: boolean;
  equipment: string[];
  dose: Dose;
  cue: string;
  progression_to: string | null;
  regression_to: string | null;
  notes: string;
}

/** The library root object as stored on disk. */
export interface Library {
  schema_version: string;
  difficulty_scale: Record<string, string>;
  slots: Slot[];
  tiers: Tier[];
  notes?: string;
  exercises: Exercise[];
}

// ---------------------------------------------------------------------------
// Dose / availability helpers (pure)
// ---------------------------------------------------------------------------

export function isAllDose(dose: Dose): dose is AllDose {
  return typeof (dose as AllDose).all === 'string';
}

/**
 * The prescription for a tier, or `null` if the exercise carries a per-tier dose and this
 * tier is 0-set (not prescribed). For `{ all }` doses this returns null (the caller uses the
 * `all` string directly) — check {@link isAllDose} first.
 */
export function tierDose(ex: Exercise, tier: Tier): TierDose | null {
  if (isAllDose(ex.dose)) return null;
  const d = ex.dose[tier];
  if (!d || d.sets === 0) return null;
  return d;
}

/**
 * Is this exercise AVAILABLE for an athlete at `tier`? Two independent conditions (§3 step 1
 * + §2A.6): the tier meets the `min_tier` gate, AND — for per-tier-dose exercises — the tier
 * is not 0-set. `{ all }`-dose exercises (warm-up/funnel/cooldown) are available whenever the
 * gate is met.
 */
export function isAvailableAtTier(ex: Exercise, tier: Tier): boolean {
  if (TIER_RANK[tier] < TIER_RANK[ex.min_tier]) return false;
  if (isAllDose(ex.dose)) return true;
  return ex.dose[tier] !== undefined && ex.dose[tier]!.sets > 0;
}

/**
 * Render a dose to a short human string for session printouts. Robust to imperfect library
 * data: a blank/whitespace `reps` renders as "sub-max" (e.g. pull-up volume), and a
 * non-numeric `rest_sec` is dropped rather than printed as garbage.
 */
export function doseLabel(ex: Exercise, tier: Tier): string {
  if (isAllDose(ex.dose)) return ex.dose.all;
  const d = tierDose(ex, tier);
  if (!d) return '(not prescribed at this tier)';
  const repsRaw = d.reps === undefined || String(d.reps).trim() === '' ? 'sub-max' : d.reps;
  const restNum = Number(d.rest_sec);
  const rest = Number.isFinite(restNum) && restNum > 0 ? ` (rest ${restNum}s)` : '';
  return `${d.sets} × ${repsRaw}${rest}`;
}

// ---------------------------------------------------------------------------
// Day templates + assembler-facing constants (EXERCISE_LIBRARY.md §3–§4)
// ---------------------------------------------------------------------------

export type Emphasis = 'linear-speed' | 'change-of-direction';

/**
 * A slot fill is a ROTATION POOL: an ordered list of variation_families. Within a training
 * block the fill uses `pool[blockIndex % pool.length]`; single-family pools never cross-rotate,
 * multi-family pools (used for trunk) cycle biases across blocks. Within the chosen family,
 * the member rotates too (progression/lateral).
 */
export type SlotFill = string[]; // variation_family names, priority/rotation order

/**
 * A day template — the sequencing-safe recipe for one training day, shared across tiers.
 * Warm-up base, the emphasis-selected funnel, and cooldown are not family-rotated (they
 * include all tier-available drills); jump/sprint/lift/trunk are filled from pools.
 */
export interface DayTemplate {
  day: number;
  label: string;
  emphasis: Emphasis;
  funnel_mode: 'full' | 'short';
  sprint_emphasis: string; // descriptive; realized emphasis may regress at low tiers
  /**
   * Summed-jump-difficulty ceiling (the hard sequencing rule, per the coach's spec): on a
   * max-velocity day the day's TOTAL jump difficulty must stay ≤ this, protecting the runs
   * from accumulated upstream plyo load. `null` = no ceiling (non-max-velocity days).
   */
  jump_difficulty_ceiling: number | null;
  slots: {
    jump: SlotFill[];
    sprint: SlotFill[];
    lift: SlotFill[];
    trunk: SlotFill[];
  };
}

/** Per-tier per-exercise difficulty target band (EXERCISE_LIBRARY.md §3 step 6, "rough guide"). */
export const DIFFICULTY_BAND: Record<Tier, [number, number]> = {
  C: [1, 3],
  B: [2, 4],
  A: [4, 6],
  S: [5, 8],
};

/** Stable key for a slot fill within a day, used to persist the chosen variant. */
export function slotKey(day: number, slot: Slot, index: number): string {
  return `${day}:${slot}:${index}`;
}
