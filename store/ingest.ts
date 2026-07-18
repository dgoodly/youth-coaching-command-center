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
import { assignTierWithContext } from '../engine/scoring.ts';
import type { PendingAppend, RecordStore } from './record-store.ts';

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
  /**
   * The athlete's current routing tier BEFORE this assessment (latest finalTier), or
   * null on a first-ever assessment. Feeds the §4.4 provisional rules — the caller
   * looks it up (`latestAssessment`) because this builder is pure.
   */
  priorTier: Tier | null;
  heightCm: number | null;
  /** Optional sitting height (cm) captured with standing height — feeds the maturity estimate. */
  sittingHeightCm?: number | null;
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
  /**
   * What finalTier would be once reviewed (the gates' own result) — for display
   * ("PROVISIONAL, held from A"). Not persisted; recomputable from the record.
   */
  unrestrictedTier: Tier;
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
 * Build (but do not persist) an assessment record from a field form. Does NO store I/O, so it is
 * directly unit-testable; recomputes raw/base/final deterministically via the spec §4 engine (the
 * paper values are only a cross-check). The one bit of non-determinism is the generated
 * `assessmentId` (randomUUID) — callers that need a stable id can overwrite it.
 */
export function buildAssessmentRecord(input: FieldFormInput): BuiltAssessment {
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
  if (input.priorTier !== null && !isTier(input.priorTier)) {
    throw new Error(`priorTier must be S/A/B/C or null (got ${JSON.stringify(input.priorTier)}).`);
  }

  // Rule 2: recompute from scores; this is the source of truth. A paper form is LIVE
  // scoring (§4.2–4.3), so the §4.4 provisional rules apply: unreviewed, against the
  // athlete's current tier. No harness escape hatch — deliberately. Under-training is
  // the safe direction, and a fake review would put a false reviewedBy in the data.
  const result = assignTierWithContext(scores, { reviewed: false, priorTier: input.priorTier });

  // Cross-check against any paper-written values. The paper coach ran spec §4 by hand —
  // gates only, no provisional concept exists on paper — so the finalTier cross-check
  // compares against the gates' own result (unrestrictedTier), not the held routing
  // value. Otherwise every §4.4 hold would read as a paper arithmetic slip.
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
    if (p.finalTier && p.finalTier !== result.unrestrictedTier) {
      paperMismatch.finalTier = { paper: p.finalTier, computed: result.unrestrictedTier };
      warnings.push(
        `Paper final tier (${p.finalTier}) ≠ computed (${result.unrestrictedTier}); computed value used.`,
      );
    }
  }

  const assessment: Assessment = {
    assessmentId: randomUUID(),
    athleteId: input.athleteId,
    date: input.date,
    tester: input.tester,
    scoresLive: scores,
    scoresReviewed: null,
    reviewedAt: null,
    reviewedBy: null,
    rawTotal: result.rawTotal,
    baseTier: result.baseTier,
    finalTier: result.finalTier,
    gateFired: result.gateFired,
    provisional: result.provisional,
    coachGutCall: input.coachGutCall,
    heightCm: input.heightCm,
    // No films yet: capture is S11. A record without films can never be reviewed, so
    // everything entered before S11 stays provisional until the athlete's next FILMED
    // assessment. Deliberate — see Assessment.provisional.
    films: {},
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

  return { assessment, heightEntry, warnings, unrestrictedTier: result.unrestrictedTier };
}

/**
 * Persist a built assessment: append the assessment record and (rule 4) dual-write the
 * height entry to the height log. Both go through a single `appendAll` so they commit as one
 * serialized unit (§10 dual-write atomicity) — the assessment is listed first, so the only
 * reachable partial state is the doctor-recoverable "assessment saved, height not yet".
 * Returns the stored assessment.
 */
export async function saveAssessment(store: RecordStore, built: BuiltAssessment): Promise<Assessment> {
  const appends: PendingAppend[] = [{ collection: 'assessments', record: built.assessment }];
  if (built.heightEntry) {
    appends.push({ collection: 'height_log', record: built.heightEntry });
  }
  await store.appendAll(appends);
  return built.assessment;
}

/** Compute the suggested re-assessment date (spec §6: every 4–6 weeks). Defaults to +5 weeks. */
export function nextAssessmentDate(date: string, weeks = 5): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** Look up an athlete's display name, or fall back to the id, for CLI/echo output. */
export async function athleteLabel(store: RecordStore, athleteId: string): Promise<string> {
  const athletes = await store.read('athletes');
  const a = athletes.find((x) => x.athleteId === athleteId);
  return a ? a.displayName : athleteId;
}
