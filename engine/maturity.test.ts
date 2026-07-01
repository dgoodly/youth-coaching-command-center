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
