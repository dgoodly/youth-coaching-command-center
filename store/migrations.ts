/**
 * Record-shape migrations — ONE pure function per shape change, carried by two vehicles:
 * `cli/migrate.ts` for disk JSON, and `store/idb.ts`'s `onupgradeneeded` for IndexedDB.
 * Browser-portable: no Node imports, ever.
 *
 * ## v1 → v2: the S4 assessment reshape (brief §5.1)
 *
 * Grandfathering (decided in the S4 kickoff, not a default):
 *  - `scoresLive = scores`, `scoresReviewed = null` — NOT `scores`: pre-S4 assessments were
 *    never reviewed, and marking them reviewed would make the live→reviewed calibration
 *    delta lie about assessments nobody looked at twice.
 *  - `provisional = false` — these records predate the concept; marking them provisional
 *    would silently cap every athlete on the roster.
 *  - `rawTotal`/`baseTier`/`finalTier`/`gateFired` are kept AS STORED — grandfathered
 *    records keep the tiers they were actually routed on. Recomputing under the §4.4
 *    rules would retroactively re-tier the roster, which grandfathering exists to forbid.
 *  - `videoRefs` must be empty (verified against every real and seed record). It was an
 *    unordered bag; a non-empty one cannot be keyed by test, so the migration THROWS
 *    rather than silently dropping a reference to a child's film.
 */

import type { Assessment, Scores, Tier, GateFired, PaperMismatch } from '../engine/types.ts';

/** The pre-S4 assessment shape (schema v1), as it exists in old data files / databases. */
interface AssessmentV1 {
  assessmentId: string;
  athleteId: string;
  date: string;
  tester: string;
  scores: Scores;
  rawTotal: number;
  baseTier: Tier;
  finalTier: Tier;
  gateFired: GateFired;
  coachGutCall: Tier | null;
  heightCm: number | null;
  videoRefs: string[];
  notes: string;
  paperMismatch?: PaperMismatch;
}

/** Is this record still the pre-S4 shape? (v2 records have `scoresLive`, never `scores`.) */
export function isLegacyAssessment(record: unknown): record is AssessmentV1 {
  return (
    typeof record === 'object' &&
    record !== null &&
    'scores' in record &&
    !('scoresLive' in record)
  );
}

/**
 * Migrate one v1 assessment to the v2 shape. Idempotent at the caller level: feed it only
 * records {@link isLegacyAssessment} matched. Throws on a non-empty `videoRefs` — see the
 * module doc; loud beats lossy.
 */
export function migrateAssessmentRecord(old: AssessmentV1): Assessment {
  if (old.videoRefs.length > 0) {
    throw new Error(
      `migrate: assessment ${old.assessmentId} has ${old.videoRefs.length} videoRefs entr` +
        `${old.videoRefs.length === 1 ? 'y' : 'ies'}. An unordered videoRefs bag cannot be keyed ` +
        `by test — resolve these by hand before migrating (they may reference films of a child).`,
    );
  }
  const { scores, videoRefs: _dropped, ...rest } = old;
  return {
    ...rest,
    scoresLive: scores,
    scoresReviewed: null,
    reviewedAt: null,
    reviewedBy: null,
    provisional: false, // grandfathered — predates the concept
    films: {},
    // filmsPurgeAt intentionally absent: no films exist to purge.
  };
}
