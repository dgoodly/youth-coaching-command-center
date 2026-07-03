/**
 * Store doctor — diagnostic + repair for data-integrity gaps the store can accumulate.
 * Disposable surface; the scan functions are PURE so they unit-test without any I/O (the CLI
 * `cli/doctor.ts` wires them to the JSON store).
 *
 * v1 checks ONE invariant: every assessment carrying a `heightCm` must have a matching
 * `height_log` entry (contract rule 4's dual-write). `store/ingest.ts::saveAssessment` appends
 * the assessment and the height entry in two independent writes — a crash between them drops the
 * height entry silently, under-feeding the maturity axis with no error anywhere. This finds and
 * (via the CLI's --fix) backfills those gaps.
 */

import type { Assessment, HeightLogEntry } from '../engine/types.ts';

export interface HeightGap {
  assessmentId: string;
  athleteId: string;
  date: string;
  heightCm: number;
}

/** A height matches the log if athleteId + date + heightCm all agree (the dual-write's key). */
function hasMatchingHeightEntry(a: Assessment, heightLog: HeightLogEntry[]): boolean {
  return heightLog.some(
    (h) => h.athleteId === a.athleteId && h.date === a.date && h.heightCm === a.heightCm,
  );
}

/**
 * Assessments that carry a (non-null) height which never made it into the height log — i.e. a
 * dropped dual-write. Assessments with `heightCm === null` are skipped (no dual-write was owed).
 */
export function findHeightLogGaps(
  assessments: Assessment[],
  heightLog: HeightLogEntry[],
): HeightGap[] {
  const gaps: HeightGap[] = [];
  for (const a of assessments) {
    if (a.heightCm === null || a.heightCm === undefined) continue;
    if (!hasMatchingHeightEntry(a, heightLog)) {
      gaps.push({ assessmentId: a.assessmentId, athleteId: a.athleteId, date: a.date, heightCm: a.heightCm });
    }
  }
  return gaps;
}

/** Build the height-log entries that close the given gaps (source 'assessment', per rule 4). */
export function backfillEntriesFor(gaps: HeightGap[]): HeightLogEntry[] {
  return gaps.map((g) => ({
    athleteId: g.athleteId,
    date: g.date,
    heightCm: g.heightCm,
    source: 'assessment' as const,
  }));
}
