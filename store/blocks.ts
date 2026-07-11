/**
 * Rotation / block-state persistence (BUILD_BRIEF §2A.5 / EXERCISE_LIBRARY.md §4).
 *
 * A training block is 8–10 weeks. Within a block an athlete's session uses a fixed variant
 * per slot fill (stored in `BlockState.slotVariants`); at a block boundary the coach rotates
 * DELIBERATELY (not on every assembly) and `blockIndex` advances. Rotation prefers
 * `progression_to` when the athlete has earned it, else a same-family lateral swap for novelty;
 * on a jump-difficulty-ceilinged day (max-velocity days) jump fills do NOT advance in
 * difficulty — they stay light to protect the runs.
 */

import type { BlockState, SplitChoice, Tier } from '../engine/types.ts';
import type { Exercise, DayTemplate } from '../engine/program.ts';
import { slotKey, isAvailableAtTier } from '../engine/program.ts';
import { readCollection, writeCollection } from './json-store.ts';

/** Recommended block length before rotating (weeks). Tunable (see FEATURE_IDEAS.md). */
export const BLOCK_WEEKS = 9;

// ---------------------------------------------------------------------------
// Training split (2/3/4-day) — which days of the authored templates an athlete runs
// ---------------------------------------------------------------------------

/**
 * The day numbers each split runs, as a subset of the four authored day-templates. Mirrors the
 * established tier-default day counts (2-day = lower+speed / upper+plyo; 3-day adds the
 * lateral-rotational day; 4-day is the full split). This is the single source of the split→days
 * mapping — the day-count no longer comes from the tier (that coupling moved to the coach's
 * per-athlete split choice; tier still governs content/dose inside each day).
 *
 * (Coaching note: the 3-day reference program blends template days 3 and 4 into its third
 * session; we approximate with day 4 — the established `[1,2,4]` mapping. To favour the
 * accel/posterior day instead, change 3day to `[1,2,3]` here; it is a one-line coaching tune.)
 */
export const SPLIT_DAYS: Record<SplitChoice, number[]> = {
  '2day': [1, 2],
  '3day': [1, 2, 4],
  '4day': [1, 2, 3, 4],
};

/** How a split switch treats the athlete's current rotation state. */
export type SplitSwitchMode = 'fresh' | 'carry';

/**
 * The athlete's active split, defaulting to the full `4day` split when block state is absent or
 * predates the field (legacy records). Centralises the default so no caller branches on it.
 */
export function splitOf(state: BlockState | null | undefined): SplitChoice {
  return state?.activeSplit ?? '4day';
}

/** The day numbers the athlete's split runs (subset of the authored day-templates). */
export function splitDays(state: BlockState | null | undefined): number[] {
  return SPLIT_DAYS[splitOf(state)];
}

/**
 * The next day to run after `lastDay`, within `days` (a split's ascending day list), wrapping at
 * the end. This doubles as the CLAMP for a split change: it returns the first authored day strictly
 * greater than `lastDay`, or wraps to the first day when none is greater — so a `lastDay` the
 * current split no longer runs (e.g. day 4 after a 4→2-day switch, or the dropped day 3 of a 3-day
 * split) still resolves to a valid day instead of one that doesn't exist. `days` is assumed
 * non-empty and ascending, which every `SPLIT_DAYS` entry is. Pure — the track screen's default-day
 * arithmetic (PHASE_PLAN_track_workout_screen.md Step 3).
 */
export function nextDayInSplit(lastDay: number, days: number[]): number {
  return days.find((d) => d > lastDay) ?? days[0]!;
}

/**
 * Apply a split switch to block state (pure). `mode` decides what happens to rotation:
 *  - `fresh` → start a new block: reset `blockIndex` to 0 and the start date to now, and clear
 *    `slotVariants` so the new split re-selects every variant from scratch.
 *  - `carry` → keep the block index, start date, and stored variants; only the split changes.
 *    Days dropped from the split leave their variants unused (harmless; a later switch back
 *    restores them since the assembler only reads variants for active days).
 */
