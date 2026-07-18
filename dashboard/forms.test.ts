/**
 * Dashboard write-surface form tests (Phase 2). Pure — no server boot, no I/O.
 * Covers server-side validation (bad input is rejected with per-field errors, never a crash
 * or a bad record), the XSS-escaping discipline on browser-sourced strings, the gut-call-
 * before-reveal boundary, and that the form path produces exactly the record the CLI would.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateAthleteForm, athleteFormPage, emptyAthleteValues,
  validateAssessmentForm, assessmentFormPage, assessmentRevealPage, emptyAssessmentValues,
  assessmentValuesFromParams,
  validateSplitSwitch, splitSwitchForm,
  validateLogForm, logFormPage, emptyLogValues, logValuesFromParams, resolveMetrics,
  type AthleteFormValues, type LogFormValues, type LogFormContext,
} from './forms.ts';
import { buildAssessmentRecord, type FieldFormInput } from '../store/ingest.ts';
import type { AthleteProfile, Scores } from '../engine/types.ts';

function athleteValues(over: Partial<AthleteFormValues> = {}): AthleteFormValues {
  return { ...emptyAthleteValues(), displayName: 'Maya R.', ...over };
}
function mkAthlete(over: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    athleteId: 'ath-1', displayName: 'Maya R.', dob: '2014-05-01', sex: 'F', sports: ['soccer'],
    trainingMonths: 6, valgusWatch: false, weeklySportHours: null, weeklyTrainingHours: null,
    restDaysPerWeek: null, createdAt: '2026-01-01T00:00:00Z', notes: '', ...over,
  };
}

// --- athlete validation ---

test('athlete: missing name is rejected with a field error (no input built)', () => {
  const { input, errors } = validateAthleteForm(athleteValues({ displayName: '' }));
  assert.equal(input, null);
  assert.ok(errors.displayName);
});

test('athlete: a nonsense date is rejected (2026-13-40)', () => {
  const { input, errors } = validateAthleteForm(athleteValues({ dob: '2026-13-40' }));
  assert.equal(input, null);
  assert.ok(errors.dob);
});

test('athlete: a future date of birth is rejected', () => {
  const { input, errors } = validateAthleteForm(athleteValues({ dob: '2999-01-01' }));
  assert.equal(input, null);
  assert.ok(errors.dob);
});

test('athlete: out-of-range training load is rejected', () => {
  const { input, errors } = validateAthleteForm(athleteValues({ weeklySportHours: '200' }));
  assert.equal(input, null);
  assert.ok(errors.weeklySportHours);
});

test('athlete: valid input is parsed into a store record (sports split, sex, flags)', () => {
  const { input, errors } = validateAthleteForm(athleteValues({
    dob: '2014-05-01', sex: 'F', sports: 'soccer, track ,', trainingMonths: '6',
    valgusWatch: true, restDaysPerWeek: '2',
  }));
  assert.deepEqual(errors, {});
  assert.ok(input);
  assert.equal(input!.displayName, 'Maya R.');
  assert.equal(input!.dob, '2014-05-01');
  assert.equal(input!.sex, 'F');
  assert.deepEqual(input!.sports, ['soccer', 'track']); // trimmed, blanks dropped
  assert.equal(input!.trainingMonths, 6);
  assert.equal(input!.valgusWatch, true);
  assert.equal(input!.restDaysPerWeek, 2);
});

// --- assessment validation ---

function assessmentParams(over: Record<string, string> = {}): URLSearchParams {
  const base: Record<string, string> = {
    date: '2026-07-01', tester: 'Coach',
    squat: '2', dropStick: '3', balance: '2', pushup: '3', broad: '2', pogo: '2',
    coachGutCall: 'A', heightCm: '150', sittingHeightCm: '80',
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) p.set(k, v);
  return p;
}

test('assessment: an out-of-range score is rejected (4 is not 0–3)', () => {
  const values = assessmentValuesFromParams(assessmentParams({ squat: '4' }));
  const { input, errors } = validateAssessmentForm('ath-1', values);
  assert.equal(input, null);
  assert.ok(errors.squat);
});

test('assessment: a missing score is rejected', () => {
  const values = assessmentValuesFromParams(assessmentParams({ pogo: '' }));
  const { input, errors } = validateAssessmentForm('ath-1', values);
  assert.equal(input, null);
  assert.ok(errors.pogo);
});

test('assessment: a future assessment date and missing tester are both rejected', () => {
  const values = assessmentValuesFromParams(assessmentParams({ date: '2999-01-01', tester: '' }));
  const { input, errors } = validateAssessmentForm('ath-1', values);
  assert.equal(input, null);
  assert.ok(errors.date);
  assert.ok(errors.tester);
});

test('assessment: an empty gut-call is allowed and yields null (optional validation field)', () => {
  const values = assessmentValuesFromParams(assessmentParams({ coachGutCall: '' }));
  const { input } = validateAssessmentForm('ath-1', values);
  assert.ok(input);
  assert.equal(input!.coachGutCall, null);
});

test('assessment: the form path produces exactly the FieldFormInput + record the CLI would', () => {
  const values = assessmentValuesFromParams(assessmentParams());
  const { input } = validateAssessmentForm('ath-1', values);
  assert.ok(input);

  const scores: Scores = { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 };
  const cliInput: Omit<FieldFormInput, 'priorTier'> = {
    athleteId: 'ath-1', date: '2026-07-01', tester: 'Coach', scores,
    broadLandingFailed: false, coachGutCall: 'A', heightCm: 150, sittingHeightCm: 80,
    notes: '',
  };
  assert.deepEqual(input, cliInput, 'form yields the same input a CLI transcription would');

  // And through the trusted ingest path, the same stored record (tier recomputed by the
  // engine). priorTier is the server's to add — supplied here as the server would.
  const fromForm = buildAssessmentRecord({ ...input!, priorTier: null });
  const fromCli = buildAssessmentRecord({ ...cliInput, priorTier: null });
  const { assessmentId: _a, ...formRec } = fromForm.assessment;
  const { assessmentId: _b, ...cliRec } = fromCli.assessment;
  assert.deepEqual(formRec, cliRec);
  assert.equal(fromForm.assessment.finalTier, 'A'); // engine is the source of truth, not the form
});

// --- XSS / escaping ---

test('XSS: a <script> in an athlete name renders inert in the edit form', () => {
  const html = athleteFormPage('edit', athleteValues({ displayName: '<script>alert(1)</script>' }), {}, 'ath-1');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'name is HTML-escaped');
});

test('XSS: a malicious notes value in the reveal page is escaped', () => {
  const athlete = mkAthlete({ displayName: '<img src=x onerror=alert(1)>' });
  const built = buildAssessmentRecord({
    athleteId: 'ath-1', date: '2026-07-01', tester: 'Coach',
    scores: { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 },
    coachGutCall: 'A', priorTier: null, heightCm: 150,
  });
  const html = assessmentRevealPage(athlete, built.warnings, built.assessment);
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

// --- gut-call-before-reveal boundary (§3.7) ---

test('gut-call-before-reveal: the entry form never shows a computed tier', () => {
  const html = assessmentFormPage(mkAthlete(), emptyAssessmentValues(), {});
  // The form collects scores + gut-call only; a computed tier BADGE appears solely on the reveal
  // page. (The form's instructional copy may mention the words "computed tier" — what must be
  // absent is an actual rendered tier value.)
  assert.ok(!html.includes('class="tier tier-'), 'no tier badge rendered next to the score inputs');
  assert.ok(html.includes('gut-call'), 'the gut-call field is present');
});

// --- split switch (Phase 3) ---

test('split switch: a valid split + mode is parsed', () => {
  const p = new URLSearchParams({ split: '2day', mode: 'fresh' });
  assert.deepEqual(validateSplitSwitch(p), { split: '2day', mode: 'fresh' });
});

test('split switch: an unknown split or mode is rejected (null, never a bad write)', () => {
  assert.equal(validateSplitSwitch(new URLSearchParams({ split: '5day', mode: 'fresh' })), null);
  assert.equal(validateSplitSwitch(new URLSearchParams({ split: '3day', mode: 'wipe' })), null);
  assert.equal(validateSplitSwitch(new URLSearchParams({ mode: 'carry' })), null);
});

test('split switch form pre-selects the athlete current split and defaults to a fresh block', () => {
  const html = splitSwitchForm('ath-1', '3day');
  assert.ok(html.includes('<option value="3day" selected>'), 'current split pre-selected');
  assert.ok(!html.includes('<option value="2day" selected>'));
  assert.ok(/name="mode" value="fresh" checked/.test(html), 'fresh is the default block treatment');
  assert.ok(html.includes('action="/athlete/split?id=ath-1"'));
});

test('reveal page shows the computed tier (the reveal happens only after save)', () => {
  const built = buildAssessmentRecord({
    athleteId: 'ath-1', date: '2026-07-01', tester: 'Coach',
    scores: { squat: 2, dropStick: 3, balance: 2, pushup: 3, broad: 2, pogo: 2 },
    coachGutCall: 'A', priorTier: null, heightCm: 150,
  });
  const html = assessmentRevealPage(mkAthlete(), built.warnings, built.assessment);
  assert.ok(/Computed tier/i.test(html));
  assert.ok(html.includes('class="tier tier-A"'));
});

// --- per-set workout logging (Phase C) ---

/** Build LogFormValues from row objects (metricId → raw string). */
function logValues(over: Partial<LogFormValues> & { sets: LogFormValues['sets'] }): LogFormValues {
  return { date: '2026-07-09', ...over };
}
function row(values: Record<string, string>, note = ''): LogFormValues['sets'][number] {
  return { values, note };
}

