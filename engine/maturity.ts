/**
 * Maturity axis — DURABLE CORE (stub-level for v1). Spec §7 / BUILD_BRIEF §3.1, §5 Phase 4.
 *
 * Governs DOSE only (volume/load/recovery), NEVER tier/movement selection — the two axes are
 * kept fully decoupled (§3.1). This module is a pure function of the height log: it estimates
 * height velocity and flags the peak-height-velocity (PHV) window, where coordination
 * temporarily regresses and injury risk rises → a temporary DOSE PULLBACK regardless of tier.
 *
 * v1 is deliberately simple (standing-height velocity only). Richer signals (sitting-height
 * ratio, weight/shoe trend) are future enrichment (spec §7) and NOT required to ship.
 */

import type { AthleteProfile, HeightLogEntry } from './types.ts';

/**
 * Velocity (cm/yr) at or above which we flag the PHV window → dose pullback. Reasoned default,
 * NOT validated (see FEATURE_IDEAS.md). Boys' peak height velocity commonly ~8–9 cm/yr; a 7
 * cm/yr trigger catches the run-up into the spurt.
 */
export const PHV_FLAG_CM_PER_YEAR = 7;

/** Maturity-offset band from the estimate: years relative to peak height velocity (PHV). */
export type PhvBand = 'pre' | 'circa' | 'post';

export interface MaturityStatus {
  latestHeightCm: number | null;
  /** Height velocity over the most recent measured interval, cm/yr. Null if < 2 entries. */
  velocityCmPerYear: number | null;
  /** True when velocity ≥ PHV threshold → temporary dose pullback (spec §7). */
  nearPHV: boolean;
  /**
   * Estimated maturity offset in years relative to PHV (negative = pre-PHV), via the
   * Moore/Fransen 2015 equations (preferred over the older Mirwald). Null when the inputs
   * (sex, DOB, and — for boys — sitting height on the latest entry) aren't all present.
   */
  maturityOffsetYears: number | null;
  /** Estimated chronological age (yrs) at PHV, from the offset. Null when offset is null. */
  estimatedAgeAtPHV: number | null;
  /** Coarse band from the offset: pre (< −1yr), circa (±1yr), post (> +1yr). Null if no estimate. */
  phvBand: PhvBand | null;
  /** Which estimator produced the offset (or why none), for provenance. */
  method: string | null;
  /** Plain-language summary for the coach. */
  note: string;
}

/** Options for the maturity-offset estimate — the profile bits the height log doesn't carry. */
export interface MaturityInputs {
  dob?: string | null;
  sex?: AthleteProfile['sex'];
}

/** Decimal age in years between an ISO DOB and an ISO measurement date (365.25-day year). */
function decimalAge(dobIso: string, onIso: string): number {
  const dob = new Date(dobIso + 'T00:00:00Z').getTime();
  const on = new Date(onIso + 'T00:00:00Z').getTime();
  return (on - dob) / (365.25 * 86_400_000);
}

/**
 * Moore et al. (2015) maturity offset (years from PHV) — the simplified, sex-specific forms
 * (Fransen-endorsed, preferred over Mirwald 2002). Boys use sitting height; girls use standing
 * height. Returns null when a required input is missing. Population estimate, not precision.
 */
function mooreOffset(
  sex: 'M' | 'F',
  ageYears: number,
  standingHeightCm: number,
  sittingHeightCm: number | null | undefined,
): number | null {
  if (sex === 'M') {
    if (sittingHeightCm == null) return null;
    return -8.128741 + 0.0070346 * (ageYears * sittingHeightCm);
  }
  return -7.709133 + 0.0042232 * (ageYears * standingHeightCm);
}

/** Sort a height log oldest → newest (defensive copy). */
function sortByDate(entries: HeightLogEntry[]): HeightLogEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date));
}

function yearsBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00Z').getTime();
  const b = new Date(bIso + 'T00:00:00Z').getTime();
  return (b - a) / (365.25 * 86_400_000);
}

/** The offset-estimate fields (computed from the latest entry + profile inputs). */
type Estimate = Pick<MaturityStatus, 'maturityOffsetYears' | 'estimatedAgeAtPHV' | 'phvBand' | 'method'>;

