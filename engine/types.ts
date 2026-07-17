/**
 * Data model — the durable core schema.
 *
 * Mirrors `Youth_Tiering_Assessment_Spec.md` §8 and the `Field_Form_Data_Contract.md`.
 * This is build #1's schema AND the future app's schema (BUILD_BRIEF §1), so it is built
 * clean: two independent axes, a visibility concept, and full validation provenance.
 *
 * Design intent enforced here (do not collapse without flagging to the coach):
 *  - §3.1 TIER and MATURITY are SEPARATE fields. Tier governs movement SELECTION/risk;
 *    maturity governs DOSE. Never let one compute the other.
 *  - §3.3 Tier and raw scores are NON-USER-FACING. Encoded as `Visibility` so the app
 *    can't accidentally surface them to an athlete/parent.
 *  - §3.7 Every assessment stores base_tier, final_tier, gate_fired, and coach_gut_call
 *    so the validation log can tune the bands/gates against real athletes.
 */

// ---------------------------------------------------------------------------
// TIER axis — movement selection / risk (set by the assessment, spec §4–§5)
// ---------------------------------------------------------------------------

/** S/A/B/C. Ranked C < B < A < S for the lower-only gate logic (spec §4). */
export type Tier = 'C' | 'B' | 'A' | 'S';

/** Ascending rank. Higher number = more movement unlocked. */
export const TIER_RANK: Record<Tier, number> = { C: 0, B: 1, A: 2, S: 3 };

/** All tiers, low → high. */
export const TIERS: readonly Tier[] = ['C', 'B', 'A', 'S'] as const;

export type TierStage =
  | 'Foundational' // C
  | 'Developing' // B
  | 'Proficient' // A
  | 'Advanced'; // S

/**
 * Weekly training frequency an athlete is programmed at — how many days of the split they run.
 * Independent of `Tier`: tier governs movement selection / dose (content), split governs day
 * count. A coach picks this per athlete (in-season load, access, multi-sport schedule); the same
 * four authored day-templates are subset to fit (see `store/blocks.ts` SPLIT_DAYS). Defaults to
 * `4day` (the full split) when unset — `splitOf` centralises that default.
 */
export type SplitChoice = '2day' | '3day' | '4day';

/** All split choices, low → high frequency. */
export const SPLIT_CHOICES: readonly SplitChoice[] = ['2day', '3day', '4day'] as const;

export const TIER_STAGE: Record<Tier, TierStage> = {
  C: 'Foundational',
  B: 'Developing',
  A: 'Proficient',
  S: 'Advanced',
};

// ---------------------------------------------------------------------------
// Assessment — the six-test battery (spec §3) and scoring outputs (spec §4, §8)
// ---------------------------------------------------------------------------

/** A single test score: integer 0–3 (spec §3). Use {@link isTestScore} to validate. */
export type TestScore = 0 | 1 | 2 | 3;

/**
 * The six tests, in the fixed spec order (spec §3, contract §"Test scores").
 * Order is part of the data contract — do not reorder.
 *   1 squat · 2 dropStick · 3 balance · 4 pushup · 5 broad · 6 pogo
 */
export interface Scores {
  /** Test 1 — Bodyweight Squat. Gate-critical. */
  squat: TestScore;
  /** Test 2 — Drop-and-Stick Landing. Gate-critical (the landing-integrity gate). */
  dropStick: TestScore;
  /** Test 3 — Single-Leg Balance. Scored on the WEAKER leg. */
  balance: TestScore;
  /** Test 4 — Push-Ups (quality reps). */
  pushup: TestScore;
  /** Test 5 — Broad Jump relative to height. CAP RULE applies (spec §3, capped at 1 if landing uncontrolled). */
  broad: TestScore;
  /** Test 6 — Continuous Pogo Hops. */
  pogo: TestScore;
}

/** Ordered list of the six score keys (fixed contract order). */
export const SCORE_KEYS = [
  'squat',
  'dropStick',
  'balance',
  'pushup',
  'broad',
  'pogo',
] as const satisfies readonly (keyof Scores)[];