test('log: a squat log (load + reps) parses to typed sets, oldest-first indexed', () => {
  const { sets, errors } = validateLogForm(['load', 'reps'], logValues({
    sets: [row({ load: '40', reps: '5' }), row({ load: '42.5', reps: '5' }, 'felt heavy')],
  }));
  assert.deepEqual(errors, {});
  assert.ok(sets);
  assert.deepEqual(sets!.map((s) => s.setIndex), [1, 2]);
  assert.deepEqual(sets![0]!.values, { load: 40, reps: 5 });
  assert.equal(sets![1]!.values.load, 42.5, 'decimal load kept');
  assert.equal(sets![1]!.note, 'felt heavy');
});

test('log: fully-empty rows are skipped (added-then-blank), but at least one set is required', () => {
  const ok = validateLogForm(['load', 'reps'], logValues({
    sets: [row({ load: '40', reps: '5' }), row({ load: '', reps: '' })],
  }));
  assert.deepEqual(ok.sets!.map((s) => s.setIndex), [1], 'blank trailing row dropped');

  const none = validateLogForm(['load', 'reps'], logValues({ sets: [row({ load: '', reps: '' })] }));
  assert.equal(none.sets, null);
  assert.ok(none.errors._sets, 'requires at least one non-empty set');
});

test('log: server-side typing rejects a negative sprint time and a non-integer rep count', () => {
  const neg = validateLogForm(['time_s'], logValues({ sets: [row({ time_s: '-1' })] }));
  assert.equal(neg.sets, null);
  assert.match(neg.errors.set0!, /negative/);

  const frac = validateLogForm(['load', 'reps'], logValues({ sets: [row({ load: '40', reps: '4.5' })] }));
  assert.equal(frac.sets, null);
  assert.match(frac.errors.set0!, /whole number/);
});

