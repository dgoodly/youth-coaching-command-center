/**
 * Athlete roster helpers — create/find profile records (spec §8 AthleteProfile).
 * Profiles hold the two-axis CONTEXT that is not part of the scored battery:
 * DOB (age), sports, and training-months (spec §6 tie-breaker / dose input).
 */

import { randomUUID } from 'node:crypto';

import type { AthleteProfile } from '../engine/types.ts';
import { append, readCollection } from './json-store.ts';

export async function listAthletes(): Promise<AthleteProfile[]> {
  return readCollection('athletes');
}

export async function findAthlete(athleteId: string): Promise<AthleteProfile | undefined> {
  const all = await readCollection('athletes');
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
  await append('athletes', profile);
  return profile;
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
