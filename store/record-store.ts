/**
 * The store seam — `RecordStore` is the persistence interface the whole product sits on
 * (BUILD_BRIEF_v2.md §3 condition 1, §5.4). Two implementations: disk (`store/disk.ts`,
 * Node-only, tests + CLI) and IndexedDB (the app, S2).
 *
 * THIS FILE MUST STAY BROWSER-IMPORTABLE: no Node imports, ever. It is the module the
 * future PWA shares with the test fixture, and the reason the PWA choice is reversible.
 *
 * ## Contract (what the S2 shared suite asserts against BOTH implementations)
 *
 *  1. `read` of a never-written collection returns `[]`.
 *  2. All mutations on one store instance are serialized — concurrent calls never lose an
 *     update. Every `mutate` callback is SYNCHRONOUS and runs exactly once. (Synchronous is
 *     load-bearing: an async callback cannot live inside an IndexedDB transaction.)
 *  3. `appendAll` is all-or-nothing.
 *  4. `queryBy` is an indexed lookup returning matching records in UNSPECIFIED order —
 *     callers sort.
 *  5. Appending a record whose primary key already exists in a keyed collection is an
 *     error, as is persisting a keyed collection containing duplicate keys via
 *     `write`/`update`. Implementations MAY deviate from the contract on performance (#4)
 *     and on atomicity they cannot physically provide (#3) — documented at the deviation —
 *     but never on validation.
 *
 * The contract is written to the STRONG implementation (IndexedDB); the disk store fakes
 * what it must and documents where it falls short. Do not weaken this file to make a
 * fake's life easier.
 *
 * Films are NOT records: S11 stores clips in OPFS behind a separate `FilmStore` seam.
 * Blob concerns never enter this interface.
 */

import type {
  Assessment,
  AthleteProfile,
  BlockState,
  HeightLogEntry,
  SetLogEntry,
  WellnessLogEntry,
  WorkoutLogEntry,
} from '../engine/types.ts';

/** The collections persisted, each an array of the given record type. */
export interface Collections {
  athletes: AthleteProfile[];
  assessments: Assessment[];
  height_log: HeightLogEntry[];
  wellness_log: WellnessLogEntry[];
  workout_log: WorkoutLogEntry[];
  set_log: SetLogEntry[];
  block_state: BlockState[];
}

export type CollectionName = keyof Collections;

/** The record type stored in collection `K`. */
export type RecordOf<K extends CollectionName> = Collections[K][number];

/** One record destined for a named collection — a discriminated union over the collections. */
export type PendingAppend = {
  [K in CollectionName]: { collection: K; record: RecordOf<K> };
}[CollectionName];

interface CollectionSchema {
  /**
   * Primary key: a field name, a composite field tuple, or `null` for an append-only log
   * with no natural identity (the store manages an internal, opaque key).
   */
  readonly key: string | readonly string[] | null;
  /** Secondary indexes `queryBy` can look up. */
  readonly indexes: readonly string[];
}

/**
 * Primary keys + secondary indexes per collection. Drives IndexedDB object-store creation
 * (S2) and types the record-level operations below.
 *
 * - `set_log` is keyed by its logical identity (which session, which movement, which set) —
 *   the identity `upsertSet` has always used. `setLogId` stays on the record as provenance
 *   but is NOT the storage key.
 * - `height_log` / `wellness_log` have no natural identity: entries carry no uuid, and
 *   (athleteId, date) is not unique ('assessment' and 'manual' height entries can share a
 *   day). They are append-only logs; record-level ops are type-level unavailable on them.
 *   KNOWN CONSEQUENCE for S10 (export/import): with no primary key there is no way to
 *   merge-import these logs idempotently — import is wipe-and-restore for them. Accepted;
 *   don't let it surprise you when S10 lands.
 */
export const SCHEMA = {
  athletes: { key: 'athleteId', indexes: [] },
  assessments: { key: 'assessmentId', indexes: ['athleteId'] },
  height_log: { key: null, indexes: ['athleteId'] },
  wellness_log: { key: null, indexes: ['athleteId'] },
  workout_log: { key: 'workoutId', indexes: ['athleteId'] },
  set_log: { key: ['workoutId', 'exerciseId', 'setIndex'], indexes: ['athleteId', 'workoutId'] },
  block_state: { key: 'athleteId', indexes: [] },
} as const satisfies Record<CollectionName, CollectionSchema>;

/** Collections with a declared primary key — the only ones record-level ops accept. */
export type KeyedName = {
  [K in CollectionName]: (typeof SCHEMA)[K]['key'] extends null ? never : K;
}[CollectionName];

type KeyPathOf<K extends CollectionName> = (typeof SCHEMA)[K]['key'];
type FieldValue<K extends CollectionName, F> = F extends keyof RecordOf<K> ? RecordOf<K>[F] : never;

/**
 * The primary-key VALUE for collection `K`: the keyed field's type, or a tuple of them for
 * a composite key — e.g. `KeyFor<'athletes'>` is `string`, `KeyFor<'set_log'>` is
 * `[string, string, number]`.
 */
