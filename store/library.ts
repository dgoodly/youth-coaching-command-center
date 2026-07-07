/**
 * Exercise-library loader — reads `library/exercise_library.json` (the canonical 127-exercise
 * library, root object with an `exercises` array) and the global equipment config, returning
 * validated, typed data for the assembler. Light validation so a hand-edited library fails
 * loudly rather than silently producing a broken session.
 *
 * Schema + dose/availability helpers live in engine/program.ts. Selection logic does NOT
 * live here.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Exercise, Library, Slot, DayTemplate, WorkoutPlan } from '../engine/program.ts';
import { SLOT_ORDER, isAllDose } from '../engine/program.ts';
import { isTier, type Tier } from '../engine/types.ts';

// Re-exported so store consumers keep a single import surface; the implementation now lives in
// the durable core (engine/program.ts) so the assembler doesn't import the store.
export { equipmentAvailable } from '../engine/program.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export const LIBRARY_FILE = process.env.CC_LIBRARY_FILE
  ? resolve(process.env.CC_LIBRARY_FILE)
  : join(ROOT, 'library', 'exercise_library.json');

export const EQUIPMENT_CONFIG = process.env.CC_EQUIPMENT_CONFIG
  ? resolve(process.env.CC_EQUIPMENT_CONFIG)
  : join(ROOT, 'config', 'equipment.json');

export const DAY_TEMPLATES_FILE = process.env.CC_DAY_TEMPLATES_FILE
  ? resolve(process.env.CC_DAY_TEMPLATES_FILE)
  : join(ROOT, 'library', 'day-templates.json');

export const PLANS_FILE = process.env.CC_PLANS_FILE
  ? resolve(process.env.CC_PLANS_FILE)
  : join(ROOT, 'library', 'plans.json');

const VALID_SLOTS = new Set<Slot>(SLOT_ORDER);
const VALID_PLANES = new Set(['sagittal', 'frontal', 'transverse', 'mixed']);
const VALID_LATERALITY = new Set(['bilateral', 'unilateral']);

/**
 * Load + validate the library from `file` (defaults to {@link LIBRARY_FILE}). NOT cached: a
 * hand-edit to `exercise_library.json` takes effect on the next call, no restart needed — the
 * whole file is a sub-millisecond parse at this size, and caching it (while day-templates.json
 * is re-read every call) silently broke the coach's "edit any record" workflow. If profiling
 * ever shows this matters, switch to an mtime-checked cache — do not reintroduce a blind one.
 */
export async function loadLibrary(file: string = LIBRARY_FILE): Promise<Library> {
  if (!existsSync(file)) throw new Error(`Library not found: ${file}`);
  const lib = JSON.parse(await readFile(file, 'utf8')) as Library;
  if (!Array.isArray(lib.exercises)) throw new Error('exercise_library.json: missing `exercises` array.');
  validate(lib.exercises);
  return lib;
}

export async function loadExercises(): Promise<Exercise[]> {
  return (await loadLibrary()).exercises;
}

/** Validate structural invariants (unique ids, valid enums, resolvable progression links). */
export function validate(exercises: Exercise[]): void {
  const ids = new Set<string>();
  for (const e of exercises) {
    if (!e.id || ids.has(e.id)) throw new Error(`library: missing or duplicate id "${e.id}".`);
    ids.add(e.id);
    if (!isTier(e.min_tier)) throw new Error(`library: "${e.id}" invalid min_tier "${e.min_tier}".`);
    if (!VALID_SLOTS.has(e.slot)) throw new Error(`library: "${e.id}" invalid slot "${e.slot}".`);
    if (typeof e.difficulty !== 'number' || e.difficulty < 1 || e.difficulty > 10) {
      throw new Error(`library: "${e.id}" difficulty must be 1–10 (got ${e.difficulty}).`);
    }
    if (!VALID_PLANES.has(e.plane)) throw new Error(`library: "${e.id}" invalid plane "${e.plane}".`);
    if (!VALID_LATERALITY.has(e.laterality)) throw new Error(`library: "${e.id}" invalid laterality "${e.laterality}" (bilateral|unilateral).`);
    if (!e.variation_family) throw new Error(`library: "${e.id}" missing variation_family.`);
    if (!e.dose || (isAllDose(e.dose) === false && Object.keys(e.dose).length === 0)) {
      throw new Error(`library: "${e.id}" has no dose.`);
    }
    // Per-tier dose values must be well-typed: sets/rest_sec numeric (0-set allowed), reps
    // number|string. Catches transcription corruption like `rest_sec: "s"` that only "works"
    // via JS coercion and breaks any consumer doing arithmetic on the numbers.
    if (!isAllDose(e.dose)) {
      for (const [tier, d] of Object.entries(e.dose)) {
        if (!d || typeof d.sets !== 'number' || typeof d.rest_sec !== 'number') {
          throw new Error(`library: "${e.id}" dose.${tier} needs numeric sets & rest_sec (got ${JSON.stringify(d)}).`);
        }
        if (typeof d.reps !== 'number' && typeof d.reps !== 'string') {
          throw new Error(`library: "${e.id}" dose.${tier}.reps must be a number or string.`);
        }
      }
    }
    if (!Array.isArray(e.equipment)) throw new Error(`library: "${e.id}" equipment must be an array.`);
  }
  // Progression / regression links must resolve to real ids.
  const byId = new Map(exercises.map((e) => [e.id, e]));
  for (const e of exercises) {
    for (const key of ['progression_to', 'regression_to'] as const) {
      const target = e[key];
      if (target && !ids.has(target)) {
        throw new Error(`library: "${e.id}".${key} → "${target}" does not resolve.`);
      }
    }
  }

  // Progression / regression should stay WITHIN a variation_family. Crossing families
  // silently breaks selectFill's block-stability check (a persisted variant advanced across
  // a family boundary won't be found among the next assembly's pool-selected candidates, so
  // the athlete's earned progression is dropped with no note). Warn loudly rather than throw:
  // the loader hard-fails only on structural breakage (missing ids / bad enums); whether a
  // deliberate cross-family link should ever exist is a coaching decision, not the loader's.
  for (const e of exercises) {
    for (const key of ['progression_to', 'regression_to'] as const) {
      const targetId = e[key];
      if (!targetId) continue;
      const target = byId.get(targetId);
      if (target && target.variation_family !== e.variation_family) {
        console.warn(
          `library WARNING: "${e.id}".${key} → "${targetId}" crosses variation_family ` +
            `(${e.variation_family} → ${target.variation_family}). This will silently break ` +
            `rotation stability in selectFill. Verify this is intentional.`,
        );
      }
    }
  }
}

