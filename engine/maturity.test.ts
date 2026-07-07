/** Maturity axis tests (spec §7) — pure height-velocity → dose-pullback flag, tier-independent. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeMaturity, PHV_FLAG_CM_PER_YEAR } from './maturity.ts';
import type { HeightLogEntry } from './types.ts';

function h(date: string, heightCm: number): HeightLogEntry {
  return { athleteId: 'a', date, heightCm, source: 'manual' };
}

test('no entries → no signal', () => {
  const m = computeMaturity([]);
  assert.equal(m.latestHeightCm, null);
  assert.equal(m.velocityCmPerYear, null);
  assert.equal(m.nearPHV, false);
});

test('one entry → height but no velocity', () => {
  const m = computeMaturity([h('2026-01-01', 140)]);
  assert.equal(m.latestHeightCm, 140);
  assert.equal(m.velocityCmPerYear, null);
  assert.equal(m.nearPHV, false);
});

test('steady growth below threshold → not flagged', () => {
  // +1.5 cm over ~3 months ≈ 6 cm/yr (< 7).
  const m = computeMaturity([h('2026-01-01', 140), h('2026-04-01', 141.5)]);
  assert.ok(m.velocityCmPerYear !== null && m.velocityCmPerYear < PHV_FLAG_CM_PER_YEAR);
  assert.equal(m.nearPHV, false);
});

test('rapid growth at/above threshold → PHV flag + dose pullback note', () => {
  // +2.5 cm over ~3 months ≈ 10 cm/yr (>= 7).
  const m = computeMaturity([h('2026-01-01', 150), h('2026-04-01', 152.5)]);
  assert.ok(m.velocityCmPerYear !== null && m.velocityCmPerYear >= PHV_FLAG_CM_PER_YEAR);
  assert.equal(m.nearPHV, true);
  assert.match(m.note, /DOSE PULLBACK/);
  assert.match(m.note, /NOT change tier/);
});

test('uses the two most recent entries', () => {
  const m = computeMaturity([h('2025-01-01', 130), h('2026-01-01', 145), h('2026-04-01', 145.5)]);
  // Latest interval is slow (+0.5 over 3mo ≈ 2 cm/yr), so not flagged despite the earlier fast year.
  assert.equal(m.latestHeightCm, 145.5);
  assert.equal(m.nearPHV, false);
});

// --- Maturity-offset estimate (Moore/Fransen 2015) ---

function hs(date: string, heightCm: number, sittingHeightCm: number): HeightLogEntry {
  return { athleteId: 'a', date, heightCm, sittingHeightCm, source: 'manual' };
}

test('boys: PRE-PHV estimate (young + short sitting height)', () => {
  const m = computeMaturity([hs('2026-01-01', 135, 68)], { dob: '2017-01-01', sex: 'M' }); // ~age 9
  assert.equal(m.phvBand, 'pre');
  assert.ok(m.maturityOffsetYears !== null && m.maturityOffsetYears < -1);
  assert.equal(m.method, 'Moore2015-male');
  assert.ok(m.estimatedAgeAtPHV !== null);
});

test('boys: CIRCA-PHV estimate lands in the ±1yr window', () => {
  // Tuned so age × sitting ≈ 8.128741 / 0.0070346 ≈ 1155 → offset ≈ 0.
  const m = computeMaturity([hs('2026-01-01', 162, 89)], { dob: '2013-01-01', sex: 'M' }); // ~age 13
  assert.equal(m.phvBand, 'circa');
  assert.ok(m.maturityOffsetYears !== null && Math.abs(m.maturityOffsetYears) <= 1);
  assert.match(m.note, /CIRCA-PHV/);
});

test('boys: POST-PHV estimate (older + tall sitting height)', () => {
  const m = computeMaturity([hs('2026-01-01', 178, 95)], { dob: '2011-01-01', sex: 'M' }); // ~age 15
  assert.equal(m.phvBand, 'post');
  assert.ok(m.maturityOffsetYears !== null && m.maturityOffsetYears > 1);
});

test('girls: estimate uses standing height (sitting height not required)', () => {
  const m = computeMaturity([h('2026-01-01', 150)], { dob: '2014-01-01', sex: 'F' }); // ~age 12
  assert.ok(m.maturityOffsetYears !== null, 'female equation needs only standing height');
  assert.equal(m.method, 'Moore2015-female');
});

test('no estimate without sex', () => {
  const m = computeMaturity([hs('2026-01-01', 150, 80)], { dob: '2014-01-01' });
  assert.equal(m.maturityOffsetYears, null);
  assert.match(m.method ?? '', /sex/);
});

test('no estimate for boys without a sitting height', () => {
  const m = computeMaturity([h('2026-01-01', 150)], { dob: '2014-01-01', sex: 'M' });
  assert.equal(m.maturityOffsetYears, null);
  assert.match(m.method ?? '', /sitting height/);
});

test('estimate works from a single entry (no velocity needed)', () => {
  const m = computeMaturity([hs('2026-01-01', 135, 68)], { dob: '2017-01-01', sex: 'M' });
  assert.equal(m.velocityCmPerYear, null); // one entry
  assert.ok(m.maturityOffsetYears !== null); // estimate still available
});

test('malformed DOB yields NO estimate — never a bogus NaN circa-PHV (A2)', () => {
  for (const dob of ['not-a-date', '2014-3-5', '03/14/2014', '2014-13-40']) {
    const m = computeMaturity([hs('2026-01-01', 150, 80)], { dob, sex: 'M' });
    assert.equal(m.maturityOffsetYears, null, `offset null for ${dob}`);
    assert.equal(m.phvBand, null, `no band for ${dob}`);
    assert.doesNotMatch(m.note, /NaN/, `note has no NaN for ${dob}`);
    assert.doesNotMatch(m.note, /CIRCA-PHV/, `no false circa-PHV for ${dob}`);
  }
});

test('malformed entry date does not produce a NaN velocity (A2)', () => {
  const m = computeMaturity(
    [{ athleteId: 'a', date: '2025-13-99', heightCm: 140, source: 'manual' }, h('2026-04-01', 150)],
    {},
  );
  // Whatever the sort does with a bad date, velocity must be null (not NaN), never PHV-flagged.
  assert.equal(m.velocityCmPerYear, null);
  assert.equal(m.nearPHV, false);
  assert.doesNotMatch(m.note, /NaN/);
});
