/**
 * Program assembler — DURABLE CORE. Turns (athlete tier + day template + rotation state)
 * into an assembled session from the single tagged library, implementing the selection
 * pipeline in EXERCISE_LIBRARY.md §3 and the rotation model in §4.
 *
 * Pipeline per required slot fill (§3):
 *   1. gate by tier  — `isAvailableAtTier` (min_tier AND the 0-set convention);
 *   2. filter by equipment the coach has;
 *   3. match the day's plane/pattern needs — encoded as the fill's variation-family pool;
 *   4. valgus priority — if the athlete has the watch, prefer `stick`/`valgus_relevant`;
 *   5. rotate within the family (block state) so blocks don't go stale;
 *   6. difficulty balance — advisory band check per tier;
 *   7. enforce hard rules — fixed skeleton order + the summed-jump-difficulty sequencing guard.
 *
 * Pure: no I/O. The caller supplies exercises, template, equipment, and block state, and
 * persists the returned (possibly updated) slotVariants.
 */

import type { Tier } from './types.ts';
import type { Exercise, DayTemplate, Slot, SlotFill } from './program.ts';
import {
  SLOT_ORDER,
  DIFFICULTY_BAND,
  slotKey,
  isAvailableAtTier,
  doseLabel,
  equipmentAvailable,
} from './program.ts';

/**
 * Difficulty at/above which a `max_velocity`-pattern sprint counts as TRUE max-velocity (the
 * "Proficient — max-velocity" band, EXERCISE_LIBRARY.md §1). Below it (e.g. a build-up ramp to
 * ~90%, difficulty 3) the drill is submaximal and labeled as a build-up, not flat-out max velocity.
 */
const MAX_VELOCITY_DIFFICULTY_FLOOR = 5;

export interface AssembledItem {
  exercise: Exercise;
  /** Human dose string for the athlete's tier (or the { all } string). */
  doseText: string;
}

export interface SessionBlock {
  slot: Slot;
  title: string;
  items: AssembledItem[];
}

export interface AssembledSession {
  tier: Tier;
  day: number;
  label: string;
  emphasis: DayTemplate['emphasis'];
  /** Realized sprint emphasis — may have regressed (e.g. C loses max-velocity). */
  sprintEmphasis: string;
  blocks: SessionBlock[];
  /** Summed difficulty of the JUMP block (drives the sequencing guard). */
  jumpDifficultySum: number;
  /** The day's summed-jump-difficulty ceiling (null = no ceiling). For display + the guard. */
  jumpDifficultyCeiling: number | null;
  assemblyNotes: string[];
}

export interface AssembleParams {
  tier: Tier;
  day: number;
  exercises: Exercise[];
  template: DayTemplate;
  valgusWatch: boolean;
  /** Coach's available equipment. Use `new Set(['*'])` to allow all. */
  equipment: ReadonlySet<string>;
  /** Current rotation block index (0-based). Defaults to 0. */
  blockIndex?: number;
  /** Persisted per-slot-fill variant choices (slotKey -> exerciseId). */
  slotVariants?: Record<string, string>;
}

export interface AssembleResult {
  session: AssembledSession;
  /** slotVariants after assembly — any fills chosen this run are recorded for block stability. */
  slotVariants: Record<string, string>;
}

const SLOT_TITLES: Record<Slot, string> = {
  warmup_base: 'Warm-up — BASE (every session)',
  funnel_linear: 'Warm-up — FUNNEL: Linear Speed',
  funnel_cod: 'Warm-up — FUNNEL: Change of Direction',
  jump: 'JUMP',
  sprint: 'SPRINT',
  lift: 'LIFT',
  trunk: 'TRUNK (back of the lift block)',
  motor_skill: 'MOTOR-SKILL ENRICHMENT (throw/catch · rotational · locomotor)',
  cooldown: 'Cooldown',
};

