/**
 * Session builder CLI — assemble and print a tier-appropriate session (disposable surface).
 *
 *   npm run session -- --tier A --day 1
 *   npm run session -- --athlete "Maya" --day 2            (tier from latest assessment; uses block state)
 *   npm run session -- --athlete <id> --day 3 --log         (also records it to workout_log)
 *   npm run session -- --athlete <id> --rotate              (advance to the next training block)
 *   npm run session -- --tier C --day 4 --equip none,box    (override equipment for this run)
 *
 * Printed shape resembles the 4-day reference program. Tier is coach-only (§3.3).
 */

import { stdout, argv } from 'node:process';
import { randomUUID } from 'node:crypto';

import { isTier, type Tier } from '../engine/types.ts';
import type { AssembledSession } from '../engine/assembler.ts';
import { assembleSession } from '../engine/assembler.ts';
import { loadExercises, loadDayTemplate, loadDayTemplates, loadAvailableEquipment } from '../store/library.ts';
import { resolveAthlete, currentTier } from '../store/query.ts';
import { append } from '../store/json-store.ts';
import {
  getOrInitBlockState, saveBlockState, rotateBlockState, dueForRotation, blockAgeDays,
} from '../store/blocks.ts';

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
}
const has = (name: string): boolean => argv.includes(`--${name}`);
const line = (s = ''): void => void stdout.write(s + '\n');

function printSession(s: AssembledSession, athleteName: string | undefined, valgusWatch: boolean): void {
  line('\n' + '='.repeat(66));
  line(`  ${s.label}  —  Day ${s.day}`);
  line(`  ${athleteName ? `Athlete: ${athleteName}   ` : ''}Tier: ${s.tier} (coach-only)   Emphasis: ${s.emphasis}   Sprint: ${s.sprintEmphasis}`);
  line(`  Valgus watch: ${valgusWatch ? 'YES — stick/valgus priority on' : 'no'}`);
  line('='.repeat(66));
  for (const b of s.blocks) {
    line(`\n${b.title}`);
    for (const it of b.items) {
      const e = it.exercise;
      const tags = [
        e.laterality === 'unilateral' ? 'SL' : null,
        e.stick ? 'stick' : null,
        e.valgus_relevant ? 'valgus' : null,
        `d${e.difficulty}`,
      ].filter(Boolean);
      line(`  • ${e.name}  —  ${it.doseText}  [${tags.join(', ')}]`);
      line(`      ↳ ${e.cue}`);
    }
  }
  const ceil = s.jumpDifficultyCeiling;
  const ceilText = ceil === null ? 'no ceiling (no max-velocity this day)' : `ceiling ${ceil}${s.jumpDifficultySum > ceil ? ' — OVER!' : ' — ok'}`;
  line(`\nJump difficulty (summed): ${s.jumpDifficultySum}  vs  ${ceilText}`);
  if (s.assemblyNotes.length) {
    line('\n— Assembly notes (coach-only) —');
    for (const n of s.assemblyNotes) line(`  · ${n}`);
  }
  line('');
}

async function main(): Promise<void> {
  const exercises = await loadExercises();
  const equipment = has('equip')
    ? new Set(['none', ...(arg('equip') ?? '').split(',').map((s) => s.trim()).filter(Boolean)])
    : await loadAvailableEquipment();

  // Resolve tier + optional athlete/block context.
  let tier: Tier | null = null;
  let athleteName: string | undefined;
  let athleteId: string | undefined;

  let valgusWatch = has('valgus'); // --valgus override (used with --tier); profile wins when --athlete

  const athleteArg = arg('athlete');
  if (athleteArg) {
    const athlete = await resolveAthlete(athleteArg);
    if (!athlete) return void line(`No unique athlete matched "${athleteArg}".`);
    athleteId = athlete.athleteId;
    athleteName = athlete.displayName;
    valgusWatch = athlete.valgusWatch;
    tier = await currentTier(athlete.athleteId);

    // --rotate: advance the training block, then exit.
    if (has('rotate')) {
      if (!tier) return void line(`${athleteName} has no assessment yet — can't rotate without a tier.`);
      const templates = await loadDayTemplates();
      const state = await getOrInitBlockState(athleteId);
      const rotated = rotateBlockState(state, exercises, templates, tier);
      await saveBlockState(rotated);
      return void line(`✓ ${athleteName} rotated to block ${rotated.blockIndex} (started ${rotated.blockStartDate}).`);
    }
    if (!tier) return void line(`${athleteName} has no assessment yet — enter one first, or pass --tier.`);
  } else {
    const tierArg = arg('tier');
    if (!tierArg || !isTier(tierArg.toUpperCase())) {
      return void line('Usage: npm run session -- (--tier S|A|B|C | --athlete <id|name>) --day <1-4> [--log] [--rotate] [--equip a,b]');
    }
    tier = tierArg.toUpperCase() as Tier;
  }

  const day = Number(arg('day') ?? '1');
  if (!Number.isInteger(day)) return void line(`--day must be a whole number.`);
  const template = await loadDayTemplate(day);

  // Block state (only when we have a real athlete; otherwise a fresh block-0).
  let blockIndex = 0;
  let slotVariants: Record<string, string> | undefined;
  if (athleteId) {
    const state = await getOrInitBlockState(athleteId);
    blockIndex = state.blockIndex;
    slotVariants = state.slotVariants;
    if (dueForRotation(state)) {
      line(`⚠ ${athleteName} is ${blockAgeDays(state)} days into block ${blockIndex} — due to rotate (npm run session -- --athlete <id> --rotate).`);
    }
  }

  const { session, slotVariants: updated } = assembleSession({
    tier, day, exercises, template, valgusWatch, equipment, blockIndex, slotVariants,
  });
  printSession(session, athleteName, valgusWatch);

  // Persist any newly-chosen variants so the block stays stable.
  if (athleteId) {
    const state = await getOrInitBlockState(athleteId);
    await saveBlockState({ ...state, slotVariants: updated });
  }

  if (has('log')) {
    if (!athleteId) line('⚠ --log requires --athlete. Not logged.');
    else {
      await append('workout_log', {
        workoutId: randomUUID(),
        athleteId,
        date: new Date().toISOString().slice(0, 10),
        servedForTier: tier,
        sessionLabel: `Day ${day} — ${session.label}`,
        completed: false,
        coachNotes: '',
      });
      line(`✓ Logged to workout_log for ${athleteName}.`);
    }
  }
}

await main();
