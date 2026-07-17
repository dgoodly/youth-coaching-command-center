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
import type { PendingAppend, RecordStore } from './record-store.ts';

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
export async function saveSetLog(store: RecordStore, inputs: readonly NewSetLog[]): Promise<SetLogEntry[]> {
  if (inputs.length === 0) return [];
  const entries = inputs.map((i) => toSetLogEntry(i));
  const appends: PendingAppend[] = entries.map((record) => ({ collection: 'set_log', record }));
  await store.appendAll(appends);
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
 * one per-record read-modify-write (`store.updateRecord`) keyed on the set's identity — the
 * autosave path never materializes the rest of the set log.
 */
export async function upsertSet(store: RecordStore, input: NewSetLog): Promise<SetLogEntry> {
  const result = await store.updateRecord(
    'set_log',
    [input.workoutId, input.exerciseId, input.setIndex],
    (existing) =>
      existing
        ? // Preserve identity + original timestamp; replace the actuals/prescription/note.
          toSetLogEntry({ ...input, setLogId: existing.setLogId, loggedAt: existing.loggedAt })
        : toSetLogEntry(input),
  );
  return result!; // mutate never returns null, so neither does updateRecord
}

/**
 * Remove one set by identity — the coach cut a set the athlete didn't do. Idempotent: removing a
 * set that was never logged (an untouched pre-filled row) is a no-op, which is exactly the
 * honest-log rule — nothing is written for a row the coach never confirmed. Atomic.
 */
export async function removeSet(store: RecordStore, key: SetKey): Promise<void> {
  await store.remove('set_log', [key.workoutId, key.exerciseId, key.setIndex]);
}

export type { PrescribedSnapshot };