const NO_ESTIMATE = (method: string): Estimate => ({
  maturityOffsetYears: null,
  estimatedAgeAtPHV: null,
  phvBand: null,
  method,
});

/** Maturity-offset estimate from the latest height entry + profile inputs (Moore/Fransen 2015). */
function estimateFrom(latest: HeightLogEntry, inputs: MaturityInputs): Estimate {
  const { dob, sex } = inputs;
  if (!sex) return NO_ESTIMATE('no estimate: athlete sex not set');
  if (!dob) return NO_ESTIMATE('no estimate: DOB not set');
  const age = decimalAge(dob, latest.date);
  const offset = mooreOffset(sex, age, latest.heightCm, latest.sittingHeightCm);
  if (offset === null) return NO_ESTIMATE('no estimate: sitting height needed for the male equation');
  const band: PhvBand = offset < -1 ? 'pre' : offset > 1 ? 'post' : 'circa';
  return {
    maturityOffsetYears: offset,
    estimatedAgeAtPHV: age - offset,
    phvBand: band,
    method: `Moore2015-${sex === 'M' ? 'male' : 'female'}`,
  };
}

/** Human phrase for the offset band. */
function bandNote(est: Estimate): string {
  if (est.maturityOffsetYears === null) return est.method ?? '';
  const yrs = est.maturityOffsetYears;
  const mag = Math.abs(yrs).toFixed(1);
  if (est.phvBand === 'circa') {
    return `Estimated CIRCA-PHV (${yrs >= 0 ? '+' : '−'}${mag} yr from PHV) → the spurt window: ease dose, prioritize landing/movement quality, expect a temporary coordination dip.`;
  }
  if (est.phvBand === 'pre') {
    return `Estimated PRE-PHV (${mag} yr before PHV) → emphasize motor-skill/coordination; strength/power ramps in later.`;
  }
  return `Estimated POST-PHV (${mag} yr after PHV) → strength/power emphasis is appropriate.`;
}

/**
 * Compute maturity status from an athlete's height log + optional profile inputs (DOB, sex).
 * Two complementary signals, both decoupled from tier — callers must NOT let this change tier:
 *   1. height VELOCITY over the last interval (the direct spurt signal);
 *   2. a maturity-OFFSET estimate (years from PHV) via Moore/Fransen when inputs are present.
 */
export function computeMaturity(entries: HeightLogEntry[], inputs: MaturityInputs = {}): MaturityStatus {
  const log = sortByDate(entries);
  if (log.length === 0) {
    return {
      latestHeightCm: null, velocityCmPerYear: null, nearPHV: false,
      ...NO_ESTIMATE('no estimate: no height logged'), note: 'No height logged yet.',
    };
  }
  const latest = log[log.length - 1]!;
  const est = estimateFrom(latest, inputs);
  const estPhrase = est.maturityOffsetYears !== null ? ` ${bandNote(est)}` : '';

  if (log.length === 1) {
    return {
      latestHeightCm: latest.heightCm, velocityCmPerYear: null, nearPHV: false, ...est,
      note: `Only one height entry — need a second (~quarterly) to estimate velocity.${estPhrase}`,
    };
  }

  const prev = log[log.length - 2]!;
  const years = yearsBetween(prev.date, latest.date);
  if (years <= 0) {
    return {
      latestHeightCm: latest.heightCm, velocityCmPerYear: null, nearPHV: false, ...est,
      note: `Two height entries share a date — cannot compute velocity.${estPhrase}`,
    };
  }

  const velocity = (latest.heightCm - prev.heightCm) / years;
  const nearPHV = velocity >= PHV_FLAG_CM_PER_YEAR;
  const velNote = nearPHV
    ? `Near peak height velocity (${velocity.toFixed(1)} cm/yr) → DOSE PULLBACK: trim volume, conservative loading, extra landing-quality emphasis. Does NOT change tier.`
    : `Height velocity ${velocity.toFixed(1)} cm/yr — normal range.`;

  return { latestHeightCm: latest.heightCm, velocityCmPerYear: velocity, nearPHV, ...est, note: `${velNote}${estPhrase}` };
}
