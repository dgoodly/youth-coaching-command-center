/**
 * Read-side queries over the JSON store — shared by the CLIs and the dashboard.
 * Pure-ish: reads data, no mutation. Tier/score values here are COACH-ONLY (§3.3).
 */

import type {
  Assessment, AthleteProfile, HeightLogEntry, SetLogEntry, WellnessLogEntry, WorkoutLogEntry, BlockState, Tier,
} from '../engine/types.ts';
import { readCollection } from './json-store.ts';

/** All assessments for an athlete, oldest → newest. */
export async function assessmentsFor(athleteId: string): Promise<Assessment[]> {
  const all = await readCollection('assessments');
  return all
    .filter((a) => a.athleteId === athleteId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The most recent assessment for an athlete, or null. */
export async function latestAssessment(athleteId: string): Promise<Assessment | null> {
  const list = await assessmentsFor(athleteId);
  return list.length ? list[list.length - 1]! : null;
}

/** The athlete's current routing tier (latest assessment's finalTier), or null if unassessed. */
export async function currentTier(athleteId: string): Promise<Tier | null> {
  const latest = await latestAssessment(athleteId);
  return latest ? latest.finalTier : null;
}

/**
 * Result of resolving an id-or-name to an athlete. `ambiguous` is kept DISTINCT from
 * `not_found` so the caller can tell the coach *which* athletes clashed (duplicate first names
 * are likely on a youth roster) instead of a useless "no unique match".
 */
export type AthleteResolution =
  | { status: 'found'; athlete: AthleteProfile }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: AthleteProfile[] };

/**
 * Resolve an id-or-name against a known athlete list (PURE, for testability). Tries exact id,
 * then exact case-insensitive name, then substring name; a name step matching more than one
 * athlete is `ambiguous` rather than silently dropped.
 */
export function resolveAthleteIn(all: AthleteProfile[], idOrName: string): AthleteResolution {
  const byId = all.find((a) => a.athleteId === idOrName);
  if (byId) return { status: 'found', athlete: byId };
  const needle = idOrName.trim().toLowerCase();
  const byName = all.filter((a) => a.displayName.toLowerCase() === needle);
  if (byName.length === 1) return { status: 'found', athlete: byName[0]! };
  if (byName.length > 1) return { status: 'ambiguous', candidates: byName };
  const partial = all.filter((a) => a.displayName.toLowerCase().includes(needle));
  if (partial.length === 1) return { status: 'found', athlete: partial[0]! };
  if (partial.length > 1) return { status: 'ambiguous', candidates: partial };
  return { status: 'not_found' };
}

/** Find an athlete by id or a case-insensitive display-name match (reads the store). */
export async function resolveAthlete(idOrName: string): Promise<AthleteResolution> {
  return resolveAthleteIn(await readCollection('athletes'), idOrName);
}

/** Height log for an athlete, oldest → newest. */
export async function heightLogFor(athleteId: string): Promise<HeightLogEntry[]> {
  const all = await readCollection('height_log');
  return all.filter((h) => h.athleteId === athleteId).sort((a, b) => a.date.localeCompare(b.date));
}

/** Workout log for an athlete, newest → oldest. */
export async function workoutLogFor(athleteId: string): Promise<WorkoutLogEntry[]> {
  const all = await readCollection('workout_log');
  return all.filter((w) => w.athleteId === athleteId).sort((a, b) => b.date.localeCompare(a.date));
}

/** Wellness log for an athlete, newest → oldest. */
export async function wellnessLogFor(athleteId: string): Promise<WellnessLogEntry[]> {
  const all = await readCollection('wellness_log');
  return all.filter((w) => w.athleteId === athleteId).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Chronological comparator for set records: oldest → newest by `loggedAt`, then by `setIndex`
 * so sets within one session stay in the order they were performed (set 1 before set 2). This is
 * the order PR/trend math (Phase D) walks.
 */
function bySetChronology(a: SetLogEntry, b: SetLogEntry): number {
  return a.loggedAt.localeCompare(b.loggedAt) || a.setIndex - b.setIndex;
}

/** Group set records by `exerciseId` (pure), preserving first-seen order and per-set order within. */
export function groupSetsByExercise(sets: SetLogEntry[]): Map<string, SetLogEntry[]> {
  const map = new Map<string, SetLogEntry[]>();
  for (const s of sets) {
    const list = map.get(s.exerciseId);
    if (list) list.push(s);
    else map.set(s.exerciseId, [s]);
  }
  return map;
}

/** All logged sets for an athlete, oldest → newest (chronological). */
export async function setLogFor(athleteId: string): Promise<SetLogEntry[]> {
  const all = await readCollection('set_log');
  return all.filter((s) => s.athleteId === athleteId).sort(bySetChronology);
}

/**
 * An athlete's logged sets for ONE exercise, oldest → newest — the input to per-exercise trends
 * and PRs (Phase D).
 */
export async function setLogForExercise(athleteId: string, exerciseId: string): Promise<SetLogEntry[]> {
  return (await setLogFor(athleteId)).filter((s) => s.exerciseId === exerciseId);
}

/**
 * All sets logged in one session (workout), grouped by exercise id — how the session review /
 * "what did we actually do today" surface reads the log back.
 */
export async function setLogForWorkout(workoutId: string): Promise<Map<string, SetLogEntry[]>> {
  const all = await readCollection('set_log');
  const sets = all.filter((s) => s.workoutId === workoutId).sort(bySetChronology);
  return groupSetsByExercise(sets);
}

/** Current block state for an athlete, or null. */
export async function blockStateFor(athleteId: string): Promise<BlockState | null> {
  const all = await readCollection('block_state');
  return all.find((b) => b.athleteId === athleteId) ?? null;
}

/** All athletes. */
export async function allAthletes(): Promise<AthleteProfile[]> {
  return readCollection('athletes');
}

/** Days since an ISO date. */
export function daysSince(isoDate: string, now: Date = new Date()): number {
  const then = new Date(isoDate + 'T00:00:00Z').getTime();
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/** Due for re-assessment? Spec §6: every 4–6 weeks. Flags at >= 6 weeks (42 days). */
export function dueForReassessment(lastDate: string, now: Date = new Date()): boolean {
  return daysSince(lastDate, now) >= 42;
}