/** One of the six test keys — `Assessment.films` is keyed by it (brief §5.1). */
export type ScoreKey = (typeof SCORE_KEYS)[number];

/**
 * Which hard gate (spec §4) lowered the tier on this assessment, if any.
 * Stored for validation (§3.7) — tells the coach whether gates are too aggressive/lenient.
 *   none  — no gate fired; final_tier === base_tier
 *   capC  — Test 1 (squat) < 2 OR Test 2 (dropStick) < 2 → capped at C
 *   capA  — Test 2 (dropStick) === 2 → capped at A
 *   S→A   — was S but dropStick < 3 → dropped to A (S demands a perfect stick)
 */
export type GateFired = 'none' | 'capC' | 'capA' | 'S->A';

/** The result of running the scoring engine — pure function of {@link Scores}. */
export interface ScoringResult {
  /** 0–18, sum of the six scores. */
  rawTotal: number;
  /** Tier from the raw-total bands, BEFORE gates (spec §4 step 1). */
  baseTier: Tier;
  /** Tier AFTER gates — the value the app routes on (spec §4 step 2). */
  finalTier: Tier;
  /** Which gate (if any) lowered base → final. */
  gateFired: GateFired;
}

/** Provenance context for the §4.4 provisional rules (brief §5.2). */
export interface TierContext {
  /** Film review has landed (`scoresReviewed` present). Film is truth — no holds apply. */
  reviewed: boolean;
  /**
   * The athlete's current ROUTING tier before this assessment (latest `finalTier`), or
   * null on a first-ever assessment. Note this means holds CHAIN: an athlete held at B
   * stays held at B across every subsequent unreviewed assessment, because each hold
   * becomes the next assessment's prior. Correct — the risky direction keeps costing a
   * measurement — and it self-heals via the 42-day re-assess clock once S11/S12 land.
   */
  priorTier: Tier | null;
}

/** {@link ScoringResult} plus what the §4.4 provisional rules did to it. */
export interface ProvisionalScoringResult extends ScoringResult {
  /** True when unreviewed — `finalTier` may be held below the gates' own result. */
  provisional: boolean;
  /**
   * What `finalTier` would be once reviewed (the gates' own result on the real scores).
   * Feeds the "Provisional — A (capped from S)" copy. NOT persisted — recomputable.
   */
  unrestrictedTier: Tier;
}

/**
 * A film CAPTURED during an assessment: a blob in device-local storage (OPFS once S11
 * exists) on ONE device, purged at the athlete's next assessment (brief §4.6, §4.7).
 *
 * NOT an exemplar. Exemplars (the reference clips the review screen shows next to a
 * capture, S3/S12) are app assets shipped to EVERY install with model-release consent
 * behind them. Opposite lifecycles — a captured film must never be promoted into an
 * exemplar, and the types are kept separate so the confusion can't compile.
 *
 * Deliberately minimal: S11 (capture) owns enriching this shape when it knows what
 * capture actually needs.
 */
export interface CapturedFilmRef {
  /** Device-local identity of the clip (OPFS path once S11 exists). */
  ref: string;
}

/**
 * One assessment record (spec §8 "Minimum fields to persist per assessment",
 * contract §"Scoring outputs" + §"Coach gut-call"; live/reviewed split per brief §5.1).
 */
export interface Assessment {
  assessmentId: string; // uuid
  athleteId: string; // uuid — links to AthleteProfile
  date: string; // ISO date (YYYY-MM-DD). Drives the 4–6 week re-assessment prompt.
  tester: string; // who scored LIVE at the field (brief §4.2 — provenance, not permissions)

