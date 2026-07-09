/**
 * Metric catalog tests — the durable-core invariants the whole logging feature leans on:
 * ids are self-consistent, units are canonical, and PR direction is right (time is the only
 * lower-is-better metric — a faster sprint is the record).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { METRIC_CATALOG, METRIC_IDS, isMetricId, metricById, validateSetValues } from './metrics.ts';

test('every catalog entry keys on its own id', () => {
  for (const [key, m] of Object.entries(METRIC_CATALOG)) assert.equal(m.id, key, `${key} id mismatch`);
});

test('time_s is the sole lower-is-better metric (PR direction)', () => {
  const lowerIsBetter = METRIC_IDS.filter((id) => !METRIC_CATALOG[id].higherIsBetter);
  assert.deepEqual(lowerIsBetter, ['time_s'], 'only sprint time is a lower-is-better PR');
});

test('load is stored canonically in lb; reps/contacts are integer inputs', () => {
  assert.equal(METRIC_CATALOG.load.unit, 'lb', 'load canonical unit is lb (worksheet decision)');
  assert.equal(METRIC_CATALOG.reps.input, 'integer', 'reps are whole');
  assert.equal(METRIC_CATALOG.contacts.input, 'integer', 'contacts are whole');
});

test('isMetricId / metricById resolve known ids and reject unknowns', () => {
  assert.ok(isMetricId('distance_cm'));
  assert.ok(!isMetricId('distnace_cm'));
  assert.ok(!isMetricId(42));
  assert.equal(metricById('time_s')?.label, 'Time');
  assert.equal(metricById('nope'), undefined);
});

test('validateSetValues accepts values within an exercise\'s declared metrics', () => {
  assert.deepEqual(validateSetValues(['load', 'reps'], { load: 42.5, reps: 5 }), []);
  assert.deepEqual(validateSetValues(['time_s'], { time_s: 2.31 }), []);
  assert.deepEqual(validateSetValues(['load', 'reps'], { load: 40 }), [], 'a missing metric is allowed');
  assert.deepEqual(validateSetValues(['load'], {}), [], 'no values is valid (nothing to reject)');
});

test('validateSetValues rejects stray metrics, negatives, and non-integer reps/contacts', () => {
  assert.match(validateSetValues(['load', 'reps'], { time_s: 2 })[0]!, /not one this exercise is logged by/);
  assert.match(validateSetValues(['time_s'], { time_s: -1 })[0]!, /cannot be negative/);
  assert.match(validateSetValues(['reps'], { reps: 4.5 })[0]!, /whole number/);
  assert.match(validateSetValues(['contacts'], { contacts: 3.2 })[0]!, /whole number/);
  assert.match(validateSetValues(['load'], { load: Number.NaN })[0]!, /must be a number/);
  // A decimal load is fine (number input), a decimal rep is not (integer input).
  assert.deepEqual(validateSetValues(['load'], { load: 42.5 }), []);
});
