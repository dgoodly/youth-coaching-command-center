/**
 * Data-entry CLI — transcribe a completed paper field form into a stored assessment.
 *
 * Interactive:   `npm run enter`
 * Batch (JSON):  `npm run enter -- --json path/to/form.json`
 *
 * Order of operations matters for clean validation data (BUILD_BRIEF §3.7 / contract
 * §"Coach gut-call"): in the interactive flow the coach's GUT-CALL tier is captured BEFORE
 * the calculated tier is revealed. (In batch mode the form already records it.)
 *
 * The batch JSON shape is exactly `FieldFormInput` from store/ingest.ts, with one extra
 * key — `displayName` (optional) — used only when creating a brand-new athlete by name.
 *
 * This is disposable surface; the durable logic lives in store/ingest.ts (tested).
 */

import { stdout, argv } from 'node:process';
import { readFile } from 'node:fs/promises';

import { SCORE_KEYS, type Scores, type Tier } from '../engine/types.ts';
import { TIER_STAGE } from '../engine/types.ts';
import {
  buildAssessmentRecord,
  saveAssessment,
  nextAssessmentDate,
  type FieldFormInput,
} from '../store/ingest.ts';
import { listAthletes, createAthlete, ageFromDob } from '../store/athletes.ts';
import {
  makeRl,
  ask,
  askScore,
  askTier,
  askYesNo,
  askOptionalNumber,
} from './prompt.ts';

