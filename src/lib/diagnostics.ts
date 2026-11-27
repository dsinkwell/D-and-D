// Checks each thing the offline downloads need, for the Diagnostics section on About.
// Useful inside the native app, whose built-in browser can differ from Safari.
import { dataBase, dbStatus } from './db';
import { isNative } from './platform';
import { writerAvailability } from './ask/writer';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const msg = (e: unknown) => String((e as Error)?.message || e);

export async function runDiagnostics(): Promise<Check[]> {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail = '') => out.push({ name, ok, detail });
  add('Running as', true, `${isNative() ? 'native app' : 'web app'} · ${location.origin}`);
  add('Secure context', !!window.isSecureContext, String(window.isSecureContext));
  add('Decryption (WebCrypto)', !!crypto?.subtle, crypto?.subtle ? 'available' : 'missing');
  add('WebAssembly', typeof WebAssembly === 'object', '');
  try {
    const d = await navigator.storage.getDirectory();
    const fh = await d.getFileHandle('diag-test.txt', { create: true });
    await d.removeEntry('diag-test.txt');
    add('Private file storage (OPFS)', !!fh, 'works on the page');
  } catch (e) {
    add('Private file storage (OPFS)', false, msg(e));
  }
  try {
    const s = await dbStatus(true);
    add('Offline database engine (worker + OPFS)', s.supported, s.supported ? `installed: ${Object.keys(s.installed).join(', ') || 'nothing yet'}` : s.error || 'not supported');
  } catch (e) {
    add('Offline database engine (worker + OPFS)', false, msg(e));
  }
  for (const name of ['books', 'wiki'] as const) {
    const url = `${dataBase(name)}manifest.json`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      add(`Reach ${name} download`, r.ok, `${r.status} ${url}`);
    } catch (e) {
      add(`Reach ${name} download`, false, `${msg(e)} · ${url}`);
    }
  }
  try {
    const est = await navigator.storage.estimate();
    add('Storage space', true, `${Math.round((est.usage || 0) / 1e6)} MB used of ${Math.round((est.quota || 0) / 1e6)} MB allowed`);
  } catch (e) {
    add('Storage space', false, msg(e));
  }
  if (isNative()) {
    const w = await writerAvailability();
    add('Write an answer (Apple Intelligence)', w.available, w.available ? 'available' : w.reason || 'not available');
  }
  add('Device', true, navigator.userAgent);
  return out;
}
