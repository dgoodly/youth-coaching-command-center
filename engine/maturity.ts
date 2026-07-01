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

import type { HeightLogEntry } from './types.ts';

/**
 * Velocity (cm/yr) at or above which we flag the PHV window → dose pullback. Reasoned default,
 * NOT validated (see FEATURE_IDEAS.md). Boys' peak height velocity commonly ~8–9 cm/yr; a 7
 * cm/yr trigger catches the run-up into the spurt.
 */
export const PHV_FLAG_CM_PER_YEAR = 7;

export interface MaturityStatus {
  latestHeightCm: number | null;
  /** Height velocity over the most recent measured interval, cm/yr. Null if < 2 entries. */
  velocityCmPerYear: number | null;
  /** True when velocity ≥ PHV threshold → temporary dose pullback (spec §7). */
  nearPHV: boolean;
  /** Plain-language summary for the coach. */
  note: string;
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

/**
 * Compute maturity status from an athlete's height log. Uses the two most recent entries for
 * the current velocity. Returns a decoupled dose signal — callers must NOT let this change tier.
 */
export function computeMaturity(entries: HeightLogEntry[]): MaturityStatus {
  const log = sortByDate(entries);
  if (log.length === 0) {
    return { latestHeightCm: null, velocityCmPerYear: null, nearPHV: false, note: 'No height logged yet.' };
  }
  const latest = log[log.length - 1]!;
  if (log.length === 1) {
    return {
      latestHeightCm: latest.heightCm,
      velocityCmPerYear: null,
      nearPHV: false,
      note: 'Only one height entry — need a second (~quarterly) to estimate velocity.',
    };
  }

  const prev = log[log.length - 2]!;
  const years = yearsBetween(prev.date, latest.date);
  if (years <= 0) {
    return {
      latestHeightCm: latest.heightCm,
      velocityCmPerYear: null,
      nearPHV: false,
      note: 'Two height entries share a date — cannot compute velocity.',
    };
  }

  const velocity = (latest.heightCm - prev.heightCm) / years;
  const nearPHV = velocity >= PHV_FLAG_CM_PER_YEAR;
  const note = nearPHV
    ? `Near peak height velocity (${velocity.toFixed(1)} cm/yr) → DOSE PULLBACK: trim volume, conservative loading, extra landing-quality emphasis. Does NOT change tier.`
    : `Height velocity ${velocity.toFixed(1)} cm/yr — normal range.`;

  return { latestHeightCm: latest.heightCm, velocityCmPerYear: velocity, nearPHV, note };
}
