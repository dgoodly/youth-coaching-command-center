/**
 * Disk implementation of {@link RecordStore} — plain JSON files, one per collection, each an
 * array of records. Node-only; the browser gets IndexedDB (S2).
 *
 * This is the FAKE. It exists for tests, the CLI, and the dashboard's remaining lifespan;
 * the contract in `store/record-store.ts` is written to IndexedDB's strength and this file
 * documents where disk falls short:
 *
 *  - Contract #3 (`appendAll` all-or-nothing): approximated, not provided. Every affected
 *    temp file is staged first (the slow, awaited part), then renamed back-to-back, so a
 *    crash can only land in the tiny window between consecutive `rename()` syscalls —
 *    never across full read→write cycles. Renames run in append order, so callers listing
 *    dependents first (assessment before its height entry) leave only the partial state
 *    `store/doctor.ts` already detects and backfills. IDB gives the real thing in one
 *    transaction.
 *  - Contract #4 (`queryBy` indexed): a full scan + filter. Fine at JSON-file scale; the
 *    point of the op is that IDB doesn't have to do this.
 *  - Contract #5 (key validation): NO deviation — disk enforces duplicate-key rejection
 *    exactly as IDB's `add()` would. The fake may be slow; it may not be more permissive
 *    than production.
 *
 * Files are pretty-printed for hand-readability (the coach can open and edit any record in
 * a text editor) and atomically renamed into place so a crash mid-write can't corrupt the
 * live file. All mutations are serialized through a per-instance promise chain — the whole
 * locking story at one-coach scale. In-process only: it does not guard a *separate* OS
 * process writing the same files (the single-writer assumption, unchanged).
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertUniqueKeys,
  keyMismatchError,
  keyOf,
  sameKey,
  type CollectionName,
  type Collections,
  type KeyedName,
  type RecordOf,
  type RecordStore,
} from './record-store.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo-root `/data`, overridable via `CC_DATA_DIR` — the CLI/dashboard default. */
export function defaultDataDir(): string {
  return process.env.CC_DATA_DIR ? resolve(process.env.CC_DATA_DIR) : join(HERE, '..', 'data');
}

const FILES: Record<CollectionName, string> = {
  athletes: 'athletes.json',
  assessments: 'assessments.json',
  height_log: 'height_log.json',
  wellness_log: 'wellness_log.json',
  workout_log: 'workout_log.json',
  set_log: 'set_log.json',
  block_state: 'block_state.json',
};

/** A {@link RecordStore} over JSON files, plus where they live (for the seed CLI). */
export interface DiskStore extends RecordStore {
  readonly dir: string;
}

