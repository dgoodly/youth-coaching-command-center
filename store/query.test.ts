/**
 * Query tests — the pure `resolveAthleteIn` id/name resolver (issue #5), especially that
 * "ambiguous" is reported distinctly from "not found". No I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAthleteIn, groupSetsByExercise, resolveTrackDay, parseDayLabel, type TrackSession } from './query.ts';
import type { AthleteProfile, SetLogEntry } from '../engine/types.ts';

function mkAthlete(over: Partial<AthleteProfile> & { athleteId: string; displayName: string }): AthleteProfile {
  return {
    dob: null, sports: [], trainingMonths: 0, valgusWatch: false,
    createdAt: '2026-01-01T00:00:00Z', notes: '', ...over,
  };
}

const roster: AthleteProfile[] = [
  mkAthlete({ athleteId: 'id-1', displayName: 'Jordan Ellis' }),
  mkAthlete({ athleteId: 'id-2', displayName: 'Jordan Nguyen' }),
  mkAthlete({ athleteId: 'id-3', displayName: 'Casey Park' }),
];

test('resolves an exact athleteId', () => {
  const r = resolveAthleteIn(roster, 'id-3');
  assert.equal(r.status, 'found');
  assert.equal(r.status === 'found' && r.athlete.displayName, 'Casey Park');
});

test('resolves an exact display name (case-insensitive)', () => {
  const r = resolveAthleteIn(roster, 'casey park');
  assert.equal(r.status, 'found');
  assert.equal(r.status === 'found' && r.athlete.athleteId, 'id-3');
});

test('ambiguous: a partial name matching two athletes reports candidates, not not_found', () => {
  const r = resolveAthleteIn(roster, 'Jordan');
  assert.equal(r.status, 'ambiguous');
  assert.deepEqual(
    r.status === 'ambiguous' && r.candidates.map((a) => a.athleteId).sort(),
    ['id-1', 'id-2'],
  );
});

test('not_found: no id or name match', () => {
  assert.equal(resolveAthleteIn(roster, 'Taylor').status, 'not_found');
});

test('exact name wins over a substring collision (Jordan Ellis vs Jordan Nguyen)', () => {
  // "Jordan Ellis" is an exact match even though "Jordan" alone would be ambiguous.
  const r = resolveAthleteIn(roster, 'Jordan Ellis');
  assert.equal(r.status, 'found');
  assert.equal(r.status === 'found' && r.athlete.athleteId, 'id-1');
});

function mkSet(exerciseId: string, setIndex: number): SetLogEntry {
  return { setLogId: `${exerciseId}-${setIndex}`, workoutId: 'w1', athleteId: 'a1', exerciseId,
    setIndex, values: {}, loggedAt: '2026-07-09T12:00:00.000Z' };
}

test('groupSetsByExercise groups by exercise, preserving first-seen order (Phase B)', () => {
  const grouped = groupSetsByExercise([
    mkSet('squat', 1), mkSet('broad', 1), mkSet('squat', 2), mkSet('broad', 2), mkSet('squat', 3),
  ]);
  assert.deepEqual([...grouped.keys()], ['squat', 'broad'], 'first-seen exercise order');
  assert.deepEqual(grouped.get('squat')!.map((s) => s.setIndex), [1, 2, 3], 'all squat sets, in order');
  assert.deepEqual(grouped.get('broad')!.map((s) => s.setIndex), [1, 2]);
});

test('groupSetsByExercise on an empty list yields an empty map (Phase B)', () => {
  assert.equal(groupSetsByExercise([]).size, 0);
});

// --- Track-workout default-day resolution (Step 3), pure. `sessions` are most-recent first. ---

test('parseDayLabel reads the day number back from a session label', () => {
  assert.equal(parseDayLabel('Day 1'), 1);
  assert.equal(parseDayLabel('Day 4'), 4);
  assert.equal(parseDayLabel('day 2'), 2); // case-insensitive
  assert.equal(parseDayLabel('Rest'), null);
});

test('resolveTrackDay: no prior sessions defaults to the first day of the split', () => {
  assert.equal(resolveTrackDay([1, 2, 3, 4], []), 1);
  assert.equal(resolveTrackDay([1, 2, 4], []), 1);
});

test('resolveTrackDay advances past the most recent finished session, wrapping', () => {
  const finished = (day: number): TrackSession => ({ day, inProgress: false });
  assert.equal(resolveTrackDay([1, 2, 3, 4], [finished(1)]), 2, 'after Day 1 -> Day 2');
  assert.equal(resolveTrackDay([1, 2, 3, 4], [finished(4)]), 1, 'after Day 4 wraps to Day 1');
  assert.equal(resolveTrackDay([1, 2, 4], [finished(2)]), 4, '3-day split: after Day 2 -> Day 4');
});

test('resolveTrackDay opens an unfinished most-recent session on ITS day, not the next', () => {
  assert.equal(resolveTrackDay([1, 2, 3, 4], [{ day: 2, inProgress: true }]), 2,
    'you do not skip a workout you have not finished');
});

test('resolveTrackDay: a later finished session wins over an older abandoned in-progress one', () => {
  // most-recent first: Day 3 finished, then an older Day 2 still open. Advance from Day 3.
  const sessions: TrackSession[] = [{ day: 3, inProgress: false }, { day: 2, inProgress: true }];
  assert.equal(resolveTrackDay([1, 2, 3, 4], sessions), 4);
});

test('resolveTrackDay clamps an in-progress day that fell out of the current split', () => {
  // Session is open on Day 4, but the split shrank to 2-day [1,2]; clamp forward (wrap) to Day 1.
  assert.equal(resolveTrackDay([1, 2], [{ day: 4, inProgress: true }]), 1);
});
