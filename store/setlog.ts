/**
 * Set-log write path — persists per-set workout actuals (PHASE_PLAN_workout_logging.md Phase B).
 *
 * The set-log is browser-sourced (the logging form) and unbounded — every athlete × session ×
 * exercise × set — so all writes go through the same in-process serialization the rest of the
 * write surface uses (`appendAll` → `runExclusive`); two overlapping logs can't drop a set. A
 * full exercise's sets are written as ONE unit so they land together (or the crash window is the
 * tiny gap between renames, never a torn read-modify-write).
 *
 * Persistence only — building entries from form input + validating values lives with the caller
 * (the Phase C form), mirroring how ingest.ts builds+validates before saveAssessment persists.
 */

import { randomUUID } from 'node:crypto';

import type { PrescribedSnapshot, SetLogEntry } from '../engine/types.ts';
import { appendAll, updateCollection, type PendingAppend } from './json-store.ts';

/** Fields a caller supplies for one set; `setLogId`/`loggedAt` are filled if omitted. */
export type NewSetLog = Omit<SetLogEntry, 'setLogId' | 'loggedAt'> &
  Partial<Pick<SetLogEntry, 'setLogId' | 'loggedAt'>>;

/** Fill a partial set record into a complete {@link SetLogEntry} (id + timestamp). Pure. */
export function toSetLogEntry(input: NewSetLog, now: Date = new Date()): SetLogEntry {
  return {
    setLogId: input.setLogId ?? randomUUID(),
    workoutId: input.workoutId,
    athleteId: input.athleteId,
    exerciseId: input.exerciseId,
    setIndex: input.setIndex,
    values: input.values,
    ...(input.prescribed ? { prescribed: input.prescribed } : {}),
    ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
    ...(input.note ? { note: input.note } : {}),
    loggedAt: input.loggedAt ?? now.toISOString(),
  };
}

/**
 * Persist a batch of sets (typically all sets of one exercise) as one serialized unit. Returns
 * the stored entries (with generated ids/timestamps). An empty batch is a no-op.
 */
export async function saveSetLog(inputs: readonly NewSetLog[]): Promise<SetLogEntry[]> {
  if (inputs.length === 0) return [];
  const entries = inputs.map((i) => toSetLogEntry(i));
  const appends: PendingAppend[] = entries.map((record) => ({ collection: 'set_log', record }));
  await appendAll(appends);
  return entries;
}

/** The logical identity of one set within a session: which session, which movement, which set. */
export interface SetKey {
  workoutId: string;
  exerciseId: string;
  setIndex: number;
}

/**
 * Create-or-REPLACE one set by its (workoutId, exerciseId, setIndex) identity — the save-as-you-go
 * write the Track-workout screen uses (PHASE_PLAN_track_workout_screen.md Step 5). Unlike the
 * append-only {@link saveSetLog}, re-saving a set the coach already logged (they fixed a weight, or
 * blurred the same row twice) REPLACES it rather than appending a duplicate — otherwise every
 * re-save would inflate the set count and silently corrupt the PR/trend math, which walks every
 * stored set. On create, id + `loggedAt` are generated; on replace, the original `setLogId` AND
 * `loggedAt` are preserved, so correcting a number never moves the set's place in history. Atomic:
 * the find + write is one serialized read-modify-write (`updateCollection` → the in-process mutex).
 */
export async function upsertSet(input: NewSetLog): Promise<SetLogEntry> {
  let result!: SetLogEntry;
  await updateCollection('set_log', (all) => {
    const idx = all.findIndex(
      (s) => s.workoutId === input.workoutId && s.exerciseId === input.exerciseId && s.setIndex === input.setIndex,
    );
    if (idx === -1) {
      result = toSetLogEntry(input);
      return [...all, result];
    }
    const existing = all[idx]!;
    // Preserve identity + original timestamp; replace the actuals/prescription/note.
    result = toSetLogEntry({ ...input, setLogId: existing.setLogId, loggedAt: existing.loggedAt });
    const next = all.slice();
    next[idx] = result;
    return next;
  });
  return result;
}

/**
 * Remove one set by identity — the coach cut a set the athlete didn't do. Idempotent: removing a
 * set that was never logged (an untouched pre-filled row) is a no-op, which is exactly the
 * honest-log rule — nothing is written for a row the coach never confirmed. Atomic.
 */
export async function removeSet(key: SetKey): Promise<void> {
  await updateCollection('set_log', (all) =>
    all.filter(
      (s) => !(s.workoutId === key.workoutId && s.exerciseId === key.exerciseId && s.setIndex === key.setIndex),
    ),
  );
}

export type { PrescribedSnapshot };