const SCORE_LABELS: Record<keyof Scores, string> = {
  squat: 'Test 1 — Bodyweight Squat',
  dropStick: 'Test 2 — Drop-and-Stick Landing  (gate-critical)',
  balance: 'Test 3 — Single-Leg Balance  (weaker leg)',
  pushup: 'Test 4 — Push-Ups',
  broad: 'Test 5 — Broad Jump (rel. to height)',
  pogo: 'Test 6 — Continuous Pogo Hops',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function line(s = ''): void {
  stdout.write(s + '\n');
}

async function main(): Promise<void> {
  const rl = makeRl();
  try {
    line('\n=== Enter Assessment (from paper field form) ===\n');

    // --- 1. Select or create athlete ---
    const athletes = await listAthletes();
    let athleteId: string;
    let athleteName: string;
    let dob: string | null = null;

    if (athletes.length > 0) {
      line('Existing athletes:');
      athletes.forEach((a, i) => {
        const age = ageFromDob(a.dob);
        line(`  ${i + 1}. ${a.displayName}${age !== null ? ` (age ${age})` : ''}`);
      });
      line(`  ${athletes.length + 1}. + New athlete`);
      const pick = Number(await ask(rl, 'Select #', String(athletes.length + 1)));
      if (Number.isInteger(pick) && pick >= 1 && pick <= athletes.length) {
        const chosen = athletes[pick - 1]!;
        athleteId = chosen.athleteId;
        athleteName = chosen.displayName;
        dob = chosen.dob;
      } else {
        ({ athleteId, athleteName, dob } = await newAthlete(rl));
      }
    } else {
      line('No athletes yet — creating the first one.');
      ({ athleteId, athleteName, dob } = await newAthlete(rl));
    }

    line(`\nAthlete: ${athleteName}\n`);

    // --- 2. Session header (contract page-1) ---
    const date = await ask(rl, 'Assessment date (YYYY-MM-DD)', todayIso());
    const tester = await ask(rl, 'Tester (parent/guardian)', 'Parent');
    const heightCm = await askOptionalNumber(rl, 'Standing height (cm)');
    const sittingHeightCm = await askOptionalNumber(rl, 'Sitting height (cm, optional — for the maturity estimate)');

    // --- 3. The six scores (fixed spec order) ---
    line('\n--- Scores (0–3 each, from the paper form) ---');
    const partial: Partial<Scores> = {};
    for (const key of SCORE_KEYS) {
      partial[key] = await askScore(rl, SCORE_LABELS[key]);
    }
    const scores = partial as Scores;

    // CAP RULE flag for Test 5 (re-validated in ingest).
    const broadLandingFailed = await askYesNo(
      rl,
      'Was the broad-jump landing uncontrolled / knees caved? (caps Test 5 at 1)',
      false,
    );

    // --- 4. Optional paper-written cross-check values (contract rule 2) ---
    line('\n--- Optional: what was written on paper (cross-check; blank to skip) ---');
    const paperRaw = await askOptionalNumber(rl, 'Paper RAW total');
    const paperFinal = await askTier(rl, 'Paper FINAL tier', true);

    // --- 5. COACH GUT-CALL — captured BEFORE the reveal (§3.7) ---
    line('\n--- Coach gut-call (enter BEFORE seeing the calculated tier) ---');
    const coachGutCall: Tier | null = await askTier(
      rl,
      'Your independent gut-call tier',
      true,
    );

    // --- 6. Notes ---
    const notes = await ask(rl, 'Notes (optional)', '');

    // --- 7. Build, reveal, save ---
    const input: FieldFormInput = {
      athleteId,
      date,
      tester,
      scores,
      broadLandingFailed,
      coachGutCall,
      heightCm,
      sittingHeightCm,
      notes,
      ...(paperRaw !== null || paperFinal !== null
        ? { paper: { ...(paperRaw !== null ? { rawTotal: paperRaw } : {}), ...(paperFinal !== null ? { finalTier: paperFinal } : {}) } }
        : {}),
    };

    const built = buildAssessmentRecord(input);
    const a = built.assessment;

    line('\n========== CALCULATED RESULT ==========');
    line(`  RAW total : ${a.rawTotal} / 18`);
    line(`  Base tier : ${a.baseTier}  (${TIER_STAGE[a.baseTier]})`);
    line(`  FINAL tier: ${a.finalTier}  (${TIER_STAGE[a.finalTier]})   ← routes the workout`);
    line(`  Gate fired: ${a.gateFired}`);
    if (coachGutCall) {
      const match = coachGutCall === a.finalTier;
      line(`  Gut-call  : ${coachGutCall}  ${match ? '✓ matches' : '✗ DIFFERS — validation signal'}`);
    }
    for (const w of built.warnings) line(`  ⚠ ${w}`);
    line('=======================================\n');

    const confirm = await askYesNo(rl, 'Save this assessment?', true);
    if (!confirm) {
      line('Discarded. Nothing written.');
      return;
    }

    await saveAssessment(built);
    line(`\n✓ Saved. Re-assess around ${nextAssessmentDate(date)} (spec §6: 4–6 weeks).`);
    if (built.heightEntry) line(`✓ Height ${built.heightEntry.heightCm} cm logged to the maturity height-log.`);
    line(`\nReminder (§3.3): tier and scores are coach-only — never shown to the athlete/parent.\n`);
  } finally {
    rl.close();
  }
}

/**
 * Batch ingest from a JSON file (non-interactive). The JSON is a `FieldFormInput`, plus an
 * optional `displayName` used only to create a new athlete when `athleteId` is absent/unknown.
 */
async function runBatch(jsonPath: string): Promise<void> {
  const raw = await readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(raw) as FieldFormInput & {
    displayName?: string; valgusWatch?: boolean; sex?: 'M' | 'F' | null; dob?: string | null;
    weeklySportHours?: number | null; weeklyTrainingHours?: number | null; restDaysPerWeek?: number | null;
  };

  // Resolve / create the athlete.
  let athleteId = parsed.athleteId;
  const athletes = await listAthletes();
  if (!athleteId || !athletes.some((a) => a.athleteId === athleteId)) {
    const name = parsed.displayName ?? athleteId ?? 'Unnamed athlete';
    const created = await createAthlete({
      displayName: name, valgusWatch: parsed.valgusWatch, sex: parsed.sex ?? null, dob: parsed.dob ?? null,
      weeklySportHours: parsed.weeklySportHours ?? null,
      weeklyTrainingHours: parsed.weeklyTrainingHours ?? null,
      restDaysPerWeek: parsed.restDaysPerWeek ?? null,
    });
    athleteId = created.athleteId;
    line(`Created athlete "${created.displayName}" (${athleteId}).`);
  }

  const input: FieldFormInput = { ...parsed, athleteId };
  const built = buildAssessmentRecord(input);
  await saveAssessment(built);

  const a = built.assessment;
  line(`Saved assessment ${a.assessmentId}:`);
  line(`  RAW ${a.rawTotal}/18 · base ${a.baseTier} · FINAL ${a.finalTier} · gate ${a.gateFired}` +
    (a.coachGutCall ? ` · gut-call ${a.coachGutCall}${a.coachGutCall === a.finalTier ? ' (match)' : ' (DIFFERS)'}` : ''));
  for (const w of built.warnings) line(`  ⚠ ${w}`);
  line(`  Re-assess ~${nextAssessmentDate(a.date)} (spec §6).`);
}

async function newAthlete(
  rl: ReturnType<typeof makeRl>,
): Promise<{ athleteId: string; athleteName: string; dob: string | null }> {
  line('\n--- New athlete ---');
  const displayName = await ask(rl, 'Name');
  const dobRaw = await ask(rl, 'DOB (YYYY-MM-DD, optional)', '');
  const sexRaw = (await ask(rl, 'Sex (M/F, optional — for the maturity estimate)', '')).trim().toUpperCase();
  const sex = sexRaw === 'M' ? 'M' : sexRaw === 'F' ? 'F' : null;
  const sportsRaw = await ask(rl, 'Sport(s), comma-separated', '');
  const trainingMonths = (await askOptionalNumber(rl, 'Months of consistent training')) ?? 0;
  const valgusWatch = await askYesNo(rl, 'Knee-valgus watch? (prioritizes stick/knee-tracking work)', false);
  const weeklySportHours = await askOptionalNumber(rl, 'Weekly organized-sport hours (guardrail)');
  const weeklyTrainingHours = await askOptionalNumber(rl, 'Weekly training hours (guardrail)');
  const restDaysPerWeek = await askOptionalNumber(rl, 'Rest days per week (guardrail)');
  const profile = await createAthlete({
    displayName,
    dob: dobRaw || null,
    sex,
    sports: sportsRaw ? sportsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
    trainingMonths,
    valgusWatch,
    weeklySportHours,
    weeklyTrainingHours,
    restDaysPerWeek,
  });
  line(`Created ${profile.displayName}.`);
  return { athleteId: profile.athleteId, athleteName: profile.displayName, dob: profile.dob };
}

const jsonFlagIdx = argv.indexOf('--json');
if (jsonFlagIdx !== -1) {
  const path = argv[jsonFlagIdx + 1];
  if (!path) {
    line('Usage: npm run enter -- --json <path-to-form.json>');
    process.exitCode = 1;
  } else {
    await runBatch(path);
  }
} else {
  await main();
}