export function createDiskStore(dataDir: string = defaultDataDir()): DiskStore {
  const dir = resolve(dataDir);
  const pathFor = (name: CollectionName): string => join(dir, FILES[name]);

  // ---- write serialization (per-instance mutex) ----------------------------------------
  // Every mutation is a read-modify-write; two overlapping ones could each read the old
  // array and write it back, silently dropping one update. All mutations chain through a
  // single promise so they run one at a time (contract #2).
  let writeChain: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    // Chain regardless of whether the previous task resolved or rejected, so one failed
    // write can't wedge the queue.
    const result = writeChain.then(fn, fn);
    writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function readRaw<K extends CollectionName>(name: K): Promise<Collections[K]> {
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
  async function stageWrite<K extends CollectionName>(
    name: K,
    records: Collections[K],
  ): Promise<[tmp: string, file: string]> {
    const file = pathFor(name);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(records, null, 2) + '\n', 'utf8');
    return [tmp, file];
  }

  /** Serialized read-modify-write of one collection: validate, stage, atomic rename. */
  async function rmw<K extends CollectionName>(
    name: K,
    mutate: (records: Collections[K]) => Collections[K],
  ): Promise<Collections[K]> {
    return runExclusive(async () => {
      await mkdir(dir, { recursive: true });
      const next = mutate(await readRaw(name));
      assertUniqueKeys(name, next);
      const [tmp, file] = await stageWrite(name, next);
      await rename(tmp, file);
      return next;
    });
  }

  return {
    dir,

    // ---- collection-level -----------------------------------------------------------

    read: readRaw,

    async write(name, records) {
      await rmw(name, () => records);
    },

    async append(name, record) {
      await rmw(name, (all) => {
        (all as unknown[]).push(record);
        return all;
      });
      return record;
    },

    update: rmw,

    async appendAll(appends) {
      if (appends.length === 0) return;
      return runExclusive(async () => {
        await mkdir(dir, { recursive: true });
        // Load each affected collection once, preserving first-seen order for
        // deterministic renames (see the module doc on the crash window).
        const order: CollectionName[] = [];
        const buffers = new Map<CollectionName, unknown[]>();
        for (const { collection } of appends) {
          if (!buffers.has(collection)) {
            buffers.set(collection, (await readRaw(collection)) as unknown[]);
            order.push(collection);
          }
        }
        for (const { collection, record } of appends) {
          buffers.get(collection)!.push(record);
        }
        // Validate every collection BEFORE staging anything: a duplicate key rejects the
        // whole batch with nothing written (contract #5, all-or-nothing on validation).
        for (const collection of order) {
          assertUniqueKeys(collection, buffers.get(collection) as Collections[typeof collection]);
        }
        // Stage all temp files before committing any, so the crash window is only between
        // renames (contract #3, approximated — see module doc).
        const staged: Array<[tmp: string, file: string]> = [];
        for (const collection of order) {
          staged.push(
            await stageWrite(collection, buffers.get(collection) as Collections[typeof collection]),
          );
        }
        for (const [tmp, file] of staged) {
          await rename(tmp, file);
        }
      });
    },

    // ---- record-level -----------------------------------------------------------------

    async get(name, key) {
      const all = await readRaw(name);
      return (all as RecordOf<KeyedName>[]).find((r) => sameKey(keyOf(name, r), key)) as
        | RecordOf<typeof name>
        | undefined;
    },

    async put(name, record) {
      const key = keyOf(name, record);
      await rmw(name, (all) => {
        const rows = all as RecordOf<KeyedName>[];
        const idx = rows.findIndex((r) => sameKey(keyOf(name, r), key));
        if (idx === -1) rows.push(record);
        else rows[idx] = record;
        return all;
      });
    },

    async remove(name, key) {
      await rmw(
        name,
        (all) =>
          (all as RecordOf<KeyedName>[]).filter((r) => !sameKey(keyOf(name, r), key)) as Collections[typeof name],
      );
    },

    async updateRecord(name, key, mutate) {
      let result: RecordOf<typeof name> | null = null;
      await rmw(name, (all) => {
        const rows = all as RecordOf<KeyedName>[];
        const idx = rows.findIndex((r) => sameKey(keyOf(name, r), key));
        const existing = idx === -1 ? undefined : (rows[idx] as RecordOf<typeof name>);
        const next = mutate(existing);
        if (next === null) {
          result = null;
          if (idx === -1) return all; // no-op: nothing to delete
          rows.splice(idx, 1); // delete
          return all;
        }
        if (!sameKey(keyOf(name, next), key)) {
          throw keyMismatchError(name, keyOf(name, next), key);
        }
        result = next;
        if (idx === -1) rows.push(next);
        else rows[idx] = next;
        return all;
      });
      return result;
    },

    // ---- indexed reads ------------------------------------------------------------------

    async queryBy(name, index, value) {
      // Contract #4 deviation: full scan + filter. Fine at JSON-file scale.
      const all = (await readRaw(name)) as unknown as Record<string, unknown>[];
      return all.filter((r) => r[index as string] === value) as unknown as Collections[typeof name];
    },
  };
}
