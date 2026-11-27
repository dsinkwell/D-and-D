// The user's own data: characters (spellbooks), lists, homebrew entries and house rules.
// One record format for all of it, kept in IndexedDB, so that file sharing (now) and iCloud sync
// (later) can move records between devices and players:
//   - every record has a stable id, a type, a name and the time it last changed;
//   - deleting leaves a small tombstone (deleted: true) so a sync can pass the deletion on;
//   - `origin` remembers where an imported record came from, so importing a newer copy of the
//     same thing (e.g. the DM's updated house rules) can replace it instead of adding a second one.
import { useSyncExternalStore } from 'react';
import { createStore, entries, set as idbSet } from 'idb-keyval';

export type RecordType = 'character' | 'list' | 'homebrew' | 'houserules';

export interface UserRecord<T = any> {
  id: string;
  type: RecordType;
  name: string;
  updated: number;
  created: number;
  deleted?: boolean;
  origin?: string; // id of the record this was imported from (the same id when first imported)
  author?: string; // shown on shared files ("from Dana")
  data: T;
}

const store = createStore('rc-user', 'records');
let records = new Map<string, UserRecord>();
let loaded: Promise<void> | null = null;
let ready = false;
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};

export function loadUserData(): Promise<void> {
  loaded ??= entries<string, UserRecord>(store)
    .then((all) => {
      records = new Map(all);
    })
    .catch(() => {
      /* storage blocked: work in memory for this visit */
    })
    .finally(() => {
      ready = true;
      emit();
    });
  return loaded;
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export function listRecords<T = any>(type: RecordType): UserRecord<T>[] {
  return [...records.values()].filter((r) => r.type === type && !r.deleted).sort((a, b) => a.name.localeCompare(b.name)) as UserRecord<T>[];
}

export const getRecord = <T = any>(id: string) => {
  const r = records.get(id);
  return r && !r.deleted ? (r as UserRecord<T>) : undefined;
};

export async function saveRecord<T>(r: Omit<UserRecord<T>, 'updated' | 'created'> & { created?: number }): Promise<UserRecord<T>> {
  const now = Date.now();
  const full: UserRecord<T> = { ...r, created: r.created ?? records.get(r.id)?.created ?? now, updated: now };
  records.set(full.id, full);
  emit();
  await idbSet(full.id, full, store).catch(() => {});
  return full;
}

export async function createRecord<T>(type: RecordType, name: string, data: T): Promise<UserRecord<T>> {
  return saveRecord({ id: newId(), type, name, data });
}

/** Change a record's data with a function (keeps everything else). */
export async function updateRecord<T>(id: string, change: (data: T, rec: UserRecord<T>) => T | void, rename?: string) {
  const cur = getRecord<T>(id);
  if (!cur) return;
  const copy = structuredClone(cur.data);
  const out = change(copy, cur);
  return saveRecord<T>({ ...cur, name: rename ?? cur.name, data: (out ?? copy) as T });
}

export async function deleteRecord(id: string) {
  const cur = records.get(id);
  if (!cur) return;
  // a tombstone, so a later sync can tell other devices
  return saveRecord({ ...cur, deleted: true, data: null });
}

const subscribe = (f: () => void) => {
  subs.add(f);
  void loadUserData();
  return () => subs.delete(f);
};

/** React: re-render when any user record changes. */
export function useUserData(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function useRecords<T = any>(type: RecordType): UserRecord<T>[] {
  useUserData();
  return listRecords<T>(type);
}

export function useRecord<T = any>(id: string): UserRecord<T> | undefined | null {
  useUserData();
  if (!ready) return null; // still loading
  return getRecord<T>(id);
}

export const userDataReady = () => loadUserData();
