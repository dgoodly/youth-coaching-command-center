/**
 * Read-side queries over the JSON store — shared by the CLIs and the dashboard.
 * Pure-ish: reads data, no mutation. Tier/score values here are COACH-ONLY (§3.3).
 */

import type {
  Assessment, AthleteProfile, HeightLogEntry, SetLogEntry, WellnessLogEntry, WorkoutLogEntry, BlockState, Tier,
} from '../engine/types.ts';
import type { RecordStore } from './record-store.ts';
import { splitDays, nextDayInSplit } from './blocks.ts';

/** All assessments for an athlete, oldest → newest. */
export async function assessmentsFor(store: RecordStore, athleteId: string): Promise<Assessment[]> {
  const all = await store.read('assessments');
  return all
    .filter((a) => a.athleteId === athleteId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The most recent assessment for an athlete, or null. */
export async function latestAssessment(store: RecordStore, athleteId: string): Promise<Assessment | null> {
  const list = await assessmentsFor(store, athleteId);
  return list.length ? list[list.length - 1]! : null;
}

/** The athlete's current routing tier (latest assessment's finalTier), or null if unassessed. */
export async function currentTier(store: RecordStore, athleteId: string): Promise<Tier | null> {
  const latest = await latestAssessment(store, athleteId);
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
export async function resolveAthlete(store: RecordStore, idOrName: string): Promise<AthleteResolution> {
  return resolveAthleteIn(await store.read('athletes'), idOrName);
}

/** Height log for an athlete, oldest → newest. */
export async function heightLogFor(store: RecordStore, athleteId: string): Promise<HeightLogEntry[]> {
  const all = await store.read('height_log');
  return all.filter((h) => h.athleteId === athleteId).sort((a, b) => a.date.localeCompare(b.date));
}

/** Workout log for an athlete, newest → oldest. */
export async function workoutLogFor(store: RecordStore, athleteId: string): Promise<WorkoutLogEntry[]> {
  const all = await store.read('workout_log');
  return all.filter((w) => w.athleteId === athleteId).sort((a, b) => b.date.localeCompare(a.date));
}

/** Wellness log for an athlete, newest → oldest. */
export async function wellnessLogFor(store: RecordStore, athleteId: string): Promise<WellnessLogEntry[]> {
  const all = await store.read('wellness_log');
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

/** All logged sets for an athlete, oldest → newest (chronological). Indexed — never a full scan. */
export async function setLogFor(store: RecordStore, athleteId: string): Promise<SetLogEntry[]> {
  return (await store.queryBy('set_log', 'athleteId', athleteId)).sort(bySetChronology);
}

/**
 * An athlete's logged sets for ONE exercise, oldest → newest — the input to per-exercise trends
 * and PRs (Phase D).
 */
export async function setLogForExercise(
  store: RecordStore,
  athleteId: string,
  exerciseId: string,
): Promise<SetLogEntry[]> {
  return (await setLogFor(store, athleteId)).filter((s) => s.exerciseId === exerciseId);
}

/**
 * All sets logged in one session (workout), grouped by exercise id — how the session review /
 * "what did we actually do today" surface reads the log back. Indexed — never a full scan.
 */
export async function setLogForWorkout(store: RecordStore, workoutId: string): Promise<Map<string, SetLogEntry[]>> {
  const sets = (await store.queryBy('set_log', 'workoutId', workoutId)).sort(bySetChronology);
  return groupSetsByExercise(sets);
}

/** Current block state for an athlete, or null. */
export async function blockStateFor(store: RecordStore, athleteId: string): Promise<BlockState | null> {
  const all = await store.read('block_state');
  return all.find((b) => b.athleteId === athleteId) ?? null;
}

/** All athletes. */
export async function allAthletes(store: RecordStore): Promise<AthleteProfile[]> {
  return store.read('athletes');
}

// ---------------------------------------------------------------------------
// Track-workout default-day resolution (PHASE_PLAN_track_workout_screen.md Step 3)
// ---------------------------------------------------------------------------

/** A prior session reduced to what next-day resolution needs: its day, and whether it's still open. */
export interface TrackSession {
  day: number;
  /** Has logged sets but not the coach's explicit "done" — a workout you haven't finished. */
  inProgress: boolean;
}

/** Parse a `WorkoutLogEntry.sessionLabel` ("Day 3") back to its day number, or null if unlabelled. */
export function parseDayLabel(label: string): number | null {
  const m = /\bDay\s+(\d+)/i.exec(label);
  return m ? Number(m[1]) : null;
}

/**
 * Which day the Track-workout screen should default to (Step 3). `sessions` are the athlete's REAL
 * (set-bearing) sessions, most-recent first. Decisions key off the SINGLE most-recent session:
 *  - it's still in progress → open THAT day; you don't skip a workout you haven't finished. (An
 *    older, abandoned in-progress session doesn't pull you back — a later completed session wins.)
 *  - otherwise → advance to the next day after it, wrapping / clamping via {@link nextDayInSplit}.
 *  - no prior sessions at all → the first day of the split (Day 1).
 * A day that fell out of the current split (split changed under an in-progress session) is clamped
 * forward too, so we never open a day the athlete no longer runs. PURE — caller supplies the
 * already-filtered (set-bearing), already-ordered sessions, which is what keeps a merely-opened,
 * never-logged screen from ever moving the default (honest-log invariant, at session level).
 */
export function resolveTrackDay(days: number[], sessions: readonly TrackSession[]): number {
  const firstDay = days[0] ?? 1;
  const mostRecent = sessions[0];
  if (!mostRecent) return firstDay;
  if (mostRecent.inProgress) {
    return days.includes(mostRecent.day) ? mostRecent.day : nextDayInSplit(mostRecent.day, days);
  }
  return nextDayInSplit(mostRecent.day, days);
}

/**
 * Resolve the Track-workout default day for an athlete (async orchestration over the pure
 * {@link resolveTrackDay}). Reads ONLY set-bearing sessions, ordered by their most recent set's
 * timestamp — the datetime tie-break the day-granular `date` alone can't give when two sessions
 * share a calendar day. A screen that was opened but never logged has no sets, so it can't exist
 * here and can't advance the default.
 */
export async function nextTrackDay(store: RecordStore, athleteId: string): Promise<number> {
  const [block, workouts, sets] = await Promise.all([
    blockStateFor(store, athleteId), workoutLogFor(store, athleteId), setLogFor(store, athleteId),
  ]);
  const days = splitDays(block);

  // Per-session set presence + the latest set time within it (the ordering key).
  const setCount = new Map<string, number>();
  const lastSetAt = new Map<string, string>();
  for (const s of sets) {
    setCount.set(s.workoutId, (setCount.get(s.workoutId) ?? 0) + 1);
    const prev = lastSetAt.get(s.workoutId);
    if (!prev || s.loggedAt > prev) lastSetAt.set(s.workoutId, s.loggedAt);
  }

  const sessions: TrackSession[] = workouts
    .filter((w) => (setCount.get(w.workoutId) ?? 0) > 0) // real sessions only — the invariant
    .map((w) => ({ day: parseDayLabel(w.sessionLabel), inProgress: !w.completed, at: lastSetAt.get(w.workoutId)! }))
    .filter((w): w is { day: number; inProgress: boolean; at: string } => w.day !== null)
    .sort((a, b) => b.at.localeCompare(a.at)) // most-recent set first
    .map((w) => ({ day: w.day, inProgress: w.inProgress }));

  return resolveTrackDay(days, sessions);
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