function eqOk(ex: Exercise, equipment: ReadonlySet<string>): boolean {
  return equipmentAvailable(ex, equipment);
}

function toItem(ex: Exercise, tier: Tier): AssembledItem {
  return { exercise: ex, doseText: doseLabel(ex, tier) };
}

/** All available drills for a non-rotated slot (warm-up base / funnel / cooldown), library order. */
function fixedSlotItems(
  exercises: Exercise[],
  slot: Slot,
  tier: Tier,
  equipment: ReadonlySet<string>,
): Exercise[] {
  return exercises.filter((e) => e.slot === slot && isAvailableAtTier(e, tier) && eqOk(e, equipment));
}

export interface SelectOptions {
  tier: Tier;
  blockIndex: number;
  valgusWatch: boolean;
  equipment: ReadonlySet<string>;
  /**
   * Difficulty floor for entry selection (usually the tier band's low end). When
   * `preferBandFloor` is true, entry picks the lowest member at or above this floor — so an
   * A athlete starts a family near their level, not at its easiest variant.
   */
  bandFloor: number;
  /**
   * true  → target the tier band (lowest member ≥ bandFloor); used for sprint/lift/trunk and
   *         jumps on non-ceilinged days.
   * false → target the globally-lowest member; used for jumps on a ceilinged (max-velocity)
   *         day, where jumps must stay light to protect the runs.
   */
  preferBandFloor: boolean;
  existingId?: string;
}

/**
 * Select the exercise for one slot fill (§3 steps 1–6). Chooses the family from the pool by
 * block index (with graceful fallback to other pool families), filters to available +
 * equipment, keeps an existing in-block variant, otherwise entry-selects by difficulty target
 * (band-floor vs globally-lowest) with valgus priority as a near-target tiebreak.
 */
export function selectFill(
  exercises: Exercise[],
  pool: SlotFill,
  opts: SelectOptions,
): { exercise: Exercise | null; note?: string } {
  if (pool.length === 0) return { exercise: null };
  const { tier, blockIndex, valgusWatch, equipment, bandFloor, preferBandFloor, existingId } = opts;

  // Pick the block-preferred family; if it has no member available at this tier/equipment,
  // fall back to the next family in the pool (multi-family pools, e.g. trunk, degrade
  // gracefully instead of omitting — a C athlete's Day-2 trunk falls back to anti-extension).
  let candidates: Exercise[] = [];
  for (let i = 0; i < pool.length; i++) {
    const family = pool[(blockIndex + i) % pool.length]!;
    const found = exercises.filter(
      (e) => e.variation_family === family && isAvailableAtTier(e, tier) && eqOk(e, equipment),
    );
    if (found.length > 0) {
      candidates = found;
      break;
    }
  }

  if (candidates.length === 0) {
    return { exercise: null, note: `${pool.join('/')}: no member available at tier ${tier} — omitted.` };
  }

  // Keep the in-block variant if it is still a valid candidate (block stability).
  if (existingId) {
    const keep = candidates.find((e) => e.id === existingId);
    if (keep) return { exercise: keep };
  }

  // Difficulty target: band-floor mode narrows to members ≥ bandFloor (if any exist);
  // otherwise (lowest mode, or no in-band member) use the full candidate set.
  const byDiff = [...candidates].sort((a, b) => a.difficulty - b.difficulty);
  const inBand = byDiff.filter((c) => c.difficulty >= bandFloor);
  const target = preferBandFloor && inBand.length > 0 ? inBand : byDiff;

  // Valgus priority (§3 step 4): near the target floor, prefer a `stick` option, then valgus_relevant.
  if (valgusWatch) {
    const floor = target[0]!.difficulty;
    const near = target.filter((c) => c.difficulty <= floor + 1);
    const sticker = near.find((c) => c.stick);
    if (sticker) return { exercise: sticker };
    const valgus = near.find((c) => c.valgus_relevant);
    if (valgus) return { exercise: valgus };
  }
  return { exercise: target[0]! };
}