/** Load the day templates (the sequencing-safe per-day recipes). */
export async function loadDayTemplates(): Promise<DayTemplate[]> {
  if (!existsSync(DAY_TEMPLATES_FILE)) throw new Error(`Day templates not found: ${DAY_TEMPLATES_FILE}`);
  const rows = JSON.parse(await readFile(DAY_TEMPLATES_FILE, 'utf8')) as DayTemplate[];
  if (!Array.isArray(rows)) throw new Error('day-templates.json must be a JSON array.');
  for (const t of rows) {
    if (typeof t.day !== 'number') throw new Error('day-templates.json: each template needs a numeric day.');
    // Validate the enum fields — a typo silently mis-routes: a bad `emphasis` falls through to the
    // CoD funnel, a bad `funnel_mode` is treated as full-length.
    if (t.emphasis !== 'linear-speed' && t.emphasis !== 'change-of-direction') {
      throw new Error(`day-templates.json: day ${t.day} invalid emphasis "${t.emphasis}" (linear-speed|change-of-direction).`);
    }
    if (t.funnel_mode !== 'full' && t.funnel_mode !== 'short') {
      throw new Error(`day-templates.json: day ${t.day} invalid funnel_mode "${t.funnel_mode}" (full|short).`);
    }
    if (!t.slots?.jump || !t.slots?.sprint || !t.slots?.lift) {
      throw new Error(`day-templates.json: day ${t.day} missing jump/sprint/lift slot pools.`);
    }
  }
  return rows;
}

export async function loadDayTemplate(day: number): Promise<DayTemplate> {
  const all = await loadDayTemplates();
  const t = all.find((x) => x.day === day);
  if (!t) throw new Error(`No day template for day ${day} (have: ${all.map((x) => x.day).join(', ')}).`);
  return t;
}

/**
 * Load the tier-scoped workout plans (which days of the split each tier follows). Validated
 * against the day templates so a plan can't reference a day that doesn't exist. Returns [] if
 * the file is absent (plans are optional; callers fall back to the full split).
 */
export async function loadPlans(): Promise<WorkoutPlan[]> {
  if (!existsSync(PLANS_FILE)) return [];
  const rows = JSON.parse(await readFile(PLANS_FILE, 'utf8')) as WorkoutPlan[];
  if (!Array.isArray(rows)) throw new Error('plans.json must be a JSON array.');
  const validDays = new Set((await loadDayTemplates()).map((t) => t.day));
  for (const p of rows) {
    if (!isTier(p.tier)) throw new Error(`plans.json: invalid tier "${p.tier}".`);
    if (!Array.isArray(p.days) || p.days.length === 0) throw new Error(`plans.json: plan ${p.tier} needs a non-empty days array.`);
    for (const d of p.days) {
      if (!validDays.has(d)) throw new Error(`plans.json: plan ${p.tier} references day ${d}, which has no template.`);
    }
  }
  return rows;
}

/** The plan for a tier, or null if none is defined (caller decides the fallback). */
export async function planForTier(tier: Tier): Promise<WorkoutPlan | null> {
  return (await loadPlans()).find((p) => p.tier === tier) ?? null;
}

/** The coach's available equipment (global config). 'none' is always implicitly available. */
export async function loadAvailableEquipment(): Promise<Set<string>> {
  if (!existsSync(EQUIPMENT_CONFIG)) {
    // No config → treat everything as available (v1-safe default).
    return new Set(['*']);
  }
  const cfg = JSON.parse(await readFile(EQUIPMENT_CONFIG, 'utf8')) as { available?: string[] };
  const set = new Set(cfg.available ?? []);
  set.add('none');
  return set;
}

/** Group exercises by variation_family (for rotation). */
export function byFamily(exercises: Exercise[]): Map<string, Exercise[]> {
  const map = new Map<string, Exercise[]>();
  for (const e of exercises) {
    const list = map.get(e.variation_family) ?? [];
    list.push(e);
    map.set(e.variation_family, list);
  }
  return map;
}
