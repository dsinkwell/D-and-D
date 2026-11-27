// Ask box engine: meaning search (ask.worker) + keyword search, merged, with passage text.
import { booksReady, bookEntryHref, listBuiltInBooks, blocksFor } from '../books';
import { isInstalled, query } from '../db';
import { getEntry, loadDoc, entryHref, CATEGORY_LABEL, type Category } from '../srd';
import { searchRules } from '../catalog';
import { offlineSearch } from '../wikiOffline';
import { wikiHref } from '../router';
import { keywords, textOf } from './highlight';
import { isNative } from '../platform';

export type AskSource = 'srd' | 'books' | 'wiki';

export interface Passage {
  key: string;
  source: AskSource;
  title: string;
  kind?: string; // spell, feat… or 'wiki' / 'rule'
  label: string; // "PHB p. 232", "SRD", "Wiki"
  href: string;
  html: string; // passage HTML (may be long)
  score: number; // fused rank score (meaning + keyword)
  sim?: number; // meaning similarity to the question (cosine), when found by meaning search
}

const base = import.meta.env.BASE_URL;
const absBase = () => new URL(base, location.href).href;

// ------------------------------------------------------------------ worker

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('../../workers/ask.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.res(ev.data.data);
      else p.rej(new Error(ev.data.error));
    };
  }
  const id = ++seq;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res, rej });
    worker!.postMessage({ id, ...msg }, transfer);
  });
}

// ------------------------------------------------------------------ model files (offline)

export const MODEL_FILES = [
  'models/Xenova/bge-small-en-v1.5/config.json',
  'models/Xenova/bge-small-en-v1.5/tokenizer.json',
  'models/Xenova/bge-small-en-v1.5/tokenizer_config.json',
  'models/Xenova/bge-small-en-v1.5/special_tokens_map.json',
  'models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx',
  'ort/ort-wasm-simd-threaded.wasm',
  'ort/ort-wasm-simd-threaded.mjs',
  'ask/srd-vectors.i8',
  'ask/srd-passages.json',
];
const CACHE = 'ask-models';

/** Are the Ask model files stored on this device? */
export async function askDownloaded(): Promise<boolean> {
  if (isNative()) return true; // the native app bundles the model files
  try {
    const c = await caches.open(CACHE);
    for (const f of MODEL_FILES) if (!(await c.match(new URL(f, absBase()).href, { ignoreVary: true }))) return false;
    return true;
  } catch {
    return false;
  }
}