/** Assemble a full session. Enforces the fixed skeleton and the hard sequencing rule. */
export function assembleSession(params: AssembleParams): AssembleResult {
  const { tier, day, exercises, template, valgusWatch, equipment } = params;
  const blockIndex = params.blockIndex ?? 0;
  const variants: Record<string, string> = { ...(params.slotVariants ?? {}) };
  const notes: string[] = [];
  const blocks: SessionBlock[] = [];

  // 1. Warm-up base (never rotates — the general primer).
  blocks.push({
    slot: 'warmup_base',
    title: SLOT_TITLES.warmup_base,
    items: fixedSlotItems(exercises, 'warmup_base', tier, equipment).map((e) => toItem(e, tier)),
  });

  // 2. Exactly one funnel, by emphasis. Short mode trims to the first three drills.
  const funnelSlot: Slot = template.emphasis === 'linear-speed' ? 'funnel_linear' : 'funnel_cod';
  let funnel = fixedSlotItems(exercises, funnelSlot, tier, equipment);
  if (funnelSlot === 'funnel_linear' && template.funnel_mode === 'short') {
    funnel = funnel.slice(0, 3);
    notes.push('Linear funnel trimmed to short mode (Day 2 plyo block does the rest).');
  }
  blocks.push({ slot: funnelSlot, title: SLOT_TITLES[funnelSlot], items: funnel.map((e) => toItem(e, tier)) });

  // 3–6. Rotated main-work slots: Jump → Sprint → Lift → Trunk → Motor-skill enrichment.
  const bandFloor = DIFFICULTY_BAND[tier][0];
  for (const slot of ['jump', 'sprint', 'lift', 'trunk', 'motor_skill'] as const) {
    const pools = template.slots[slot] ?? [];
    // Jumps on a ceilinged (max-velocity) day stay light (prime only); everything else targets
    // the tier band so advanced athletes start near their level, not at a family's easiest variant.
    const preferBandFloor = !(slot === 'jump' && template.jump_difficulty_ceiling !== null);
    const items: AssembledItem[] = [];
    pools.forEach((pool, index) => {
      const key = slotKey(day, slot, index);
      const { exercise, note } = selectFill(exercises, pool, {
        tier, blockIndex, valgusWatch, equipment, bandFloor, preferBandFloor, existingId: variants[key],
      });
      if (exercise) {
        items.push(toItem(exercise, tier));
        variants[key] = exercise.id;
      } else {
        delete variants[key];
        if (note) notes.push(note);
      }
    });
    if (items.length > 0) blocks.push({ slot, title: SLOT_TITLES[slot], items });
  }

  // 7. Cooldown.
  const cooldown = fixedSlotItems(exercises, 'cooldown', tier, equipment);
  if (cooldown.length) blocks.push({ slot: 'cooldown', title: SLOT_TITLES.cooldown, items: cooldown.map((e) => toItem(e, tier)) });

  // Fixed skeleton order (defensive — construction already orders).
  blocks.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));

  // Realized sprint emphasis. The max-velocity SLOT is expressed differently by tier (spec §5):
  // A/S run a true flying max-velocity drill; C/B get the family's submaximal build-up (a ramp to
  // ~90%, still pattern `max_velocity` but difficulty below the max-velocity band). A build-up is
  // NOT flat-out max-velocity volume, so we label it honestly rather than printing "max_velocity"
  // for a C athlete. Full regression to acceleration only happens when the tier has no
  // max-velocity-family member at all. (The sequencing guard keys off `pattern`, not this label.)
  const sprintItems = blocks.find((b) => b.slot === 'sprint')?.items ?? [];
  const maxVItems = sprintItems.filter((it) => it.exercise.pattern === 'max_velocity');
  const hasTrueMaxV = maxVItems.some((it) => it.exercise.difficulty >= MAX_VELOCITY_DIFFICULTY_FLOOR);
  let sprintEmphasis = template.sprint_emphasis;
  if (template.sprint_emphasis === 'max_velocity') {
    if (hasTrueMaxV) {
      sprintEmphasis = 'max_velocity';
    } else if (maxVItems.length > 0) {
      sprintEmphasis = 'acceleration+buildup';
      notes.push(`Max-velocity slot realized as a submaximal build-up at tier ${tier} (spec §5: build-ups OK; no flat-out max-velocity volume).`);
    } else {
      sprintEmphasis = 'acceleration';
      notes.push(`Max-velocity not unlocked at tier ${tier} — sprint is acceleration-only (spec §5).`);
    }
  }

  // Difficulty balance (advisory) — count main-work items outside the tier band.
  const [lo, hi] = DIFFICULTY_BAND[tier];
  const mainItems = blocks
    .filter((b) => b.slot === 'jump' || b.slot === 'sprint' || b.slot === 'lift' || b.slot === 'trunk')
    .flatMap((b) => b.items);
  const outOfBand = mainItems.filter((it) => it.exercise.difficulty < lo || it.exercise.difficulty > hi);
  if (mainItems.length > 0 && outOfBand.length > mainItems.length / 2) {
    notes.push(
      `Difficulty balance: ${outOfBand.length}/${mainItems.length} main-work items outside the ${tier} band [${lo}–${hi}] — review (advisory).`,
    );
  }

  const jumpItems = blocks.find((b) => b.slot === 'jump')?.items ?? [];
  const jumpDifficultySum = jumpItems.reduce((s, it) => s + it.exercise.difficulty, 0);

  const session: AssembledSession = {
    tier, day, label: template.label, emphasis: template.emphasis,
    sprintEmphasis, blocks, jumpDifficultySum,
    jumpDifficultyCeiling: template.jump_difficulty_ceiling,
    assemblyNotes: notes,
  };

  assertSequencingRule(session, template);
  return { session, slotVariants: variants };
}

