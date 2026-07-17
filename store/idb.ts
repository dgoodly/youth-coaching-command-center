/**
 * IndexedDB implementation of {@link RecordStore} — the PRODUCTION store, the one the PWA
 * runs on (BUILD_BRIEF_v2.md §3, §5.4; BUILD_PLAN S2). The contract in
 * `store/record-store.ts` is written to this implementation's strength; `store/disk.ts` is
 * the fake that approximates it.
 *
 * What IDB provides natively that disk fakes:
 *  - Contract #3: `appendAll` runs in ONE readwrite transaction across every affected
 *    object store — genuinely all-or-nothing, no crash window, no doctor backstop needed.
 *  - Contract #4: `queryBy` is a real index lookup (`index.getAll`), not a scan.
 *  - Contract #5: duplicate-key rejection is how `add()` already behaves; we pre-check with
 *    `getKey` so the error is the shared contract error rather than a DOMException.
 *
 * Object stores and indexes are created from {@link SCHEMA} on first open (version 1):
 * keyed collections get their keyPath (composite for `set_log`); the keyless append-only
 * logs (`height_log`, `wellness_log`) get store-managed auto-increment keys their records
 * never see.
 *
 * BROWSER-PORTABLE: no Node imports. Tests inject `fake-indexeddb`'s `IDBFactory`; the app
 * uses the global. Serialization (contract #2) comes from IDB itself — overlapping
 * readwrite transactions on the same store run in creation order, each atomic — so unlike
 * disk there is no promise-chain mutex here.
 *
 * SCHEMA VERSIONING (S4): `DB_VERSION` gates record-shape migrations. `onupgradeneeded`
 * creates stores on a fresh database and runs the pure migrations from
 * `store/migrations.ts` on an existing one. Because the PWA can be open in a browser tab
 * AND installed on the home screen while one of them upgrades, every connection handles
 * `versionchange` by closing itself (the next operation reopens at the new version), and
 * an upgrade held open by a connection that won't close surfaces through `onBlocked`.
 */

import {
  SCHEMA,
  assertUniqueKeys,
  duplicateKeyError,
  keyMismatchError,
  keyOf,
  sameKey,
  type CollectionName,
  type Collections,
  type KeyedName,
  type RecordOf,
  type RecordStore,
} from './record-store.ts';
import { isLegacyAssessment, migrateAssessmentRecord } from './migrations.ts';

const ALL_COLLECTIONS = Object.keys(SCHEMA) as CollectionName[];

/**
 * Database schema version. Bump when a record shape changes, and add the migration to
 * `runUpgrade` below (pure transform in `store/migrations.ts`, applied here via cursor).
 *   v1 — S2: stores + indexes created from SCHEMA.
 *   v2 — S4: assessment reshape (scoresLive/scoresReviewed, films, provisional).
 */
export const DB_VERSION = 2;

/** A {@link RecordStore} over IndexedDB, plus lifecycle hooks the app shell needs. */
export interface IdbStore extends RecordStore {
  /** Close the underlying database connection (subsequent ops reopen it). */
  close(): Promise<void>;
}

export interface IdbStoreOptions {
  /** Database name. One coach, one device, one database. */
  name?: string;
  /** Injectable factory — tests pass `fake-indexeddb`'s; the app defaults to the global. */
  indexedDB?: IDBFactory;
  /**
   * Another connection (tab vs. home-screen app) won't close, so this connection's
   * upgrade is stalled. The app shell decides what to tell the coach; default is IDB's
   * native behavior — wait until the other side goes away.
   */
  onBlocked?: () => void;
}

