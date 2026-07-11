/**
 * Block-state split tests (Phase 3) — the pure split accessor + switch transform.
 * splitOf centralises the 4-day default; switchSplit resets rotation on 'fresh' and preserves
 * it on 'carry'. No I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitOf, splitDays, switchSplit, SPLIT_DAYS, nextDayInSplit } from './blocks.ts';
import type { BlockState } from '../engine/types.ts';

function mkBlock(over: Partial<BlockState> = {}): BlockState {
  return {
    athleteId: 'a1', blockStartDate: '2026-01-01', blockIndex: 2,
    slotVariants: { '1:jump:0': 'pogo_x', '4:lift:0': 'squat_y' }, ...over,
  };
}

test('splitOf defaults to 4day when block state is absent or has no split', () => {
  assert.equal(splitOf(null), '4day');
  assert.equal(splitOf(undefined), '4day');
  assert.equal(splitOf(mkBlock()), '4day'); // legacy record, no activeSplit
  assert.equal(splitOf(mkBlock({ activeSplit: '2day' })), '2day');
});

test('SPLIT_DAYS maps each split to its day subset', () => {
  assert.deepEqual(SPLIT_DAYS['2day'], [1, 2]);
  assert.deepEqual(SPLIT_DAYS['3day'], [1, 2, 4]);
  assert.deepEqual(SPLIT_DAYS['4day'], [1, 2, 3, 4]);
  assert.deepEqual(splitDays(mkBlock({ activeSplit: '3day' })), [1, 2, 4]);
  assert.deepEqual(splitDays(null), [1, 2, 3, 4]); // default
});

test('switchSplit "fresh" starts a new block: resets index, date, and variants', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const next = switchSplit(mkBlock({ activeSplit: '4day' }), '2day', 'fresh', now);
  assert.equal(next.activeSplit, '2day');
  assert.equal(next.blockIndex, 0, 'rotation reset');
  assert.equal(next.blockStartDate, '2026-07-07', 'start date reset to now');
  assert.deepEqual(next.slotVariants, {}, 'variants cleared');
  assert.equal(next.athleteId, 'a1', 'athlete preserved');
});

test('switchSplit "carry" keeps the block index, date, and variants; only the split changes', () => {
  const before = mkBlock({ activeSplit: '4day' });
  const next = switchSplit(before, '3day', 'carry', new Date('2026-07-07T00:00:00Z'));
  assert.equal(next.activeSplit, '3day');
  assert.equal(next.blockIndex, before.blockIndex, 'index carried');
  assert.equal(next.blockStartDate, before.blockStartDate, 'date carried');
  assert.deepEqual(next.slotVariants, before.slotVariants, 'variants carried');
});

test('switchSplit does not mutate the input state', () => {
  const before = mkBlock({ activeSplit: '4day' });
  const snapshot = JSON.parse(JSON.stringify(before));
  switchSplit(before, '2day', 'fresh', new Date('2026-07-07T00:00:00Z'));
  assert.deepEqual(before, snapshot, 'input unchanged (pure)');
});

test('nextDayInSplit advances to the next authored day and wraps at the end', () => {
  assert.equal(nextDayInSplit(1, [1, 2, 3, 4]), 2);
  assert.equal(nextDayInSplit(3, [1, 2, 3, 4]), 4);
  assert.equal(nextDayInSplit(4, [1, 2, 3, 4]), 1, 'wraps past the last day');
  assert.equal(nextDayInSplit(2, [1, 2]), 1, '2-day split wraps 2 -> 1');
  assert.equal(nextDayInSplit(2, [1, 2, 4]), 4, '3-day split skips the unrun day 3');
  assert.equal(nextDayInSplit(4, [1, 2, 4]), 1, '3-day split wraps 4 -> 1');
});

test('nextDayInSplit clamps a day the current split no longer runs', () => {
  // Split shrank 4day -> 2day under a session last on day 4: no day > 4, so wrap to 1.
  assert.equal(nextDayInSplit(4, [1, 2]), 1);
  // Split is 3day [1,2,4]; a stale day-3 session clamps forward to the next real day, 4.
  assert.equal(nextDayInSplit(3, [1, 2, 4]), 4);
});
