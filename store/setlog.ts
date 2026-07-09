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
import { appendAll, type PendingAppend } from './json-store.ts';

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

export type { PrescribedSnapshot };