export function createIdbStore(options: IdbStoreOptions = {}): IdbStore {
  const dbName = options.name ?? 'command-center';
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) {
    throw new Error(
      'createIdbStore: no IndexedDB available. In the browser this is the global; in Node, inject fake-indexeddb.',
    );
  }

  // ---- connection ---------------------------------------------------------------------

  let dbPromise: Promise<IDBDatabase> | null = null;

  /** Create stores on a fresh database; run record migrations on an old one. */
  function runUpgrade(request: IDBOpenDBRequest, oldVersion: number): void {
    const db = request.result;
    if (oldVersion < 1) {
      for (const name of ALL_COLLECTIONS) {
        const spec = SCHEMA[name];
        const objectStore =
          spec.key === null
            ? db.createObjectStore(name, { autoIncrement: true })
            : db.createObjectStore(name, { keyPath: spec.key as string | string[] });
        for (const index of spec.indexes) objectStore.createIndex(index, index);
      }
      return; // fresh database is created at the current shape — nothing to migrate
    }
    if (oldVersion < 2) {
      // v2 (S4): assessment reshape, via the same pure function the disk CLI runs. A
      // throw here (non-empty videoRefs) aborts the whole versionchange transaction —
      // the database stays at v1 rather than half-migrating.
      const assessments = request.transaction!.objectStore('assessments');
      assessments.openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor) return;
        if (isLegacyAssessment(cursor.value)) cursor.update(migrateAssessmentRecord(cursor.value));
        cursor.continue();
      };
    }
  }

  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = factory.open(dbName, DB_VERSION);
      request.onupgradeneeded = (event) => runUpgrade(request, event.oldVersion);
      request.onblocked = () => options.onBlocked?.();
      request.onsuccess = () => {
        const db = request.result;
        // Another context (tab vs. home-screen) wants to upgrade: yield. Close this
        // connection and forget it — the next operation reopens at the new version.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error(`idb: failed to open "${dbName}"`));
    });
  }

  function ensureDb(): Promise<IDBDatabase> {
    dbPromise ??= openDb();
    return dbPromise;
  }

  // ---- request/transaction plumbing -----------------------------------------------------

  function req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('idb: request failed'));
    });
  }

  function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('idb: transaction aborted'));
      tx.onerror = () => {}; // surfaces via onabort
    });
  }

  /**
   * Run `fn` inside one transaction over `names`; await completion (durability) before
   * resolving. A throw from `fn` aborts the transaction — nothing it wrote survives.
   */
  async function withTx<T>(
    names: CollectionName | CollectionName[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await ensureDb();
    const tx = db.transaction(names, mode);
    const done = txDone(tx);
    try {
      const result = await fn(tx);
      await done;
      return result;
    } catch (err) {
      done.catch(() => {}); // the abort rejection is expected; the thrown error is the story
      try {
        tx.abort();
      } catch {
        // already aborted or completed — nothing to roll back
      }
      throw err;
    }
  }

  /** Replace an object store's contents with `records` (inside an open tx). */
  function replaceAll<K extends CollectionName>(tx: IDBTransaction, name: K, records: Collections[K]): void {
    const objectStore = tx.objectStore(name);
    objectStore.clear();
    for (const record of records) {
      // Keyed stores derive the key from keyPath; keyless stores auto-generate one.
      objectStore.add(record);
    }
  }

  /** Reject the op with the shared contract error if `key` already exists (inside a tx). */
  async function assertAbsent(tx: IDBTransaction, name: CollectionName, record: unknown): Promise<void> {
    if (SCHEMA[name].key === null) return;
    const key = keyOf(name as KeyedName, record as RecordOf<KeyedName>);
    const existing = await req(tx.objectStore(name).getKey(key as IDBValidKey));
    if (existing !== undefined) throw duplicateKeyError(name, key);
  }

  return {
    // ---- collection-level ---------------------------------------------------------------

    async read(name) {
      return withTx(name, 'readonly', async (tx) => req(tx.objectStore(name).getAll()));
    },

    async write(name, records) {
      assertUniqueKeys(name, records); // nothing opened, nothing written on rejection
      await withTx(name, 'readwrite', async (tx) => replaceAll(tx, name, records));
    },

    async append(name, record) {
      await withTx(name, 'readwrite', async (tx) => {
        await assertAbsent(tx, name, record);
        tx.objectStore(name).add(record);
      });
      return record;
    },

    async update(name, mutate) {
      return withTx(name, 'readwrite', async (tx) => {
        const next = mutate(await req(tx.objectStore(name).getAll()));
        assertUniqueKeys(name, next); // throw → abort → the read state stands
        replaceAll(tx, name, next);
        return next;
      });
    },

    async appendAll(appends) {
      if (appends.length === 0) return;
      const names = [...new Set(appends.map((a) => a.collection))];
      // ONE transaction across every affected store: contract #3 for real. A duplicate —
      // against stored records or earlier in this same batch (getKey sees the transaction's
      // own uncommitted writes) — aborts the lot.
      await withTx(names, 'readwrite', async (tx) => {
        for (const { collection, record } of appends) {
          await assertAbsent(tx, collection, record);
          tx.objectStore(collection).add(record);
        }
      });
    },

    // ---- record-level ---------------------------------------------------------------------

    async get(name, key) {
      return withTx(name, 'readonly', async (tx) =>
        req(tx.objectStore(name).get(key as IDBValidKey)),
      ) as Promise<RecordOf<typeof name> | undefined>;
    },

    async put(name, record) {
      await withTx(name, 'readwrite', async (tx) => {
        tx.objectStore(name).put(record);
      });
    },

    async remove(name, key) {
      await withTx(name, 'readwrite', async (tx) => {
        tx.objectStore(name).delete(key as IDBValidKey);
      });
    },

    async updateRecord(name, key, mutate) {
      return withTx(name, 'readwrite', async (tx) => {
        const objectStore = tx.objectStore(name);
        const existing = (await req(objectStore.get(key as IDBValidKey))) as
          | RecordOf<typeof name>
          | undefined;
        const next = mutate(existing);
        if (next === null) {
          if (existing !== undefined) objectStore.delete(key as IDBValidKey); // delete
          return null; // …or no-op when absent (pinned semantics)
        }
        if (!sameKey(keyOf(name, next), key)) {
          throw keyMismatchError(name, keyOf(name, next), key);
        }
        objectStore.put(next);
        return next;
      });
    },

    // ---- indexed reads ----------------------------------------------------------------------

    async queryBy(name, index, value) {
      return withTx(name, 'readonly', async (tx) =>
        req(tx.objectStore(name).index(index as string).getAll(value)),
      );
    },

    // ---- lifecycle ---------------------------------------------------------------------------

    async close() {
      if (!dbPromise) return;
      const db = await dbPromise;
      db.close();
      dbPromise = null;
    },
  };
}
