/**
 * Tiny readline prompt helpers for the data-entry CLI (disposable surface).
 * Kept dependency-free — Node's built-in readline only.
 */

import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import type { Tier, TestScore } from '../engine/types.ts';
import { isTier } from '../engine/types.ts';

export function makeRl(): Interface {
  return createInterface({ input: stdin, output: stdout });
}

/** Free-text question with an optional default (shown in brackets). */
export async function ask(rl: Interface, q: string, def?: string): Promise<string> {
  const suffix = def !== undefined && def !== '' ? ` [${def}]` : '';
  const a = (await rl.question(`${q}${suffix}: `)).trim();
  return a === '' && def !== undefined ? def : a;
}

/** A single test score 0–3, re-prompting until valid. */
export async function askScore(rl: Interface, label: string): Promise<TestScore> {
  for (;;) {
    const a = (await rl.question(`${label} (0–3): `)).trim();
    const n = Number(a);
    if (Number.isInteger(n) && n >= 0 && n <= 3) return n as TestScore;
    stdout.write('  ↳ enter a whole number 0, 1, 2, or 3.\n');
  }
}

/** A tier S/A/B/C (case-insensitive), or null if the coach skips. Re-prompts on bad input. */
export async function askTier(
  rl: Interface,
  q: string,
  allowSkip = true,
): Promise<Tier | null> {
  for (;;) {
    const a = (await rl.question(`${q}${allowSkip ? ' (S/A/B/C, blank to skip)' : ' (S/A/B/C)'}: `))
      .trim()
      .toUpperCase();
    if (a === '' && allowSkip) return null;
    if (isTier(a)) return a;
    stdout.write('  ↳ enter S, A, B, or C.\n');
  }
}

/** Yes/no with a default. */
export async function askYesNo(rl: Interface, q: string, def = false): Promise<boolean> {
  const a = (await rl.question(`${q} (y/n) [${def ? 'y' : 'n'}]: `)).trim().toLowerCase();
  if (a === '') return def;
  return a.startsWith('y');
}

/** Optional number; blank → null. */
export async function askOptionalNumber(rl: Interface, q: string): Promise<number | null> {
  const a = (await rl.question(`${q} (blank to skip): `)).trim();
  if (a === '') return null;
  const n = Number(a);
  return Number.isFinite(n) ? n : null;
}
