/**
 * Field-form ingest — turns a completed paper field form into a stored assessment record.
 *
 * Implements the `Field_Form_Data_Contract.md` ingestion rules:
 *   1. All six scores required before a tier can be computed.
 *   2. Always RECOMPUTE raw/base/final from the six scores; treat paper-written values as
 *      a cross-check, not source of truth. On mismatch, surface both (paperMismatch).
 *   3. Persist base_tier, final_tier AND gate_fired (the latter two for validation).
 *   4. Append height_cm to the height log as well as the assessment (one entry serves both
 *      the broad-jump reference and the maturity axis).
 *   5. Capture coach_gut_call when available — the key to threshold tuning (§3.7).
 *
 * The CAP RULE (spec §3 Test 5 / contract): if the broad-jump landing was uncontrolled,
 * the recorded score is capped at 1 regardless of distance. The coach applies this on
 * paper; we re-validate here when the "landing failed" flag is captured.
 *
 * `buildAssessmentRecord` is PURE (no I/O) so it is unit-testable. `saveAssessment` does
 * the actual store writes.
 */

import { randomUUID } from 'node:crypto';

import type {
  Assessment,
  HeightLogEntry,
  PaperMismatch,
  Scores,
  Tier,
} from '../engine/types.ts';
import { SCORE_KEYS, isTestScore, isTier } from '../engine/types.ts';
import { assignTier } from '../engine/scoring.ts';
import { append, readCollection, writeCollection } from './json-store.ts';

/** The raw input a completed paper field form provides (contract page-1 + scores + outputs). */
export interface FieldFormInput {
  athleteId: string;
  date: string; // ISO date YYYY-MM-DD
  tester: string;
  scores: Scores;
  /**
   * Test 5 CAP RULE flag: true if the broad-jump landing was uncontrolled / knees caved.
   * When true, `scores.broad` is re-validated to be <= 1 (capped, with a warning).
   */
  broadLandingFailed?: boolean;
  /** §3.7 — coach's independent gut-call tier, ideally entered BEFORE the reveal. */
  coachGutCall: Tier | null;
  heightCm: number | null;
  /** Optional sitting height (cm) captured with standing height — feeds the maturity estimate. */
  sittingHeightCm?: number | null;
  videoRefs?: string[];
  notes?: string;
  /** Optional paper-written outputs, for the cross-check (contract rule 2). */
  paper?: {
    rawTotal?: number;
    baseTier?: Tier;
    finalTier?: Tier;
  };
}

export interface BuiltAssessment {
  assessment: Assessment;
  /** Present iff heightCm was supplied — dual-written to the height log (rule 4). */
  heightEntry: HeightLogEntry | null;
  /** Human-readable warnings (CAP-rule cap applied, paper mismatch, etc.). */
  warnings: string[];
}

/** Validate the six scores are present and each an integer 0–3 (contract rule 1). */
function validateScores(scores: Scores): void {
  for (const key of SCORE_KEYS) {
    const v = scores[key];
    if (!isTestScore(v)) {
      throw new Error(
        `Score "${key}" must be an integer 0–3 (got ${JSON.stringify(v)}). All six are required.`,
      );
    }
  }
}

/**
 * Build (but do not persist) an assessment record from a field form. Pure.
 * Recomputes raw/base/final via the spec §4 engine; the paper values are a cross-check.
 */
export function buildAssessmentRecord(
  input: FieldFormInput,
  now: Date = new Date(),
): BuiltAssessment {
  const warnings: string[] = [];

  // Defensive copy so we can apply the CAP RULE without mutating the caller's object.
  const scores: Scores = { ...input.scores };
  validateScores(scores);

  // CAP RULE (Test 5): uncontrolled landing caps broad at 1 regardless of distance.
  if (input.broadLandingFailed && scores.broad > 1) {
    warnings.push(
      `CAP RULE applied: broad-jump landing flagged uncontrolled — score capped ${scores.broad} → 1.`,
    );
    scores.broad = 1;
  }

  if (input.coachGutCall !== null && !isTier(input.coachGutCall)) {
    throw new Error(`coachGutCall must be S/A/B/C or null (got ${JSON.stringify(input.coachGutCall)}).`);
  }

  // Rule 2: recompute from scores; this is the source of truth.
  const result = assignTier(scores);

  // Cross-check against any paper-written values.
  const paperMismatch: PaperMismatch = {};
  const p = input.paper;
  if (p) {
    if (typeof p.rawTotal === 'number' && p.rawTotal !== result.rawTotal) {
      paperMismatch.rawTotal = { paper: p.rawTotal, computed: result.rawTotal };
      warnings.push(
        `Paper RAW total (${p.rawTotal}) ≠ computed (${result.rawTotal}) — likely an arithmetic slip; computed value used.`,
      );
    }
    if (p.baseTier && p.baseTier !== result.baseTier) {
      paperMismatch.baseTier = { paper: p.baseTier, computed: result.baseTier };
      warnings.push(
        `Paper base tier (${p.baseTier}) ≠ computed (${result.baseTier}); computed value used.`,
      );
    }
    if (p.finalTier && p.finalTier !== result.finalTier) {
      paperMismatch.finalTier = { paper: p.finalTier, computed: result.finalTier };
      warnings.push(
        `Paper final tier (${p.finalTier}) ≠ computed (${result.finalTier}); computed value used.`,
      );
    }
  }

  const assessment: Assessment = {
    assessmentId: randomUUID(),
    athleteId: input.athleteId,
    date: input.date,
    tester: input.tester,
    scores,
    rawTotal: result.rawTotal,
    baseTier: result.baseTier,
    finalTier: result.finalTier,
    gateFired: result.gateFired,
    coachGutCall: input.coachGutCall,
    heightCm: input.heightCm,
    videoRefs: input.videoRefs ?? [],
    notes: input.notes ?? '',
    ...(Object.keys(paperMismatch).length > 0 ? { paperMismatch } : {}),
  };

  const heightEntry: HeightLogEntry | null =
    input.heightCm !== null && input.heightCm !== undefined
      ? {
          athleteId: input.athleteId,
          date: input.date,
          heightCm: input.heightCm,
          ...(input.sittingHeightCm != null ? { sittingHeightCm: input.sittingHeightCm } : {}),
          source: 'assessment',
        }
      : null;

  void now; // reserved for future "createdAt"-style stamping; kept for signature stability
  return { assessment, heightEntry, warnings };
}

/**
 * Persist a built assessment: append the assessment record and (rule 4) dual-write the
 * height entry to the height log. Returns the stored assessment.
 */
export async function saveAssessment(built: BuiltAssessment): Promise<Assessment> {
  await append('assessments', built.assessment);
  if (built.heightEntry) {
    await append('height_log', built.heightEntry);
  }
  return built.assessment;
}

/** Compute the suggested re-assessment date (spec §6: every 4–6 weeks). Defaults to +5 weeks. */
export function nextAssessmentDate(date: string, weeks = 5): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** Look up an athlete's display name, or fall back to the id, for CLI/echo output. */
export async function athleteLabel(athleteId: string): Promise<string> {
  const athletes = await readCollection('athletes');
  const a = athletes.find((x) => x.athleteId === athleteId);
  return a ? a.displayName : athleteId;
}

/** Re-export for the CLI so it has one import surface. */
export { readCollection, writeCollection, append };
