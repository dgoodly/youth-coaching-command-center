/**
 * Athlete roster helpers — create/find profile records (spec §8 AthleteProfile).
 * Profiles hold the two-axis CONTEXT that is not part of the scored battery:
 * DOB (age), sports, and training-months (spec §6 tie-breaker / dose input).
 */

import { randomUUID } from 'node:crypto';

import type { AthleteProfile } from '../engine/types.ts';
import type { RecordStore } from './record-store.ts';

export async function listAthletes(store: RecordStore): Promise<AthleteProfile[]> {
  return store.read('athletes');
}

export async function findAthlete(store: RecordStore, athleteId: string): Promise<AthleteProfile | undefined> {
  const all = await store.read('athletes');
  return all.find((a) => a.athleteId === athleteId);
}

export interface NewAthleteInput {
  displayName: string;
  dob?: string | null;
  sex?: 'M' | 'F' | null;
  sports?: string[];
  trainingMonths?: number;
  valgusWatch?: boolean;
  weeklySportHours?: number | null;
  weeklyTrainingHours?: number | null;
  restDaysPerWeek?: number | null;
  notes?: string;
}

export async function createAthlete(
  store: RecordStore,
  input: NewAthleteInput,
  now: Date = new Date(),
): Promise<AthleteProfile> {
  const profile: AthleteProfile = {
    athleteId: randomUUID(),
    displayName: input.displayName.trim(),
    dob: input.dob ?? null,
    sex: input.sex ?? null,
    sports: input.sports ?? [],
    trainingMonths: input.trainingMonths ?? 0,
    valgusWatch: input.valgusWatch ?? false,
    weeklySportHours: input.weeklySportHours ?? null,
    weeklyTrainingHours: input.weeklyTrainingHours ?? null,
    restDaysPerWeek: input.restDaysPerWeek ?? null,
    createdAt: now.toISOString(),
    notes: input.notes ?? '',
  };
  await store.append('athletes', profile);
  return profile;
}

/** The mutable profile fields an edit can set (everything except id + createdAt). */
export type AthleteEdits = NewAthleteInput;

/**
 * Update an existing athlete's editable fields in place, preserving `athleteId` and `createdAt`.
 * Returns the updated profile, or null if no athlete has that id. Goes through the serialized
 * store write (`store.update`), so it can't interleave with a concurrent mutation.
 */
export async function updateAthlete(
  store: RecordStore,
  athleteId: string,
  edits: AthleteEdits,
): Promise<AthleteProfile | null> {
  let updated: AthleteProfile | null = null;
  await store.update('athletes', (all) => {
    const idx = all.findIndex((a) => a.athleteId === athleteId);
    if (idx < 0) return all; // no such athlete — leave the collection untouched
    updated = {
      ...all[idx]!,
      displayName: edits.displayName.trim(),
      dob: edits.dob ?? null,
      sex: edits.sex ?? null,
      sports: edits.sports ?? [],
      trainingMonths: edits.trainingMonths ?? 0,
      valgusWatch: edits.valgusWatch ?? false,
      weeklySportHours: edits.weeklySportHours ?? null,
      weeklyTrainingHours: edits.weeklyTrainingHours ?? null,
      restDaysPerWeek: edits.restDaysPerWeek ?? null,
      notes: edits.notes ?? '',
    };
    all[idx] = updated;
    return all;
  });
  return updated;
}

/** Whole-year age from DOB on a given date, or null if no DOB (contract: derivable from DOB). */
export function ageFromDob(dob: string | null, on: Date = new Date()): number | null {
  if (!dob) return null;
  const b = new Date(dob + 'T00:00:00Z');
  let age = on.getUTCFullYear() - b.getUTCFullYear();
  const m = on.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
