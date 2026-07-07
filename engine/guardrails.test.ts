/**
 * Volume-guardrail tests (COACHING_INSTRUCTIONS "SAFETY / DON'T") — pure, tier-independent.
 * Covers the three rules and the "unknown when data missing" behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkVolumeGuardrails, INTENSE_SPORT_HOURS_CAP, type GuardrailRule, type GuardrailStatus } from './guardrails.ts';

function statusOf(rep: ReturnType<typeof checkVolumeGuardrails>, rule: GuardrailRule): GuardrailStatus {
  return rep.findings.find((f) => f.rule === rule)!.status;
}

test('weekly hours ≤ age: within, near, and over', () => {
  // 12yo, 6 sport + 4 training = 10 ≤ 12 → ok.
  assert.equal(statusOf(checkVolumeGuardrails({ age: 12, weeklySportHours: 6, weeklyTrainingHours: 4 }), 'weekly_hours_vs_age'), 'ok');
  // 12yo, 11 total (> age-2=10) → watch.
  assert.equal(statusOf(checkVolumeGuardrails({ age: 12, weeklySportHours: 8, weeklyTrainingHours: 3 }), 'weekly_hours_vs_age'), 'watch');
  // 12yo, 15 total > 12 → exceeded.
  assert.equal(statusOf(checkVolumeGuardrails({ age: 12, weeklySportHours: 12, weeklyTrainingHours: 3 }), 'weekly_hours_vs_age'), 'exceeded');
});

test('weekly hours vs age is unknown unless age AND both hour fields are present (A3)', () => {
  assert.equal(statusOf(checkVolumeGuardrails({ age: null, weeklySportHours: 10, weeklyTrainingHours: 2 }), 'weekly_hours_vs_age'), 'unknown');
  assert.equal(statusOf(checkVolumeGuardrails({ age: 12 }), 'weekly_hours_vs_age'), 'unknown');
  // Only one hour field present → unknown, NOT a false "ok" from treating the other as 0.
  assert.equal(statusOf(checkVolumeGuardrails({ age: 10, weeklySportHours: null, weeklyTrainingHours: 4 }), 'weekly_hours_vs_age'), 'unknown');
  assert.equal(statusOf(checkVolumeGuardrails({ age: 10, weeklySportHours: 6 }), 'weekly_hours_vs_age'), 'unknown');
  // A real 0 is recorded explicitly and DOES evaluate.
  assert.equal(statusOf(checkVolumeGuardrails({ age: 10, weeklySportHours: 6, weeklyTrainingHours: 0 }), 'weekly_hours_vs_age'), 'ok');
});

test('intense-sport cap fires at/above the cap', () => {
  assert.equal(statusOf(checkVolumeGuardrails({ age: 14, weeklySportHours: INTENSE_SPORT_HOURS_CAP }), 'intense_sport_cap'), 'exceeded');
  assert.equal(statusOf(checkVolumeGuardrails({ age: 14, weeklySportHours: 14 }), 'intense_sport_cap'), 'watch'); // ≥ 13
  assert.equal(statusOf(checkVolumeGuardrails({ age: 14, weeklySportHours: 8 }), 'intense_sport_cap'), 'ok');
  assert.equal(statusOf(checkVolumeGuardrails({ age: 14 }), 'intense_sport_cap'), 'unknown');
});

test('rest days: below 1 exceeded, below 2 watch, ≥2 ok', () => {
  assert.equal(statusOf(checkVolumeGuardrails({ age: 12, restDaysPerWeek: 0 }), 'rest_days'), 'exceeded');
  assert.equal(statusOf(checkVolumeGuardrails({ age: 12, restDaysPerWeek: 1 }), 'rest_days'), 'watch');
  assert.equal(statusOf(checkVolumeGuardrails({ age: 12, restDaysPerWeek: 2 }), 'rest_days'), 'ok');
  assert.equal(statusOf(checkVolumeGuardrails({ age: 12 }), 'rest_days'), 'unknown');
});

test('report roll-ups: anyExceeded / anyWatch', () => {
  const over = checkVolumeGuardrails({ age: 10, weeklySportHours: 18, weeklyTrainingHours: 4, restDaysPerWeek: 0 });
  assert.equal(over.anyExceeded, true);
  const clean = checkVolumeGuardrails({ age: 14, weeklySportHours: 6, weeklyTrainingHours: 3, restDaysPerWeek: 2 });
  assert.equal(clean.anyExceeded, false);
  assert.equal(clean.anyWatch, false);
  assert.equal(clean.findings.every((f) => f.status === 'ok'), true);
});
