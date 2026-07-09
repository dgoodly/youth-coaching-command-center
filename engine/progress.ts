/**
 * Progress & PRs — DURABLE CORE, pure (PHASE_PLAN_workout_logging.md Phase D). Given an athlete's
 * set-log for ONE exercise, derive per-metric PRs, a best-per-session trend series, and the most
 * recent session's best (the "target to beat" shown while logging).
 *
 * Pure function of the set-log, exactly like `computeMaturity` is a pure function of the height
 * log — data in, derived signals out; it never touches the store. PR *direction* comes from the
 * metric catalog's `higherIsBetter`: a heavier squat load is a PR, a FASTER sprint time is a PR.
 * Cheap to recompute on read at this scale, so nothing here is cached or pre-materialized
 * (consistent with the project's "don't cache prematurely" posture).
 *
 * "Needs two entries" degrades gracefully, mirroring maturity's velocity: a single logged session
 * yields a PR but `hasTrend = false` (no line to draw yet).
 */

import type { SetLogEntry } from './types.ts';
import { metricById, type Metric } from './metrics.ts';

/** One session's best value for a metric — a point on the trend line. */
export interface TrendPoint {
  workoutId: string;
  /** Session timestamp (earliest set logged in that session), ISO datetime. */
  date: string;
  /** Best value of the metric in that session (max if higherIsBetter, else min). */
  value: number;
}

export interface MetricProgress {
  metricId: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  /** Best-ever value across all logged sets, or null if this metric was never logged. */
  best: number | null;
  /** When the best was first achieved (ISO datetime), or null. */
  bestAt: string | null;
  /** Most recent session's best — the "last time" target to beat, or null. */
  last: number | null;
  lastAt: string | null;
  /** Best-per-session, chronological. `length >= 2` ⇒ a real trend to draw. */
  series: TrendPoint[];
}

export interface ExerciseProgress {
  exerciseId: string;
  /** Distinct sessions this exercise was logged in. */
  sessionCount: number;
  /** `true` once there are ≥ 2 sessions (a trend exists), mirroring the maturity two-entry rule. */
  hasTrend: boolean;
  metrics: MetricProgress[];
}

/** Chronological set order: oldest → newest by `loggedAt`, then `setIndex` within a session. */
function chronological(a: SetLogEntry, b: SetLogEntry): number {
  return a.loggedAt.localeCompare(b.loggedAt) || a.setIndex - b.setIndex;
}

/** Derive one metric's PR + trend from an exercise's (chronologically ordered) sets. */
function computeMetric(m: Metric, ordered: readonly SetLogEntry[]): MetricProgress {
  const better = (candidate: number, incumbent: number) =>
    m.higherIsBetter ? candidate > incumbent : candidate < incumbent;

  const sessions = new Map<string, TrendPoint>();
  let best: number | null = null;
  let bestAt: string | null = null;

  for (const s of ordered) {
    const v = s.values[m.id];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;

    // Best-per-session (session keyed by workoutId; earliest set is the session's timestamp).
    const point = sessions.get(s.workoutId);
    if (!point) {
      sessions.set(s.workoutId, { workoutId: s.workoutId, date: s.loggedAt, value: v });
    } else {
      if (better(v, point.value)) point.value = v;
      if (s.loggedAt < point.date) point.date = s.loggedAt;
    }

    // Overall best. Iterating chronologically + only updating on a STRICT improvement means ties
    // keep the earliest achievement date (the first time that best was hit).
    if (best === null || better(v, best)) {
      best = v;
      bestAt = s.loggedAt;
    }
  }

  const series = [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date));
  const lastPoint = series.length ? series[series.length - 1]! : null;
  return {
    metricId: m.id, label: m.label, unit: m.unit, higherIsBetter: m.higherIsBetter,
    best, bestAt,
    last: lastPoint ? lastPoint.value : null,
    lastAt: lastPoint ? lastPoint.date : null,
    series,
  };
}

/**
 * Compute per-metric progress for one exercise from its set-log. `metricIds` is the exercise's
 * declared metrics (from the library) — each is reported even if never logged (best/last null),
 * so the caller can render a stable set of rows. Unknown metric ids are skipped defensively.
 */
export function computeExerciseProgress(
  exerciseId: string,
  metricIds: readonly string[],
  sets: readonly SetLogEntry[],
): ExerciseProgress {
  const ordered = [...sets].sort(chronological);
  const sessionCount = new Set(ordered.map((s) => s.workoutId)).size;
  const metrics: MetricProgress[] = [];
  for (const id of metricIds) {
    const m = metricById(id);
    if (m) metrics.push(computeMetric(m, ordered));
  }
  return { exerciseId, sessionCount, hasTrend: sessionCount >= 2, metrics };
}