export function switchSplit(
  state: BlockState,
  newSplit: SplitChoice,
  mode: SplitSwitchMode,
  now: Date = new Date(),
): BlockState {
  if (mode === 'fresh') {
    return {
      athleteId: state.athleteId,
      blockStartDate: now.toISOString().slice(0, 10),
      blockIndex: 0,
      slotVariants: {},
      activeSplit: newSplit,
    };
  }
  return { ...state, activeSplit: newSplit };
}

export async function getBlockState(athleteId: string): Promise<BlockState | null> {
  const all = await readCollection('block_state');
  return all.find((b) => b.athleteId === athleteId) ?? null;
}

/** Get existing block state or a fresh block-0 state (not yet persisted). */
export async function getOrInitBlockState(
  athleteId: string,
  now: Date = new Date(),
): Promise<BlockState> {
  const existing = await getBlockState(athleteId);
  if (existing) return existing;
  return {
    athleteId,
    blockStartDate: now.toISOString().slice(0, 10),
    blockIndex: 0,
    slotVariants: {},
  };
}

/** Upsert block state. */
export async function saveBlockState(state: BlockState): Promise<void> {
  const all = await readCollection('block_state');
  const idx = all.findIndex((b) => b.athleteId === state.athleteId);
  if (idx === -1) all.push(state);
  else all[idx] = state;
  await writeCollection('block_state', all);
}

/** Days elapsed in the current block. */
export function blockAgeDays(state: BlockState, now: Date = new Date()): number {
  const start = new Date(state.blockStartDate + 'T00:00:00Z').getTime();
  return Math.floor((now.getTime() - start) / 86_400_000);
}

/** Is the athlete due to rotate (>= BLOCK_WEEKS since the block started)? */
export function dueForRotation(state: BlockState, now: Date = new Date()): boolean {
  return blockAgeDays(state, now) >= BLOCK_WEEKS * 7;
}

/**
 * Advance one slot fill's variant within its family (pure). Prefers `progression_to` if it is
 * available at the tier; else a lateral swap to another available family member not currently
 * used; else keeps the current one. On a difficulty-ceilinged day, never advances above the
 * current difficulty (protects the runs).
 */
export function advanceVariant(
  exercises: Exercise[],
  currentId: string,
  tier: Tier,
  hasCeiling: boolean,
): string {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const current = byId.get(currentId);
  if (!current) return currentId;

  const familyMembers = exercises.filter(
    (e) => e.variation_family === current.variation_family && isAvailableAtTier(e, tier),
  );

  // Prefer the explicit progression, if available and (on ceilinged days) not harder.
  if (current.progression_to) {
    const next = byId.get(current.progression_to);
    if (next && isAvailableAtTier(next, tier) && !(hasCeiling && next.difficulty > current.difficulty)) {
      return next.id;
    }
  }

  // Lateral swap: another available member, preferring a different id at similar difficulty.
  const others = familyMembers
    .filter((e) => e.id !== currentId)
    .filter((e) => !(hasCeiling && e.difficulty > current.difficulty))
    .sort((a, b) => Math.abs(a.difficulty - current.difficulty) - Math.abs(b.difficulty - current.difficulty));
  if (others.length > 0) return others[0]!.id;

  return currentId;
}

/**
 * Rotate an athlete to a new block (pure state transform). Increments the block index, resets
 * the start date, and advances every stored variant. Multi-family trunk pools cross-rotate
 * automatically via the new blockIndex at the next assembly; single-family fills advance here.
 */
export function rotateBlockState(
  state: BlockState,
  exercises: Exercise[],
  templates: DayTemplate[],
  tier: Tier,
  now: Date = new Date(),
): BlockState {
  const newIndex = state.blockIndex + 1;
  const ceilingDays = new Set(
    templates.filter((t) => t.jump_difficulty_ceiling !== null).map((t) => t.day),
  );

  const newVariants: Record<string, string> = {};
  for (const [key, exId] of Object.entries(state.slotVariants)) {
    const day = Number(key.split(':')[0]);
    const isJumpCeilingFill = key.includes(':jump:') && ceilingDays.has(day);
    newVariants[key] = advanceVariant(exercises, exId, tier, isJumpCeilingFill);
  }

  return {
    athleteId: state.athleteId,
    blockStartDate: now.toISOString().slice(0, 10),
    blockIndex: newIndex,
    slotVariants: newVariants,
  };
}

// (slotKey re-exported for callers assembling keys.)
export { slotKey };
