/**
 * JSON file store — the local persistence layer.
 *
 * Storage is plain JSON files under /data (BUILD_BRIEF §4): one file per collection,
 * each an array of records. Chosen for maximum human-readability — the coach can open
 * and hand-edit any record in a text editor. A few dozen athletes max, so a full
 * read/rewrite per change is fine; this is deliberately boring (BUILD_BRIEF §4).
 *
 * This is part of the DISPOSABLE surface, not the durable core — the future app swaps
 * this out for a real datastore while keeping the engine and types unchanged. Engine
 * code must depend only on `engine/types.ts`, never on this file.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Assessment,
  AthleteProfile,
  BlockState,
  HeightLogEntry,
  SetLogEntry,
  WellnessLogEntry,
  WorkoutLogEntry,
} from '../engine/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root (one level up from /store). Overridable via env for tests. */
export const DATA_DIR = process.env.CC_DATA_DIR
  ? resolve(process.env.CC_DATA_DIR)
  : join(HERE, '..', 'data');

/** The collections persisted, keyed by filename, each an array of the given record type. */
export interface Collections {
  athletes: AthleteProfile[];
  assessments: Assessment[];
  height_log: HeightLogEntry[];
  wellness_log: WellnessLogEntry[];
  workout_log: WorkoutLogEntry[];
  set_log: SetLogEntry[];
  block_state: BlockState[];
}

const FILES: Record<keyof Collections, string> = {
  athletes: 'athletes.json',
  assessments: 'assessments.json',
  height_log: 'height_log.json',
  wellness_log: 'wellness_log.json',
  workout_log: 'workout_log.json',
  set_log: 'set_log.json',
  block_state: 'block_state.json',
};

function pathFor(name: keyof Collections): string {
  return join(DATA_DIR, FILES[name]);
}

// ---------------------------------------------------------------------------
// Write serialization (in-process mutex)
// ---------------------------------------------------------------------------

/**
 * Every mutation is a read-modify-write, and the store is now written from a dashboard that
 * can issue concurrent requests (two browser tabs, or a tab + a CLI sharing this process).
 * Two overlapping mutations could each read the old array and then write it back, silently
 * dropping one update. We serialize ALL mutations through a single promise chain so they run
 * one at a time. At localhost / single-coach scale this is the whole locking story — no
 * file-locking library, no datastore (BUILD_BRIEF §4); it closes the "two writers race" gap
 * that turning the dashboard read-write reintroduces.
 *
 * Note this is in-process only: it does not guard against a *separate* OS process writing the
 * same files concurrently (a second `node` invocation). That remains the single-writer
 * assumption of §10 — unchanged, and still fine for one coach on localhost.
 */
let writeChain: Promise<unknown> = Promise.resolve();

/** Run `fn` after all previously-queued mutations settle, and before any queued after it. */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  // Chain onto the tail regardless of whether the previous task resolved or rejected, so one
  // failed write can't wedge the queue.
  const result = writeChain.then(fn, fn);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Read a collection. Returns [] if the file does not exist yet (first run). */
export async function readCollection<K extends keyof Collections>(
  name: K,
): Promise<Collections[K]> {
  const file = pathFor(name);
  if (!existsSync(file)) return [] as unknown as Collections[K];
  const raw = await readFile(file, 'utf8');
  const trimmed = raw.trim();
  if (trimmed === '') return [] as unknown as Collections[K];
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error(`Data file ${FILES[name]} is not a JSON array.`);
  }
  return parsed as Collections[K];
}

/** Write one collection's array to its temp file, pretty-printed for hand-readability. */
async function stageWrite<K extends keyof Collections>(
  name: K,
  records: Collections[K],
): Promise<[tmp: string, file: string]> {
  const file = pathFor(name);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(records, null, 2) + '\n', 'utf8');
  return [tmp, file];
}

/**
 * Write a collection. Pretty-printed (2-space) for hand-readability, then atomically
 * renamed into place so a crash mid-write can't corrupt the live file. Serialized.
 */
export async function writeCollection<K extends keyof Collections>(
  name: K,
  records: Collections[K],
): Promise<void> {
  return runExclusive(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const [tmp, file] = await stageWrite(name, records);
    await rename(tmp, file);
  });
}

/** Append one record to a collection and persist. Returns the appended record. Serialized. */
export async function append<K extends keyof Collections>(
  name: K,
  record: Collections[K][number],
): Promise<Collections[K][number]> {
  return runExclusive(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const all = await readCollection(name);
    (all as unknown[]).push(record);
    const [tmp, file] = await stageWrite(name, all);
    await rename(tmp, file);
    return record;
  });
}

/**
 * Read-modify-write a single collection as one serialized unit. `mutate` receives the current
 * array and returns the array to persist (mutating in place and returning it is fine). Use this
 * for edits (find-and-replace a record) so the read and the write can't be split by a concurrent
 * mutation — the plain read-then-`writeCollection` pattern reopens that race.
 */
export async function updateCollection<K extends keyof Collections>(
  name: K,
  mutate: (records: Collections[K]) => Collections[K],
): Promise<Collections[K]> {
  return runExclusive(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const next = mutate(await readCollection(name));
    const [tmp, file] = await stageWrite(name, next);
    await rename(tmp, file);
    return next;
  });
}

/** One record destined for a named collection — a discriminated union over the collections. */
export type PendingAppend = {
  [K in keyof Collections]: { collection: K; record: Collections[K][number] };
}[keyof Collections];

/**
 * Append several records across collections as ONE serialized unit — the fix for the
 * assessment+height-log dual-write desync (§10). Previously `saveAssessment` did two
 * independent `append` calls; a crash between them left an assessment with no matching
 * height entry, silently under-feeding the maturity axis (recoverable only via `npm run
 * doctor`).
 *
 * Here we read every affected collection, apply all appends, **stage every temp file first**
 * (the slow, awaited part), then rename them back-to-back. A crash can therefore only land in
 * the tiny window between two consecutive `rename()` syscalls, not across full read→write
 * cycles. Renames run in the order the appends were passed, so if the caller lists the
 * assessment before its height entry, the only reachable partial state is
 * "assessment written, height-log not yet" — exactly the state `store/doctor.ts` already
 * detects and backfills. (True cross-file atomicity would need a journal/datastore, which is
 * out of scope by design; the doctor stays the backstop for this shrunk window.)
 */
export async function appendAll(appends: readonly PendingAppend[]): Promise<void> {
  if (appends.length === 0) return;
  return runExclusive(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    // Load each affected collection once, preserving first-seen order for deterministic renames.
    const order: (keyof Collections)[] = [];
    const buffers = new Map<keyof Collections, unknown[]>();
    for (const { collection } of appends) {
      if (!buffers.has(collection)) {
        buffers.set(collection, (await readCollection(collection)) as unknown[]);
        order.push(collection);
      }
    }
    for (const { collection, record } of appends) {
      buffers.get(collection)!.push(record);
    }
    // Stage all temp files before committing any, so the crash window is only between renames.
    const staged: Array<[tmp: string, file: string]> = [];
    for (const collection of order) {
      staged.push(await stageWrite(collection, buffers.get(collection)! as Collections[typeof collection]));
    }
    for (const [tmp, file] of staged) {
      await rename(tmp, file);
    }
  });
}
