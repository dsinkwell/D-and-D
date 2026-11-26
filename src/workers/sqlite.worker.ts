/// <reference lib="webworker" />
// SQLite (official WASM build) running in a worker, storing databases in the Origin
// Private File System via the "opfs-sahpool" VFS (works in Safari 16.4+, Chrome, Firefox;
// no special server headers required).
//
// Databases are installed from packed parts produced by scripts/lib/pack.mjs and are
// versioned on disk as "/<name>@<version>.db" so an update never breaks the copy in use.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Req =
  | { id: number; op: 'init' }
  | { id: number; op: 'install'; name: string; base: string; passphrase?: string }
  | { id: number; op: 'query'; name: string; sql: string; params?: unknown[] }
  | { id: number; op: 'remove'; name: string };

let poolP: Promise<any> | null = null;
const open = new Map<string, { db: any; file: string; version: string }>();

function pool() {
  poolP ??= (async () => {
    const sqlite3 = await sqlite3InitModule();
    return sqlite3.installOpfsSAHPoolVfs({ name: 'realms-codex', initialCapacity: 12, clearOnInit: false });
  })();
  return poolP;
}

const fileVersion = (f: string) => f.slice(f.indexOf('@') + 1, -3);

/** Newest installed file for each database name. */
async function installed(): Promise<Record<string, { file: string; version: string }>> {
  const p = await pool();
  const out: Record<string, { file: string; version: string }> = {};
  for (const f of p.getFileNames() as string[]) {
    const m = f.match(/^\/([a-z]+)@(.+)\.db$/);
    if (!m) continue;
    if (!out[m[1]] || out[m[1]].version < m[2]) out[m[1]] = { file: f, version: m[2] };
  }
  return out;
}

async function getDb(name: string) {
  const cur = open.get(name);
  if (cur) return cur.db;
  const inst = (await installed())[name];
  if (!inst) throw new Error(`${name} is not installed on this device`);
  const p = await pool();
  const db = new p.OpfsSAHPoolDb(inst.file);
  open.set(name, { db, ...inst });
  return db;
}

function closeDb(name: string) {
  const cur = open.get(name);
  if (cur) {
    try {
      cur.db.close();
    } catch {
      /* ignore */
    }
    open.delete(name);
  }
}

// ------------------------------------------------------------------ crypto & compression

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

async function decrypt(key: CryptoKey, buf: Uint8Array) {
  const iv = buf.subarray(0, 12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, buf.subarray(12)));
}

async function gunzip(buf: Uint8Array) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fetchRetry(url: string, tries = 4): Promise<Uint8Array> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
    }
  }
  throw last;
}

// ------------------------------------------------------------------ install

async function install(id: number, name: string, base: string, passphrase?: string) {
  const p = await pool();
  const manifest = JSON.parse(new TextDecoder().decode(await fetchRetry(`${base}manifest.json`)));
  let key: CryptoKey | null = null;
  if (manifest.encryption) {
    if (!passphrase) throw new Error('PASSPHRASE_REQUIRED');
    key = await deriveKey(passphrase, b64(manifest.encryption.salt), manifest.encryption.iterations);
    try {
      const check = new TextDecoder().decode(await decrypt(key, b64(manifest.encryption.check)));
      if (check !== 'realms-codex-unlock-check') throw new Error();
    } catch {
      throw new Error('WRONG_PASSPHRASE');
    }
  }

  const version = String(manifest.version).replace(/[^0-9A-Za-z.\-_]/g, '');
  const file = `/${name}@${version}.db`;
  const current = (await installed())[name];
  if (current?.version === version) return { version, already: true };

  if ((p.getCapacity() as number) - (p.getFileCount() as number) < 3) await p.addCapacity(4);

  let i = 0;
  let received = 0;
  const total = manifest.downloadBytes || manifest.parts.reduce((s: number, x: any) => s + x.bytes, 0);
  post({ id, progress: { received, total, part: 0, parts: manifest.parts.length } });
  try {
    await p.importDb(file, async () => {
      if (i >= manifest.parts.length) return undefined;
      const part = manifest.parts[i++];
      let buf = await fetchRetry(`${base}${part.file}`);
      received += buf.length;
      if (key) buf = await decrypt(key, buf);
      const raw = await gunzip(buf);
      post({ id, progress: { received, total, part: i, parts: manifest.parts.length } });
      return raw;
    });
  } catch (e) {
    try {
      p.unlink(file);
    } catch {
      /* ignore */
    }
    throw e;
  }

  // Switch over and delete older versions.
  closeDb(name);
  for (const f of p.getFileNames() as string[]) {
    if (f.startsWith(`/${name}@`) && f !== file) p.unlink(f);
  }
  return { version, bytes: manifest.dbBytes };
}

// ------------------------------------------------------------------ messaging

function post(msg: unknown, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    let result: unknown;
    const transfer: Transferable[] = [];
    switch (req.op) {
      case 'init': {
        await pool();
        const inst = await installed();
        result = Object.fromEntries(Object.entries(inst).map(([k, v]) => [k, v.version]));
        break;
      }
      case 'install':
        result = await install(req.id, req.name, req.base, req.passphrase);
        break;
      case 'query': {
        const db = await getDb(req.name);
        const rows = db.exec({ sql: req.sql, bind: req.params ?? [], rowMode: 'object', returnValue: 'resultRows' }) as Record<string, unknown>[];
        for (const r of rows) for (const v of Object.values(r)) if (v instanceof Uint8Array) transfer.push(v.buffer);
        result = rows;
        break;
      }
      case 'remove': {
        closeDb(req.name);
        const p = await pool();
        for (const f of p.getFileNames() as string[]) if (f.startsWith(`/${req.name}@`)) p.unlink(f);
        result = true;
        break;
      }
    }
    post({ id: req.id, result }, transfer);
  } catch (e: any) {
    post({ id: req.id, error: e?.message || String(e) });
  }
};