test('log: a future log date is rejected', () => {
  const r = validateLogForm(['reps'], logValues({ date: '2999-01-01', sets: [row({ reps: '10' })] }));
  assert.equal(r.sets, null);
  assert.ok(r.errors.date);
});

test('log form renders exactly the inputs an exercise declares (metrics-driven, not hardcoded)', () => {
  const squatCtx: LogFormContext = {
    athleteId: 'ath-1', day: 1, exerciseId: 'l_goblet_squat', exerciseName: 'Goblet Squat',
    targetText: '3 × 8 (rest 90s)', prescribedReps: 8, metrics: resolveMetrics(['load', 'reps']),
  };
  const squatHtml = logFormPage(mkAthlete(), squatCtx, emptyLogValues(3, ['load', 'reps']), {});
  assert.ok(squatHtml.includes('name="set0_load"'), 'squat shows a load input');
  assert.ok(squatHtml.includes('name="set0_reps"'), 'squat shows a reps input');
  assert.ok(!squatHtml.includes('name="set0_time_s"'), 'squat does NOT show a time input');
  assert.ok(squatHtml.includes('3 × 8 (rest 90s)'), 'prescribed target shown');
  // Three prescribed sets → three rows pre-rendered.
  assert.ok(squatHtml.includes('name="set2_load"'), 'three set rows from the prescription');

  const plankCtx: LogFormContext = {
    athleteId: 'ath-1', day: 1, exerciseId: 't_plank', exerciseName: 'Plank Hold',
    targetText: '3 × 20s', metrics: resolveMetrics(['duration_s']),
  };
  const plankHtml = logFormPage(mkAthlete(), plankCtx, emptyLogValues(3, ['duration_s']), {});
  assert.ok(plankHtml.includes('name="set0_duration_s"'), 'plank shows a hold-duration input');
  assert.ok(!plankHtml.includes('name="set0_load"'), 'plank does NOT show a load input');
});

test('log: logValuesFromParams round-trips submitted rows (for error re-render)', () => {
  const p = new URLSearchParams({ date: '2026-07-09', setCount: '2',
    set0_load: '40', set0_reps: '5', set0_note: 'ok', set1_load: '45', set1_reps: '5', set1_note: '' });
  const v = logValuesFromParams(p, ['load', 'reps']);
  assert.equal(v.date, '2026-07-09');
  assert.equal(v.sets.length, 2);
  assert.deepEqual(v.sets[0]!.values, { load: '40', reps: '5' });
  assert.equal(v.sets[0]!.note, 'ok');
});
