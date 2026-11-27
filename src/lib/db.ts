// Main-thread client for the SQLite worker (src/workers/sqlite.worker.ts).
import { isNative, WEB_HOME } from './platform';
import { useEffect, useState } from 'react';
import { requestPersistence } from './storage';

export type DbName = 'wiki' | 'books';

export interface InstallProgress {
  received: number;
  total: number;
  part: number;
  parts: number;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: InstallProgress) => void }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/sqlite.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, result, error, progress } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress) return p.onProgress?.(progress);
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Database worker failed'));
      pending.clear();
    };
  }
  return worker;
}

function call<T>(msg: Record<string, unknown>, onProgress?: (p: InstallProgress) => void): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, ...msg });
  });
}

// ------------------------------------------------------------------ status

type Status = { supported: boolean; installed: Partial<Record<DbName, string>>; error?: string };
let statusP: Promise<Status> | null = null;
const listeners = new Set<() => void>();

export function dbStatus(refresh = false): Promise<Status> {
  if (refresh || !statusP) {
    statusP = call<Record<string, string>>({ op: 'init' })
      .then((installed) => ({ supported: true, installed }))
      .catch((e) => ({ supported: false, installed: {}, error: String(e?.message || e) }));
    statusP.then(() => listeners.forEach((l) => l()));
  }
  return statusP;
}

export function useDbStatus() {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => dbStatus().then((x) => live && setS(x));
    load();
    listeners.add(load);
    return () => {
      live = false;
      listeners.delete(load);
    };
  }, []);
  return s;
}

export async function isInstalled(name: DbName) {
  const s = await dbStatus();
  return !!s.installed[name];
}

// ------------------------------------------------------------------ data

// Absolute URL: the worker resolves relative URLs against its own script location.
// The native app doesn't bundle the big data packs; it downloads them from the published site.
export const dataBase = (name: DbName) =>
  isNative() ? `${WEB_HOME}data/${name}/` : new URL(`${import.meta.env.BASE_URL}data/${name}/`, window.location.href).href;

export interface RemoteManifest {
  name: string;
  version: string;
  built: string;
  dbBytes: number;
  downloadBytes: number;
  parts: { file: string; bytes: number }[];
  encryption?: unknown;
  [k: string]: unknown;
}

/** Why the last remoteManifest() call returned null (shown to the user). */
export const manifestError: Partial<Record<DbName, string>> = {};

export async function remoteManifest(name: DbName): Promise<RemoteManifest | null> {
  const url = `${dataBase(name)}manifest.json`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      manifestError[name] = `HTTP ${r.status} from ${url}`;
      return null;
    }
    delete manifestError[name];
    return await r.json();
  } catch (e) {
    manifestError[name] = `${String((e as Error)?.message || e)} (${url})`;
    return null;
  }
}

export async function installDb(name: DbName, onProgress: (p: InstallProgress) => void, passphrase?: string) {
  await requestPersistence();
  const r = await call<{ version: string }>({ op: 'install', name, base: dataBase(name), passphrase }, onProgress);
  await dbStatus(true);
  return r;
}

export async function removeDb(name: DbName) {
  await call({ op: 'remove', name });
  await dbStatus(true);
}

export function query<T = Record<string, any>>(name: DbName, sql: string, params: unknown[] = []): Promise<T[]> {
  return call<T[]>({ op: 'query', name, sql, params });
}

export async function inflate(data: Uint8Array | null | undefined): Promise<string> {
  if (!data) return '';
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** Turn free text into a safe FTS5 query: each word as a prefix term, quoted phrases kept. */
export function ftsQuery(q: string): string {
  const out: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_, p) => {
    out.push(`"${p.replace(/"/g, '')}"`);
    return ' ';
  });
  for (const w of rest.split(/[^\p{L}\p{N}']+/u).filter(Boolean)) out.push(`"${w.replace(/"/g, '')}"*`);
  return out.join(' ');
}