export type KeyFor<K extends KeyedName> = KeyPathOf<K> extends infer P
  ? P extends readonly string[]
    ? { -readonly [I in keyof P]: FieldValue<K, P[I]> }
    : FieldValue<K, P>
  : never;

/** The index names declared for collection `K` (never, where none are declared). */
export type IndexFor<K extends CollectionName> = (typeof SCHEMA)[K]['indexes'][number];

/** Extract a record's primary-key value per {@link SCHEMA}. Keyed collections only. */
export function keyOf<K extends KeyedName>(name: K, record: RecordOf<K>): KeyFor<K> {
  const key = SCHEMA[name].key as string | readonly string[];
  const fields = record as unknown as Record<string, unknown>;
  if (Array.isArray(key)) {
    return key.map((f) => fields[f]) as KeyFor<K>;
  }
  return fields[key as string] as KeyFor<K>;
}

/** Key equality: scalar `===`, composite element-wise. */
export function sameKey(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** Contract #5 violation — shared so every implementation throws the identical error. */
export function duplicateKeyError(name: CollectionName, key: unknown): Error {
  return new Error(`store: duplicate primary key ${JSON.stringify(key)} in "${name}".`);
}

/** `updateRecord` mutate returned a record that doesn't live at the addressed key. */
export function keyMismatchError(name: CollectionName, actual: unknown, expected: unknown): Error {
  return new Error(
    `store: updateRecord("${name}") mutate returned a record whose key ` +
      `${JSON.stringify(actual)} differs from ${JSON.stringify(expected)}.`,
  );
}

/**
 * Contract #5: a keyed collection may never persist two records with one key. Pure — shared
 * by implementations validating whole arrays (`write`/`update`) or staged batches.
 */
export function assertUniqueKeys<K extends CollectionName>(name: K, records: Collections[K]): void {
  if (SCHEMA[name].key === null) return;
  const seen = new Set<string>();
  for (const r of records) {
    const key = JSON.stringify(keyOf(name as KeyedName, r as RecordOf<KeyedName>));
    if (seen.has(key)) throw duplicateKeyError(name, JSON.parse(key));
    seen.add(key);
  }
}

/** The persistence seam. See the module doc for the cross-implementation contract. */
export interface RecordStore {
  // ---- collection-level — whole-array semantics, for small collections and resets ----

  /** The whole collection. `[]` if never written (contract #1). */
  read<K extends CollectionName>(name: K): Promise<Collections[K]>;

  /** Replace the whole collection. Rejects duplicate primary keys (contract #5). */
  write<K extends CollectionName>(name: K, records: Collections[K]): Promise<void>;

  /**
   * Append one record. Rejects an already-present primary key (contract #5). Returns the
   * appended record.
   */
  append<K extends CollectionName>(name: K, record: RecordOf<K>): Promise<RecordOf<K>>;

  /**
   * Whole-collection read-modify-write as one serialized unit. `mutate` is synchronous,
   * runs exactly once, and its result replaces the collection (duplicate keys rejected).
   * This materializes the entire collection — fine for the small ones, wrong for
   * `set_log`; use the record-level ops there.
   */
  update<K extends CollectionName>(
    name: K,
    mutate: (records: Collections[K]) => Collections[K],
  ): Promise<Collections[K]>;

  /**
   * Append several records across collections as ONE unit — all-or-nothing (contract #3).
   * Duplicate primary keys (against stored records or within the batch) reject the whole
   * batch (contract #5).
   */
  appendAll(appends: readonly PendingAppend[]): Promise<void>;

  // ---- record-level — keyed collections only (enforced in types) ----

  /** One record by primary key, or `undefined`. */
  get<K extends KeyedName>(name: K, key: KeyFor<K>): Promise<RecordOf<K> | undefined>;

  /** Insert-or-replace by the record's own primary key. */
  put<K extends KeyedName>(name: K, record: RecordOf<K>): Promise<void>;

  /** Delete by primary key. Idempotent: removing an absent key is a no-op. */
  remove<K extends KeyedName>(name: K, key: KeyFor<K>): Promise<void>;

  /**
   * Atomic per-record read-modify-write — the record-level analog of `update`, and the op
   * the autosave path (`upsertSet`) rides. `mutate` receives the existing record or
   * `undefined`, synchronously, exactly once. Pinned semantics:
   *
   *   - returns a record  → insert-or-replace at `key`. The returned record MUST carry the
   *     same primary key as `key` (implementations reject otherwise).
   *   - returns `null` + existing record   → DELETE.
   *   - returns `null` + no existing record → NO-OP.
   *
   * Resolves with the record written, or `null` when the outcome was delete / no-op.
   */
  updateRecord<K extends KeyedName>(
    name: K,
    key: KeyFor<K>,
    mutate: (existing: RecordOf<K> | undefined) => RecordOf<K> | null,
  ): Promise<RecordOf<K> | null>;

  // ---- indexed reads ----

  /**
   * Records whose `index` field equals `value`, in unspecified order (contract #4) —
   * callers sort. Only indexes declared in {@link SCHEMA} are accepted.
   */
  queryBy<K extends CollectionName>(
    name: K,
    index: IndexFor<K>,
    value: string,
  ): Promise<Collections[K]>;
}
