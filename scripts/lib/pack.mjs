// Splits a SQLite database into gzip-compressed parts (optionally AES-GCM encrypted)
// plus a manifest.json, so it can be served by any static host and streamed into
// the browser's private storage (OPFS) by src/workers/sqlite.worker.ts.
//
// Part format:  plain     -> gzip(bytes)
//               encrypted -> iv(12 bytes) || AES-256-GCM(gzip(bytes))
// Key: PBKDF2-SHA256(passphrase, salt, iterations) -> 256-bit AES-GCM key.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const PART_SIZE = 16 * 1024 * 1024; // raw bytes per part (multiple of 512)
export const PBKDF2_ITERATIONS = 600_000;
const CHECK_TEXT = 'realms-codex-unlock-check';

export function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  return crypto.pbkdf2Sync(passphrase.normalize('NFC'), salt, iterations, 32, 'sha256');
}

function encrypt(key, data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  return Buffer.concat([iv, body]);
}

/**
 * @param {string} dbFile        path to the SQLite file
 * @param {string} outDir        directory to write parts + manifest.json into (emptied first)
 * @param {object} opts          { name, version, passphrase?, extra? }
 */
export function packDatabase(dbFile, outDir, opts) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const raw = fs.readFileSync(dbFile);
  let key = null;
  const manifest = {
    name: opts.name,
    version: opts.version,
    built: new Date().toISOString(),
    dbBytes: raw.length,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    parts: [],
    ...(opts.extra || {}),
  };
  if (opts.passphrase) {
    const salt = crypto.randomBytes(16);
    key = deriveKey(opts.passphrase, salt);
    manifest.encryption = {
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: salt.toString('base64'),
      check: encrypt(key, Buffer.from(CHECK_TEXT)).toString('base64'),
    };
  }
  const size = opts.partSize || PART_SIZE;
  if (size % 512) throw new Error('partSize must be a multiple of 512');
  for (let off = 0, i = 0; off < raw.length; off += size, i++) {
    let part = zlib.gzipSync(raw.subarray(off, off + size), { level: 9 });
    if (key) part = encrypt(key, part);
    const file = `part-${String(i).padStart(3, '0')}.bin`;
    fs.writeFileSync(path.join(outDir, file), part);
    manifest.parts.push({ file, bytes: part.length });
  }
  manifest.downloadBytes = manifest.parts.reduce((s, p) => s + p.bytes, 0);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Reverses packDatabase (used by tests and to verify a build). */
export function unpackDatabase(dir, passphrase) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const key = m.encryption ? deriveKey(passphrase, Buffer.from(m.encryption.salt, 'base64'), m.encryption.iterations) : null;
  const out = [];
  for (const p of m.parts) {
    let buf = fs.readFileSync(path.join(dir, p.file));
    if (key) {
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(buf.length - 16);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      buf = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
    }
    out.push(zlib.gunzipSync(buf));
  }
  const all = Buffer.concat(out);
  if (crypto.createHash('sha256').update(all).digest('hex') !== m.sha256) throw new Error('checksum mismatch');
  return all;
}
