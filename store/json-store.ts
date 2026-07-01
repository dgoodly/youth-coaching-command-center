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
  workout_log: WorkoutLogEntry[];
  block_state: BlockState[];
}

const FILES: Record<keyof Collections, string> = {
  athletes: 'athletes.json',
  assessments: 'assessments.json',
  height_log: 'height_log.json',
  workout_log: 'workout_log.json',
  block_state: 'block_state.json',
};

function pathFor(name: keyof Collections): string {
  return join(DATA_DIR, FILES[name]);
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

/**
 * Write a collection. Pretty-printed (2-space) for hand-readability, then atomically
 * renamed into place so a crash mid-write can't corrupt the live file.
 */
export async function writeCollection<K extends keyof Collections>(
  name: K,
  records: Collections[K],
): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const file = pathFor(name);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(records, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}

/** Append one record to a collection and persist. Returns the appended record. */
export async function append<K extends keyof Collections>(
  name: K,
  record: Collections[K][number],
): Promise<Collections[K][number]> {
  const all = await readCollection(name);
  (all as unknown[]).push(record);
  await writeCollection(name, all);
  return record;
}