  /** Scores as judged live, kid in front of you (brief §4.3). Never overwritten by review. */
  scoresLive: Scores;
  /** Scores as revised from film, or null until reviewed. Film is truth (brief §4.4 rule 4). */
  scoresReviewed: Scores | null;
  reviewedAt: string | null; // ISO datetime of the film review
  /** Who reviewed. The live→reviewed calibration delta only counts rows where this matches `tester`. */
  reviewedBy: string | null;
  // Canonical scores = scoresReviewed ?? scoresLive — use {@link canonicalScores}.

  // --- scoring outputs (recomputed from canonical scores; spec §4, contract rule 2) ---
  rawTotal: number; // 0–18 — a MEASUREMENT: always the sum of the real canonical scores
  baseTier: Tier; // before gates — also a measurement (band lookup on rawTotal)
  /**
   * The ROUTING value: after gates AND the §4.4 provisional rules. On a provisional
   * record this can sit below what the gates alone produce (a held promotion / the
   * first-assessment cap) — `provisional: true` is what explains that gap.
   */
  finalTier: Tier;
  /**
   * Which gate fired — a pure function of the real canonical scores (validation, §3.7).
   * NEVER reflects the provisional rules: every provisional hold reads the same way in
   * the record (base X · gate <real> · final Y · provisional true) no matter which §4.4
   * rule produced it.
   */
  gateFired: GateFired;
  /**
   * True until a film review lands (brief §4.4). While true, `finalTier` may be held
   * below the gates' own result and promotion waits for film. NOTE: an assessment with
   * no films (everything entered before S11 exists) can never be reviewed — those
   * athletes stay provisional until their next FILMED assessment. Deliberate: the safe
   * direction, and it self-heals via the re-assess clock.
   */
  provisional: boolean;

  /**
   * §3.7 / §8 — the coach's INDEPENDENT gut-call tier, captured BEFORE the calculated
   * tier is revealed (cleaner validation). `null` if not provided. The gap between this
   * and finalTier, across athletes, is what tunes the bands/gates.
   */
  coachGutCall: Tier | null;

  /** Height at time of assessment; dual-written to the height log (contract rule 4). */
  heightCm: number | null;

  /** Captured clips keyed by the test they film (spec films tests 1, 2, 5). */
  films: Partial<Record<ScoreKey, CapturedFilmRef>>;

  /** Free-text observations (contract §Optional). */
  notes: string;

  /**
   * Cross-check provenance: what the coach hand-wrote on the paper form, when it
   * disagreed with the recomputed values (contract ingestion rule 2). Empty when the
   * paper math matched. Kept so transcription/arithmetic slips are auditable, not silently
   * overwritten.
   */
  paperMismatch?: PaperMismatch;

  /**
   * When this assessment's films are purged (brief §4.7: at the athlete's next
   * assessment). `null` = pinned via "Keep longer". Absent when there are no films.
   */
  filmsPurgeAt?: string | null;
}

/** Canonical scores: reviewed wins (film is truth), live until then (brief §5.1). */
export function canonicalScores(a: Pick<Assessment, 'scoresLive' | 'scoresReviewed'>): Scores {
  return a.scoresReviewed ?? a.scoresLive;
}

/** Recorded when paper-written outputs disagree with the engine's recomputation. */
export interface PaperMismatch {
  rawTotal?: { paper: number; computed: number };
  baseTier?: { paper: Tier; computed: Tier };
  finalTier?: { paper: Tier; computed: Tier };
}

// ---------------------------------------------------------------------------
// Athlete profile + maturity axis (spec §6 training history, §7 height tracking)
// ---------------------------------------------------------------------------

