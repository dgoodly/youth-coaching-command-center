/**
 * Session-level workout log — the `WorkoutLogEntry` write path (PHASE_PLAN_workout_logging.md
 * Phase C). One record per (athlete · date · session); the per-SET actuals hang off it by
 * `workoutId` (see store/setlog.ts).
 *
 * Two deliberate semantics:
 *
 *  1. `getOrCreateWorkout` is ATOMIC. Logging the first exercise of a session creates the record;
 *     logging the next FINDS it. The find-or-create is ONE serialized unit (`updateCollection` →
 *     the in-process write mutex), not a read followed by a separate append — so two concurrent
 *     logs against the same session can't both decide "no record yet" and create a duplicate. The
 *     second caller sees the first's row.
 *
 *  2. `completed` means the coach EXPLICITLY marked the session done — never a side effect of
 *     logging. Creation is always `completed: false`; "has data / in progress" is derived from the
 *     presence of set-log rows, not from this flag. That keeps a half-logged session from silently
 *     reading as complete.
 */

import { randomUUID } from 'node:crypto';

import type { Tier, WorkoutLogEntry } from '../engine/types.ts';
import type { RecordStore } from './record-store.ts';

/** Identity of a session record: an athlete's dated run of one day's session. */
export interface WorkoutKey {
  athleteId: string;
  date: string; // ISO date the session was performed
  sessionLabel: string; // stable per day, e.g. "Day 1"
}

/**
 * Find the session record for `key`, or create one (`completed: false`). Atomic: the find and the
 * create happen inside a single serialized read-modify-write, so concurrent first-logs of the same
 * session converge on ONE record instead of racing to create two.
 */
export async function getOrCreateWorkout(
  store: RecordStore,
  key: WorkoutKey,
  servedForTier: Tier,
): Promise<WorkoutLogEntry> {
  let result: WorkoutLogEntry | undefined;
  await store.update('workout_log', (all) => {
    const existing = all.find(
      (w) => w.athleteId === key.athleteId && w.date === key.date && w.sessionLabel === key.sessionLabel,
    );
    if (existing) {
      result = existing;
      return all; // unchanged
    }
    result = {
      workoutId: randomUUID(),
      athleteId: key.athleteId,
      date: key.date,
      servedForTier,
      sessionLabel: key.sessionLabel,
      completed: false, // never set by logging — only by an explicit coach action (see below)
      coachNotes: '',
    };
    return [...all, result];
  });
  return result!;
}

/**
 * Set a session's `completed` flag — the coach's explicit "this session is done" (or a reopen).
 * Returns the updated record, or `null` if no session has that id. Atomic.
 */
export async function setWorkoutCompleted(
  store: RecordStore,
  workoutId: string,
  completed: boolean,
): Promise<WorkoutLogEntry | null> {
  let found: WorkoutLogEntry | null = null;
  await store.update('workout_log', (all) =>
    all.map((w) => {
      if (w.workoutId !== workoutId) return w;
      found = { ...w, completed };
      return found;
    }),
  );
  return found;
}
