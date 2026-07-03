/**
 * Query tests — the pure `resolveAthleteIn` id/name resolver (issue #5), especially that
 * "ambiguous" is reported distinctly from "not found". No I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAthleteIn } from './query.ts';
import type { AthleteProfile } from '../engine/types.ts';

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