export interface AthleteProfile {
  athleteId: string; // uuid
  displayName: string;
  dob: string | null; // ISO date; age derivable from this (contract: age derivable from DOB)
  sports: string[];
  /**
   * Biological sex, needed for the maturity-offset estimate (COACHING_INSTRUCTIONS
   * "MATURITY MONITORING"; the Moore/Fransen equations differ by sex). Optional/`null` when
   * unknown — the estimate is simply skipped. Independent of tier and of gender identity;
   * used only for the growth-maturation model.
   */
  sex?: 'M' | 'F' | null;
  /**
   * Months of consistent training (spec §6). CONTEXT input, NOT one of the 18 scored
   * points — a tie-breaker between adjacent tiers and an input to dose logic.
   */
  trainingMonths: number;
  /**
   * Knee-valgus watch. Drives the assembler's valgus priority (EXERCISE_LIBRARY.md §3
   * step 4): prefer `valgus_relevant` + `stick` movements and always run the CoD funnel on
   * lateral days. Independent of tier/maturity.
   */
  valgusWatch: boolean;
  /**
   * Specialization / volume-guardrail inputs (COACHING_INSTRUCTIONS "SAFETY / DON'T"). All
   * optional/`null` when unknown — the corresponding check just reports "unknown" rather than
   * firing. Hours are per week.
   */
  weeklySportHours?: number | null;
  weeklyTrainingHours?: number | null;
  restDaysPerWeek?: number | null;
  createdAt: string; // ISO datetime
  notes: string;
}

/**
 * Per-athlete rotation state (BUILD_BRIEF §2A.5 / EXERCISE_LIBRARY.md §4). A training block
 * is 8–10 weeks; within a block the athlete's session uses a fixed variant per slot-fill.
 * At a block boundary the coach rotates (deliberately) and `blockIndex` advances.
 *
 * `slotVariants` maps a stable slot-fill key (`"<day>:<slot>:<index>"`) to the chosen
 * exercise id, so sessions are reproducible within a block and rotation is auditable —
 * never accidentally repeating a stale block.
 */
export interface BlockState {
  athleteId: string;
  blockStartDate: string; // ISO date the current block began
  blockIndex: number; // 0-based; increments each rotation
  slotVariants: Record<string, string>; // slotKey -> exerciseId
  /**
   * The athlete's active training split (2/3/4-day). Additive & optional: absent on legacy
   * records, which `splitOf` treats as `4day` (the full split). Lives here rather than on the
   * profile because switching split is a rotation event — it resets or carries block state — and
   * `slotVariants` are day-keyed, so split and rotation state stay coupled in one record.
   */
  activeSplit?: SplitChoice;
}

/**
 * One quarterly standing-height entry (spec §7 maturity axis). The MATURITY axis is
 * computed from this log and governs DOSE only — it must NEVER change the tier (§3.1).
 */
export interface HeightLogEntry {
  athleteId: string;
  date: string; // ISO date
  heightCm: number; // standing height
  /**
   * Sitting height (cm), tracked quarterly alongside standing height (spec §7 /
   * COACHING_INSTRUCTIONS "MATURITY MONITORING"). Feeds the Moore/Fransen maturity-offset
   * estimate for boys. Optional — older entries and standing-only measures leave it null.
   */
  sittingHeightCm?: number | null;
  /** 'assessment' if this entry was dual-written from an assessment (contract rule 4). */
  source: 'assessment' | 'manual';
}

/**
 * One brief weekly wellness / load check (COACHING_INSTRUCTIONS "MATURITY MONITORING"): a
 * lightweight self-report to watch load and growth-related niggles (Osgood-Schlatter / Sever's
 * cluster around PHV). All fields optional so a check can be as quick as one number.
 */
export interface WellnessLogEntry {
  athleteId: string;
  date: string; // ISO date
  sleepHours?: number | null;
  /** 1 (fresh) – 5 (very sore). */
  soreness?: number | null;
  /** 1 (flat) – 5 (great). */
  energy?: number | null;
  /** Free-text: niggles, growth-plate soreness (knee/heel), mood, etc. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Workout log (BUILD_BRIEF §4 — sessions served + completion / coach notes)
// ---------------------------------------------------------------------------

export interface WorkoutLogEntry {
  workoutId: string; // uuid
  athleteId: string;
  date: string; // ISO date served
  /** The tier the session was assembled for (snapshot — tiers re-tier over time, §3.6). */
  servedForTier: Tier;
  /** Identifier of the assembled session shape (e.g. day label / template id). */
  sessionLabel: string;
  completed: boolean;
  coachNotes: string;
}

