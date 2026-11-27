// iCloud sync (native app only): the user's own data follows them between their iPhone, iPad and
// Mac on the same Apple ID, through iCloud key-value storage (ios/App/App/CloudSyncPlugin.swift).
//
// What syncs, and how conflicts are settled ("last change wins"):
//   r:<id>     one key per user record (character, list, homebrew, house rules), compared by
//              the record's `updated` time; deletions travel as tombstones
//   d:<name>   whole small documents — bookmarks, Jump to buttons, the house-rules switch, the
//              name shown on shared files — compared by the time they last changed on a device
// The web app has no iCloud: there, sharing files is the way to move data between devices.
import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';
import { allRecordsForSync, applyRemote, onSaved, type UserRecord } from './userdata';
import { readLocal, writeLocal } from './storage';

export interface CloudSyncPlugin {
  status(): Promise<{ signedIn: boolean; keys: number; bytes: number }>;
  getAll(): Promise<{ values: Record<string, string> }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
  addListener(event: 'cloudChanged', fn: (d: { values: Record<string, string | null>; reason: number }) => void): Promise<{ remove: () => Promise<void> }>;
}
// (never let a promise resolve with the plugin object — see the note in ask/writer.ts)
let plugin: CloudSyncPlugin | null = null;
const getPlugin = (): CloudSyncPlugin => (plugin ??= registerPlugin<CloudSyncPlugin>('CloudSync'));
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('iCloud did not answer')), ms))]);

// ------------------------------------------------------------------ documents (local-storage values)

interface Doc {
  name: string;
  key: string; // localStorage key
  event: string; // window event the app fires when it changes, and listens to for a refresh
}
const DOCS: Doc[] = [
  { name: 'bookmarks', key: 'rc.bookmarks', event: 'rc-marks-changed' },
  { name: 'shortcuts', key: 'jump-shortcuts', event: 'shortcuts-changed' },
  { name: 'houserules', key: 'rc.houserules.on', event: 'rc-houserules' },
  { name: 'author', key: 'rc.author', event: 'rc-author' },
];
const DOC_TIMES = 'rc.sync.doc-times';
const docTimes = () => readLocal<Record<string, number>>(DOC_TIMES, {});
const setDocTime = (name: string, t: number) => writeLocal(DOC_TIMES, { ...docTimes(), [name]: t });
const rawLocal = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------ status

export interface SyncState {
  on: boolean;
  available: boolean; // native app with the plugin answering
  signedIn?: boolean;
  lastSync?: number;
  bytes?: number;
  keys?: number;
  error?: string;
  quotaFull?: boolean;
}
const ON_KEY = 'rc.sync.on';
let state: SyncState = { on: readLocal<boolean>(ON_KEY, true), available: false };
const subs = new Set<(s: SyncState) => void>();
const setState = (p: Partial<SyncState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f(state));
};
export const syncState = () => state;
export function onSyncState(f: (s: SyncState) => void) {
  subs.add(f);
  return () => void subs.delete(f);
}

// ------------------------------------------------------------------ syncing

let started = false;
let applying = false; // while writing values that came from iCloud: don't push them back

async function push(key: string, value: string) {
  if (!state.on || !state.available) return;
  try {
    await withTimeout(getPlugin().set({ key, value }), 5000);
    setState({ lastSync: Date.now(), error: undefined });
  } catch (e) {
    setState({ error: String((e as Error)?.message || e) });
  }
}

const pushRecord = (r: UserRecord) => push(`r:${r.id}`, JSON.stringify(r));

function pushDoc(d: Doc) {
  const t = Date.now();
  setDocTime(d.name, t);
  return push(`d:${d.name}`, JSON.stringify({ updated: t, value: rawLocal(d.key) }));
}

/** Take what iCloud has that is newer than this device's copy. */
async function applyValues(values: Record<string, string | null>) {
  applying = true;
  try {
    for (const [key, raw] of Object.entries(values)) {
      if (raw == null) continue;
      if (key.startsWith('r:')) {
        try {
          const r = JSON.parse(raw) as UserRecord;
          if (r?.id && r.type) await applyRemote(r);
        } catch {
          /* ignore a damaged value */
        }
      } else if (key.startsWith('d:')) {
        const d = DOCS.find((x) => `d:${x.name}` === key);
        if (!d) continue;
        try {
          const { updated, value } = JSON.parse(raw) as { updated: number; value: string | null };
          if (updated > (docTimes()[d.name] || 0)) {
            if (value == null) localStorage.removeItem(d.key);
            else localStorage.setItem(d.key, value);
            setDocTime(d.name, updated);
            window.dispatchEvent(new Event(d.event));
          }
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    applying = false;
  }
}

/** Full sync: take newer values from iCloud, then send what this device has that is newer. */
export async function syncNow() {
  if (!state.on || !state.available) return;
  try {
    const { values } = await withTimeout(getPlugin().getAll(), 8000);
    await applyValues(values);
    for (const r of await allRecordsForSync()) {
      const cloud = values[`r:${r.id}`];
      let cloudTime = 0;
      try {
        cloudTime = cloud ? (JSON.parse(cloud) as UserRecord).updated : 0;
      } catch {
        /* damaged: overwrite */
      }
      if (r.updated > cloudTime) await pushRecord(r);
    }
    for (const d of DOCS) {
      const cloud = values[`d:${d.name}`];
      let cloudTime = 0;
      try {
        cloudTime = cloud ? JSON.parse(cloud).updated : 0;
      } catch {
        /* overwrite */
      }
      const mine = docTimes()[d.name] || 0;
      // a value set before sync existed has no time yet: send it once
      if ((mine > cloudTime || (!mine && !cloud)) && rawLocal(d.key) != null) await pushDoc(d);
    }
    const st = await withTimeout(getPlugin().status(), 5000);
    setState({ ...st, lastSync: Date.now(), error: undefined });
  } catch (e) {
    setState({ error: String((e as Error)?.message || e) });
  }
}

/** Start iCloud sync (native app; once). `testStore` stands in for iCloud in browser tests. */
export async function startCloudSync(testStore?: CloudSyncPlugin) {
  if (testStore) plugin = testStore;
  if (started || (!isNative() && !testStore)) return;
  started = true;
  try {
    const st = await withTimeout(getPlugin().status(), 5000);
    setState({ available: true, ...st });
  } catch (e) {
    setState({ available: false, error: String((e as Error)?.message || e) });
    return;
  }
  onSaved((r) => {
    if (!applying) void pushRecord(r);
  });
  for (const d of DOCS) {
    window.addEventListener(d.event, () => {
      if (!applying) void pushDoc(d);
    });
  }
  // changes made on the user's other devices
  getPlugin()
    .addListener('cloudChanged', ({ values, reason }) => {
      if (reason === 2) setState({ quotaFull: true });
      if (state.on) void applyValues(values).then(() => setState({ lastSync: Date.now() }));
    })
    .catch(() => {});
  // the app coming back to the foreground: catch up
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  await syncNow();
}

export function setSyncOn(on: boolean) {
  writeLocal(ON_KEY, on);
  setState({ on });
  if (on) void syncNow();
}
