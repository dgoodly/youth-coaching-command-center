/**
 * Weekly wellness check CLI (disposable surface) — COACHING_INSTRUCTIONS "MATURITY MONITORING".
 *
 *   npm run wellness                       (interactive: pick athlete, enter the check)
 *   npm run wellness -- --json path.json   (batch: a WellnessLogEntry, athleteId or displayName)
 *
 * A brief self-report to watch load and growth-related niggles (Osgood-Schlatter / Sever's cluster
 * around PHV). All fields optional — a check can be as quick as one soreness number.
 */

import { stdout, argv } from 'node:process';
import { readFile } from 'node:fs/promises';

import type { WellnessLogEntry } from '../engine/types.ts';
import { append } from '../store/json-store.ts';
import { listAthletes, ageFromDob } from '../store/athletes.ts';
import { resolveAthleteIn } from '../store/query.ts';
import { makeRl, ask, askOptionalNumber } from './prompt.ts';

const line = (s = ''): void => void stdout.write(s + '\n');
const todayIso = (): string => new Date().toISOString().slice(0, 10);

async function saveEntry(entry: WellnessLogEntry): Promise<void> {
  await append('wellness_log', entry);
  line(`\n✓ Wellness check saved for ${entry.athleteId} on ${entry.date}.`);
}

async function runBatch(jsonPath: string): Promise<void> {
  const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as WellnessLogEntry & { displayName?: string };
  const athletes = await listAthletes();
  let athleteId = parsed.athleteId;
  if (!athleteId || !athletes.some((a) => a.athleteId === athleteId)) {
    const needle = parsed.displayName ?? athleteId ?? '';
    const res = resolveAthleteIn(athletes, needle);
    if (res.status !== 'found') {
      line(`Could not resolve athlete "${needle}" (${res.status}).`);
      process.exitCode = 1;
      return;
    }
    athleteId = res.athlete.athleteId;
  }
  await saveEntry({
    athleteId,
    date: parsed.date ?? todayIso(),
    sleepHours: parsed.sleepHours ?? null,
    soreness: parsed.soreness ?? null,
    energy: parsed.energy ?? null,
    notes: parsed.notes ?? '',
  });
}

async function main(): Promise<void> {
  const rl = makeRl();
  try {
    line('\n=== Weekly wellness check ===\n');
    const athletes = await listAthletes();
    if (athletes.length === 0) return void line('No athletes yet — add one with `npm run enter`.');

    athletes.forEach((a, i) => {
      const age = ageFromDob(a.dob);
      line(`  ${i + 1}. ${a.displayName}${age !== null ? ` (age ${age})` : ''}`);
    });
    const pick = Number(await ask(rl, 'Select #'));
    const athlete = athletes[pick - 1];
    if (!athlete) return void line('No such athlete.');

    const date = await ask(rl, 'Date (YYYY-MM-DD)', todayIso());
    const sleepHours = await askOptionalNumber(rl, 'Sleep hours last night');
    const soreness = await askOptionalNumber(rl, 'Soreness 1 (fresh) – 5 (very sore)');
    const energy = await askOptionalNumber(rl, 'Energy 1 (flat) – 5 (great)');
    const notes = await ask(rl, 'Notes (niggles, knee/heel soreness, mood)', '');

    await saveEntry({ athleteId: athlete.athleteId, date, sleepHours, soreness, energy, notes });
  } finally {
    rl.close();
  }
}

const jsonFlagIdx = argv.indexOf('--json');
if (jsonFlagIdx !== -1) {
  const path = argv[jsonFlagIdx + 1];
  if (!path) {
    line('Usage: npm run wellness -- --json <path>');
    process.exitCode = 1;
  } else {
    await runBatch(path);
  }
} else {
  await main();
}