/**
 * Snapshot of an exercise's PRESCRIBED target, copied onto a set record at log time
 * (PHASE_PLAN_workout_logging.md §"performance + reliability"). Stored — never re-joined to the
 * live assembler output — so a later library/dose edit can't silently rewrite what an athlete was
 * actually prescribed months ago. `reps` mirrors the library `TierDose.reps`, which may be a
 * number OR a string ("15yd", "6 ea").
 */
export interface PrescribedSnapshot {
  sets?: number;
  reps?: number | string;
  rest_sec?: number;
}

/**
 * One logged SET of one exercise in one session — the per-set actuals record
 * (PHASE_PLAN_workout_logging.md). Granularity is PER SET by design (set 1 and set 2 are
 * separate records); it is the only shape that supports typed, comparable PRs/trends.
 *
 * `values` keys off the exercise's declared `metrics` (engine/metrics.ts) — no fixed
 * weight/time/distance columns — so a new measurement is additive (a catalog entry), never a
 * schema migration. Each value is stored in that metric's CANONICAL unit (load in lb, etc.);
 * mixing units within a metric's history breaks every trend silently, so conversion (if ever
 * needed) happens at display, never at storage.
 *
 * This is build #1's schema AND the future app's — durable core, like the rest of this file.
 */
export interface SetLogEntry {
  setLogId: string; // uuid
  /** Links to the session this set belongs to (WorkoutLogEntry.workoutId). */
  workoutId: string;
  athleteId: string; // uuid
  /** Library exercise id (Exercise.id) — the movement this set logs. */
  exerciseId: string;
  /** 1-based set number within the exercise. */
  setIndex: number;
  /** Typed actuals keyed by metric id, e.g. `{ load: 42.5, reps: 3 }`. Canonical units. */
  values: Record<string, number>;
  /** The target as it was at log time (see {@link PrescribedSnapshot}) — stored, not re-joined. */
  prescribed?: PrescribedSnapshot;
  /** Optional subjective load, RPE 1–10. Additive/reserved — safe to omit (defer per plan). */
  rpe?: number;
  note?: string;
  loggedAt: string; // ISO datetime
}

// ---------------------------------------------------------------------------
// Visibility — §3.3, baked in now so it is never retrofitted
// ---------------------------------------------------------------------------

/**
 * §3.3 — tier labels and raw scores are NON-USER-FACING. Mark any value with who is
 * allowed to see it so the future app cannot accidentally surface a tier/score to an
 * athlete or parent. The tool may show `coach` data to the coach; an athlete-facing
 * surface must filter to `athlete`.
 *
 *   coach   — coach-only: tier labels, raw scores, gate_fired, gut-call, validation data
 *   athlete — safe for athlete/parent: "today's workout", positive improvement-framed feedback
 */
export type Audience = 'coach' | 'athlete';

/** Fields that are coach-only by policy (§3.3). Single source of truth for the UI filter. */
export const COACH_ONLY_FIELDS = [
  'rawTotal',
  'baseTier',
  'finalTier',
  'gateFired',
  'coachGutCall',
  'scores',
] as const;

/** True if a given field is safe to show to the named audience (§3.3). */
export function isVisibleTo(field: string, audience: Audience): boolean {
  if (audience === 'coach') return true;
  return !(COACH_ONLY_FIELDS as readonly string[]).includes(field);
}

// ---------------------------------------------------------------------------
// Validators / guards
// ---------------------------------------------------------------------------

export function isTestScore(n: unknown): n is TestScore {
  return n === 0 || n === 1 || n === 2 || n === 3;
}

export function isTier(s: unknown): s is Tier {
  return s === 'C' || s === 'B' || s === 'A' || s === 'S';
}

export function isSplitChoice(s: unknown): s is SplitChoice {
  return s === '2day' || s === '3day' || s === '4day';
}
