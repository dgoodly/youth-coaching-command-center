/**
 * Metric catalog — DURABLE CORE. The single source of truth for how logged actuals are typed:
 * unit, form-input kind, and PR direction. Each loggable exercise references metric IDS from
 * this catalog (see `Exercise.metrics` in program.ts); units/direction live HERE, not on each
 * exercise, so every squat logs load in the same unit and every sprint's PR direction (lower
 * time = better) is consistent. This is the same "define once, reference everywhere" discipline
 * the assembler uses for the difficulty band and the design tokens.
 *
 * Pure, no I/O. Adding a new measurement (RPE, contact time, heart rate) is ADDITIVE here — a
 * new catalog entry, never a schema migration of the set-log (PHASE_PLAN_workout_logging.md
 * §"typed metrics, NOT sparse columns").
 *
 * Units are a correctness surface: a metric's unit is CANONICAL and fixed. Load is stored in
 * pounds; mixing units within one metric's history breaks every trend silently. Convert at
 * display if ever needed — never at storage.
 */

/**
 * Stable metric ids. Extend this union (and {@link METRIC_CATALOG}) to add a measurement — the
 * set-log keys off these ids, so a new id is additive and never forces a migration.
 */
export type MetricId =
  | 'load'
  | 'reps'
  | 'time_s'
  | 'distance_cm'
  | 'height_cm'
  | 'duration_s'
  | 'contacts';

/** How a metric is entered — drives the form control and per-metric validation (Phase C). */
export type MetricInput = 'number' | 'integer';

export interface Metric {
  /** Stable id referenced by `Exercise.metrics` and used as the key in a set record's values. */
  id: MetricId;
  /** Short human label for the form + progress display ('Load', 'Time', 'Hold'). */
  label: string;
  /** Canonical storage unit — fixed per metric (never mixed within a metric's history). */
  unit: string;
  /** Form control + validation: 'integer' rejects fractional reps/contacts; 'number' allows decimals. */
  input: MetricInput;
  /**
   * PR direction. `true` → a HIGHER value is a PR (load, distance, height, hold). `false` → a
   * LOWER value is a PR — `time_s` is the sole such case (a faster sprint is the record).
   */
  higherIsBetter: boolean;
}

/**
 * The catalog. Values authored in METRIC_TAGGING_WORKSHEET.md: load canonical in **lb**;
 * `time_s` the only lower-is-better metric; holds/contacts higher-is-better.
 */
export const METRIC_CATALOG: Record<MetricId, Metric> = {
  load: { id: 'load', label: 'Load', unit: 'lb', input: 'number', higherIsBetter: true },
  reps: { id: 'reps', label: 'Reps', unit: 'reps', input: 'integer', higherIsBetter: true },
  time_s: { id: 'time_s', label: 'Time', unit: 's', input: 'number', higherIsBetter: false },
  distance_cm: { id: 'distance_cm', label: 'Distance', unit: 'cm', input: 'number', higherIsBetter: true },
  height_cm: { id: 'height_cm', label: 'Height', unit: 'cm', input: 'number', higherIsBetter: true },
  duration_s: { id: 'duration_s', label: 'Hold', unit: 's', input: 'number', higherIsBetter: true },
  contacts: { id: 'contacts', label: 'Contacts', unit: 'reps', input: 'integer', higherIsBetter: true },
};

/** All catalog metric ids, in declaration order. */
export const METRIC_IDS = Object.keys(METRIC_CATALOG) as MetricId[];

/** True if `s` is a known metric id — the resolve check for library validation (loud-fail on a typo). */
export function isMetricId(s: unknown): s is MetricId {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(METRIC_CATALOG, s);
}

/** The descriptor for a metric id, or `undefined` if it does not resolve. */
export function metricById(id: string): Metric | undefined {
  return isMetricId(id) ? METRIC_CATALOG[id] : undefined;
}
