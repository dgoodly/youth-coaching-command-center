/**
 * IndexedDB-store tests: the SAME shared contract the disk store runs
 * (`store/record-store.contract.ts`) — that suite is the S1/S2 contract, and both
 * implementations passing it is what "two implementations of one seam" means.
 *
 * Runs on `fake-indexeddb` (dev dependency only — runtime stays zero-dep). Each store gets
 * its own injected `IDBFactory`, so databases are isolated in memory and nothing touches
 * globals.
 */

import { IDBFactory } from 'fake-indexeddb';

import { createIdbStore } from './idb.ts';
import { runRecordStoreContract } from './record-store.contract.ts';

runRecordStoreContract('idb', {
  store: createIdbStore({ indexedDB: new IDBFactory() }),
  fresh: () => createIdbStore({ indexedDB: new IDBFactory() }),
});