/**
 * HARD SEQUENCING RULE guard (the coach's spec). Max-velocity sprint quality is protected
 * from ACCUMULATED upstream plyo load: on a day that carries a max-velocity sprint, the day's
 * SUMMED jump difficulty must not exceed the template's ceiling. Since Jump precedes Sprint in
 * the skeleton, a breach means max-velocity work sits downstream of too much plyo. The
 * assembler REFUSES to emit (throws) rather than silently reorder — a breach means the
 * template/library is misconfigured.
 */
export function assertSequencingRule(session: AssembledSession, template: DayTemplate): void {
  const hasMaxV = (session.blocks.find((b) => b.slot === 'sprint')?.items ?? []).some(
    (it) => it.exercise.pattern === 'max_velocity',
  );
  const ceiling = template.jump_difficulty_ceiling;
  // A max-velocity day with NO declared ceiling gets no protection — the exact hole this guard
  // exists to close. Treat it as a misconfiguration and refuse, rather than silently allowing
  // unlimited plyo upstream of the runs (null "looks normal" — it's the value on non-max-V days).
  if (hasMaxV && ceiling === null) {
    throw new Error(
      `Hard sequencing rule misconfigured (day ${session.day}, tier ${session.tier}): a max-velocity ` +
        `sprint is present but the template declares no jump_difficulty_ceiling. A max-velocity day ` +
        `must set a ceiling so accumulated plyo load upstream of the runs is bounded.`,
    );
  }
  if (hasMaxV && ceiling !== null && session.jumpDifficultySum > ceiling) {
    throw new Error(
      `Hard sequencing rule violated (day ${session.day}, tier ${session.tier}): max-velocity ` +
        `sprint present but summed jump difficulty ${session.jumpDifficultySum} exceeds the day's ` +
        `ceiling ${ceiling}. Max-velocity must not sit downstream of accumulated plyo load.`,
    );
  }
}