/** Download the model files into the cache the service worker serves them from. */
export async function downloadAsk(onProgress: (done: number, total: number) => void) {
  if (isNative()) return onProgress(1, 1); // bundled with the app (and the Cache API can't store app:// URLs)
  const c = await caches.open(CACHE);
  const sizes = [0.01, 0.7, 0.01, 0.01, 34, 11.1, 0.02, 1.7, 0.2]; // MB, for the progress bar
  const total = sizes.reduce((a, b) => a + b, 0);
  let done = 0;
  for (let i = 0; i < MODEL_FILES.length; i++) {
    const url = new URL(MODEL_FILES[i], absBase()).href;
    if (!(await c.match(url, { ignoreVary: true }))) {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${MODEL_FILES[i]}: HTTP ${r.status}`);
      await c.put(url, r);
    }
    done += sizes[i];
    onProgress(done, total);
  }
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

export async function removeAsk() {
  await caches.delete(CACHE);
  ready = null;
}

// ------------------------------------------------------------------ indexes

interface Refs {
  srd?: [string, number, number][];
  books?: { ref: number; start: number; end: number }[];
  wiki?: { ref: number }[];
}
const refs: Refs = {};
let ready: Promise<void> | null = null;
const loaded = new Set<AskSource>();

async function loadBlobRows(db: 'books' | 'wiki') {
  const rows = await query<{ data: Uint8Array }>(db, 'SELECT data FROM ask_vectors ORDER BY n');
  const total = rows.reduce((a, r) => a + r.data.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const r of rows) {
    out.set(r.data, o);
    o += r.data.byteLength;
  }
  return out.buffer;
}

async function loadSource(src: AskSource) {
  if (loaded.has(src)) return;
  if (src === 'srd') {
    const [vec, meta] = await Promise.all([
      fetch(`${base}ask/srd-vectors.i8`).then((r) => r.arrayBuffer()),
      fetch(`${base}ask/srd-passages.json`).then((r) => r.json()),
    ]);
    refs.srd = meta.passages;
    await call({ op: 'load', source: 'srd', data: vec }, [vec]);
  } else {
    const db = src;
    if (!(await isInstalled(db))) return;
    const has = await query<{ n: number }>(db, "SELECT count(*) n FROM sqlite_master WHERE name = 'ask_vectors'");
    if (!has[0]?.n) return; // an older download without the meaning index
    const [vec, rows] = await Promise.all([loadBlobRows(db), query<any>(db, 'SELECT ref, start, "end" FROM ask_passages ORDER BY id')]);
    if (src === 'books') refs.books = rows;
    else refs.wiki = rows;
    await call({ op: 'load', source: src, data: vec }, [vec]);
  }
  loaded.add(src);
}

/** Start the model and load every available index (idempotent). */
export function prepareAsk(): Promise<void> {
  ready ??= (async () => {
    await call({ op: 'init', base: absBase() });
    await Promise.all((['srd', 'books', 'wiki'] as AskSource[]).map((s) => loadSource(s).catch((e) => console.warn('ask index', s, e))));
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** Load indexes that became available later (e.g. the wiki finished downloading). */
export async function refreshAskIndexes() {
  await Promise.all((['books', 'wiki'] as AskSource[]).map((s) => loadSource(s).catch(() => {})));
}

// ------------------------------------------------------------------ passages

let bookShort: Map<string, string> | null = null;

async function srdPassage(i: number, score: number): Promise<Passage | null> {
  const r = refs.srd?.[i];
  if (!r) return null;
  const e = await getEntry(r[0]);
  if (!e) return null;
  const doc = await loadDoc(e.d);
  return {
    key: `srd:${e.i}:${r[1]}`,
    source: 'srd',
    title: e.t,
    kind: e.c,
    label: 'SRD',
    href: entryHref(e),
    html: doc.blocks.slice(r[1], r[2]).join('\n'),
    score,
  };
}

async function bookPassage(i: number, score: number): Promise<Passage | null> {
  const r = refs.books?.[i];
  if (!r) return null;
  const rows = await query<any>('books', 'SELECT id, book, anchor, title, kind, page FROM entries WHERE id = ?', [r.ref]);
  const e = rows[0];
  if (!e) return null;
  bookShort ??= new Map((await listBuiltInBooks()).map((b) => [b.id, b.short]));
  const blocks = await blocksFor(e.book, r.start, r.end);
  return {
    key: `bk:${e.id}:${r.start}`,
    source: 'books',
    title: e.title,
    kind: e.kind,
    label: `${bookShort.get(e.book) || e.book} p. ${e.page}`,
    href: bookEntryHref(e),
    html: blocks.join('\n'),
    score,
  };
}

async function wikiPassage(i: number, score: number): Promise<Passage | null> {
  const r = refs.wiki?.[i];
  if (!r) return null;
  return wikiById(r.ref, score);
}

async function wikiById(id: number, score: number): Promise<Passage | null> {
  const rows = await query<any>('wiki', 'SELECT id, title, display, summary FROM articles WHERE id = ?', [id]);
  const a = rows[0];
  if (!a) return null;
  return { key: `wiki:${a.id}`, source: 'wiki', title: textOf(a.display || a.title), kind: 'wiki', label: 'Realms Wiki', href: wikiHref(a.title), html: `<p>${escapeHtml(a.summary || '')}</p>`, score };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ------------------------------------------------------------------ ask

export interface AskResult {
  passages: Passage[];
  ms: { embed: number; search: number; total: number };
  meaning: boolean; // false = keyword search only (model not downloaded)
}

/**
 * Meaning search over everything on the device, merged with keyword search (reciprocal rank
 * fusion), so exact names ("Elminster") and paraphrases ("can wizards cast in armor") both work.
 */
export async function ask(q: string, limit = 8): Promise<AskResult> {
  const t0 = performance.now();
  const meaning = await askDownloaded();
  if (meaning) await prepareAsk();
  const none = { hits: [] as { source: AskSource; i: number; score: number }[], ms: { embed: 0, search: 0 } };
  const [sem, kw, wk] = await Promise.all([
    meaning ? call<typeof none>({ op: 'search', q, k: 40 }) : none,
    searchRules(keywords(q) || q, 30).catch(() => []),
    offlineSearch(keywords(q) || q, 12).catch(() => []),
  ]);
  const fused = new Map<string, { score: number; make: () => Promise<Passage | null> }>();
  const add = (key: string, rank: number, make: () => Promise<Passage | null>, weight = 1) => {
    const cur = fused.get(key);
    const s = weight / (50 + rank);
    if (cur) cur.score += s;
    else fused.set(key, { score: s, make });
  };
  // meaning hits: one per entry (the best passage of each)
  const seenEntry = new Set<string>();
  sem.hits.forEach((h, rank) => {
    const ent = h.source === 'srd' ? `srd:${refs.srd?.[h.i]?.[0]}` : h.source === 'books' ? `bk:${refs.books?.[h.i]?.ref}` : `wiki:${refs.wiki?.[h.i]?.ref}`;
    if (seenEntry.has(ent)) return;
    seenEntry.add(ent);
    const make = h.source === 'srd' ? () => srdPassage(h.i, h.score) : h.source === 'books' ? () => bookPassage(h.i, h.score) : () => wikiPassage(h.i, h.score);
    add(ent, rank, make, 1.2);
  });
  // keyword hits: rules & books catalog rows, wiki articles
  kw.forEach((it, rank) => {
    const src = it.sources[0];
    const m = src.href.match(/^#\/book\/([^/]+)\/(.+)$/);
    const key = src.srd ? `srdh:${src.href}` : `bkh:${src.href}`;
    // map onto the meaning key when the same entry already came from meaning search
    const existing = [...fused.keys()].find((k) => k === key);
    add(existing || key, rank, async () => {
      if (src.srd) {
        const id = src.href.replace(/^#\/srd\/e\//, '');
        const e = await getEntry(id);
        if (!e) return null;
        const doc = await loadDoc(e.d);
        return { key, source: 'srd', title: e.t, kind: e.c, label: 'SRD', href: src.href, html: doc.blocks.slice(e.s, Math.min(e.e, e.s + 12)).join('\n'), score: 0 };
      }
      if (!m) return null;
      const rows = await query<any>('books', 'SELECT id, book, anchor, title, kind, page, start, "end" FROM entries WHERE book = ? AND anchor = ?', [m[1], decodeURIComponent(m[2])]);
      const e = rows[0];
      if (!e) return null;
      bookShort ??= new Map((await listBuiltInBooks()).map((b) => [b.id, b.short]));
      const blocks = await blocksFor(e.book, e.start, Math.min(e.end, e.start + 12));
      return { key, source: 'books', title: e.title, kind: e.kind, label: `${bookShort.get(e.book) || e.book} p. ${e.page}`, href: src.href, html: blocks.join('\n'), score: 0 };
    });
  });
  wk.forEach((h: any, rank) => {
    add(`wikit:${h.title}`, rank, async () => {
      const rows = await query<any>('wiki', 'SELECT id FROM articles WHERE title = ?', [h.title]);
      return rows[0] ? wikiById(rows[0].id, 0) : null;
    }, 0.8);
  });
  const top = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit * 2);
  const out: Passage[] = [];
  const titles = new Set<string>();
  for (const [, v] of top) {
    const p = await v.make().catch(() => null);
    if (!p) continue;
    const tk = `${p.source}:${p.title.toLowerCase()}`;
    if (titles.has(tk)) continue;
    titles.add(tk);
    if (p.score > 0) p.sim = p.score; // meaning-search passages arrive with their cosine similarity
    p.score = v.score;
    out.push(p);
    if (out.length >= limit) break;
  }
  return { passages: out, ms: { ...sem.ms, total: Math.round(performance.now() - t0) }, meaning };
}

export const kindLabel = (k?: string) => (k === 'wiki' ? '' : k && k !== 'rule' ? CATEGORY_LABEL[k as Category] || k : 'Rules');
export { booksReady };
