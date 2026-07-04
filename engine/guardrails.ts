/**
 * Specialization / volume guardrails — DURABLE CORE (pure). Makes the coach's multi-sport,
 * anti-overuse stance (COACHING_INSTRUCTIONS "SAFETY / DON'T") checkable against an athlete's
 * profile instead of leaving it purely advisory:
 *   1. total weekly organized-sport + training hours roughly ≤ the child's AGE;
 *   2. intense organized sport capped at < 16 h/week;
 *   3. ≥ 1–2 rest days per week.
 *
 * These are ADVISORY thresholds (reasoned defaults, see FEATURE_IDEAS.md) — the tool flags, it
 * does not block. Any input that's missing yields a `unknown` finding, not a false pass. No I/O.
 */

export type GuardrailRule = 'weekly_hours_vs_age' | 'intense_sport_cap' | 'rest_days';
export type GuardrailStatus = 'ok' | 'watch' | 'exceeded' | 'unknown';

export interface GuardrailFinding {
  rule: GuardrailRule;
  status: GuardrailStatus;
  message: string;
}

export interface GuardrailReport {
  findings: GuardrailFinding[];
  /** True if any rule is `exceeded` (a real overrun to act on). */
  anyExceeded: boolean;
  /** True if any rule is `watch` (approaching a threshold). */
  anyWatch: boolean;
}

export interface GuardrailInputs {
  /** Whole-year age (from DOB). Null → the age-based rule can't be evaluated. */
  age: number | null;
  weeklySportHours?: number | null;
  weeklyTrainingHours?: number | null;
  restDaysPerWeek?: number | null;
}

/** Intense-organized-sport weekly-hours cap (COACHING_INSTRUCTIONS). Tunable default. */
export const INTENSE_SPORT_HOURS_CAP = 16;

function has(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Evaluate the three volume guardrails for one athlete. Missing inputs → `unknown` findings. */
export function checkVolumeGuardrails(input: GuardrailInputs): GuardrailReport {
  const { age, weeklySportHours: sport, weeklyTrainingHours: training, restDaysPerWeek: rest } = input;
  const findings: GuardrailFinding[] = [];

  // Rule 1 — total weekly load vs age.
  if (!has(age) || (!has(sport) && !has(training))) {
    findings.push({
      rule: 'weekly_hours_vs_age',
      status: 'unknown',
      message: 'Weekly hours vs age: need age (DOB) and at least one of sport/training hours.',
    });
  } else {
    const total = (has(sport) ? sport : 0) + (has(training) ? training : 0);
    if (total > age) {
      findings.push({
        rule: 'weekly_hours_vs_age',
        status: 'exceeded',
        message: `Weekly load ${total} h exceeds the athlete's age (${age}) — trim total organized-sport + training hours.`,
      });
    } else if (total > age - 2) {
      findings.push({
        rule: 'weekly_hours_vs_age',
        status: 'watch',
        message: `Weekly load ${total} h is near the age guideline (≤ ${age} h/week).`,
      });
    } else {
      findings.push({
        rule: 'weekly_hours_vs_age',
        status: 'ok',
        message: `Weekly load ${total} h is within the age guideline (≤ ${age} h/week).`,
      });
    }
  }

  // Rule 2 — intense-sport cap.
  if (!has(sport)) {
    findings.push({ rule: 'intense_sport_cap', status: 'unknown', message: 'Intense-sport cap: weekly sport hours not recorded.' });
  } else if (sport >= INTENSE_SPORT_HOURS_CAP) {
    findings.push({
      rule: 'intense_sport_cap',
      status: 'exceeded',
      message: `Organized sport ${sport} h/week is at/above the ${INTENSE_SPORT_HOURS_CAP} h cap — overuse/burnout risk.`,
    });
  } else if (sport >= INTENSE_SPORT_HOURS_CAP - 3) {
    findings.push({ rule: 'intense_sport_cap', status: 'watch', message: `Organized sport ${sport} h/week is approaching the ${INTENSE_SPORT_HOURS_CAP} h cap.` });
  } else {
    findings.push({ rule: 'intense_sport_cap', status: 'ok', message: `Organized sport ${sport} h/week is under the ${INTENSE_SPORT_HOURS_CAP} h cap.` });
  }

  // Rule 3 — rest days.
  if (!has(rest)) {
    findings.push({ rule: 'rest_days', status: 'unknown', message: 'Rest days: not recorded.' });
  } else if (rest < 1) {
    findings.push({ rule: 'rest_days', status: 'exceeded', message: `${rest} rest day(s)/week — below the ≥ 1–2 guideline; schedule recovery.` });
  } else if (rest < 2) {
    findings.push({ rule: 'rest_days', status: 'watch', message: `${rest} rest day/week — aim for ≥ 1–2.` });
  } else {
    findings.push({ rule: 'rest_days', status: 'ok', message: `${rest} rest days/week — meets the ≥ 1–2 guideline.` });
  }

  return {
    findings,
    anyExceeded: findings.some((f) => f.status === 'exceeded'),
    anyWatch: findings.some((f) => f.status === 'watch'),
  };
}
