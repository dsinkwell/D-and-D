// Builds the offline Forgotten Realms Wiki database.
//
//   node scripts/build-wiki.mjs [--max-minutes N] [--limit N] [--concurrency N] [--export-only]
//
// 1. Lists every article (namespace 0) with its latest revision id, plus all redirects.
// 2. Fetches rendered HTML (action=parse) for new/changed articles into a cache DB
//    (data-build/wiki-cache.db). Re-runs only fetch what changed, and a run that is
//    stopped (Ctrl-C or --max-minutes) resumes where it left off.
// 3. Exports a compact read-only database with full-text search (FTS5) and packs it
//    into public/data/wiki/ for the app to download.
//
// Text content: Forgotten Realms Wiki contributors, CC BY-SA 3.0.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { cleanArticleHtml, summaryFrom } from './lib/wikihtml.mjs';
import { packDatabase } from './lib/pack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.WIKI_API || 'https://forgottenrealms.fandom.com/api.php';
const UA = 'RealmsCodexOfflineBuilder/1.0 (personal offline reader; MediaWiki API)';
const BUILD = path.join(root, 'data-build');
const CACHE = path.join(BUILD, 'wiki-cache.db');
const OUT_DB = path.join(BUILD, 'wiki.db');
const OUT_DIR = path.join(root, 'public/data/wiki');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
};
const MAX_MS = Number(opt('max-minutes', 0)) * 60_000 || Infinity;
const LIMIT = Number(opt('limit', 0)) || Infinity;
const CONCURRENCY = Number(opt('concurrency', 3));
const EXPORT_ONLY = !!opt('export-only', false);
const started = Date.now();
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('\nStopping after in-flight requests… (Ctrl-C again to force)');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(params, attempt = 0) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  try {
    const res = await fetch(`${API}?${qs}`, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
    if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retryAfter: Number(res.headers.get('retry-after')) || 0 });
    const data = await res.json();
    if (data.error?.code === 'maxlag') throw Object.assign(new Error('maxlag'), { retryAfter: 5 });
    if (data.error && params.action !== 'parse') throw Object.assign(new Error(`API error: ${data.error.info}`), { fatal: true });
    return data;
  } catch (e) {
    if (e.fatal || attempt >= 6) throw e;
    const wait = Math.max((e.retryAfter || 0) * 1000, 1500 * 2 ** attempt);
    await sleep(wait);
    return api(params, attempt + 1);
  }
}

// ------------------------------------------------------------------ cache db

fs.mkdirSync(BUILD, { recursive: true });
const cache = new DatabaseSync(CACHE);
cache.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS pages (
    pageid INTEGER PRIMARY KEY, title TEXT NOT NULL, revid INTEGER, display TEXT,
    raw BLOB, cats TEXT, fetched INTEGER
  );
  CREATE TABLE IF NOT EXISTS listing (pageid INTEGER PRIMARY KEY, title TEXT, revid INTEGER);
  CREATE TABLE IF NOT EXISTS redirects (src TEXT PRIMARY KEY, dst TEXT, frag TEXT);
  CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
`);
const getState = (k) => cache.prepare('SELECT value FROM state WHERE key=?').get(k)?.value;
const setState = (k, v) => cache.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(k, String(v));

// ------------------------------------------------------------------ 1. listing

async function refreshListing() {
  log('Listing articles…');
  cache.exec('DELETE FROM listing');
  const ins = cache.prepare('INSERT OR REPLACE INTO listing VALUES(?,?,?)');
  let cont = {};
  let n = 0;
  do {
    const d = await api({ action: 'query', generator: 'allpages', gapnamespace: '0', gapfilterredir: 'nonredirects', gaplimit: '500', prop: 'info', ...cont });
    cache.exec('BEGIN');
    for (const p of d.query?.pages ?? []) ins.run(p.pageid, p.title, p.lastrevid);
    cache.exec('COMMIT');
    n += d.query?.pages?.length ?? 0;
    cont = d.continue ?? null;
    if (cont && n % 10000 === 0) log(`  ${n} articles listed`);
  } while (cont);
  log(`  ${n} articles total`);

  log('Listing redirects…');
  // Pass 1: redirect page ids -> their titles.  Pass 2: redirect page ids -> targets.
  const fromTitle = new Map();
  cont = {};
  do {
    const d = await api({ action: 'query', list: 'allpages', apnamespace: '0', apfilterredir: 'redirects', aplimit: '500', ...cont });
    for (const p of d.query?.allpages ?? []) fromTitle.set(p.pageid, p.title);
    cont = d.continue ?? null;
  } while (cont);
  cache.exec('DELETE FROM redirects');
  const insR = cache.prepare('INSERT OR REPLACE INTO redirects VALUES(?,?,?)');
  cont = {};
  n = 0;
  do {
    const d = await api({ action: 'query', list: 'allredirects', arnamespace: '0', arprop: 'ids|title|fragment', arlimit: '500', ...cont });
    cache.exec('BEGIN');
    for (const r of d.query?.allredirects ?? []) {
      const src = fromTitle.get(r.fromid);
      if (src) {
        insR.run(src, r.title, r.fragment ?? null);
        n++;
      }
    }
    cache.exec('COMMIT');
    cont = d.continue ?? null;
  } while (cont);
  log(`  ${n} redirects (of ${fromTitle.size} redirect pages)`);
  setState('listed', Date.now());
}

// ------------------------------------------------------------------ 2. fetch

async function fetchChanged() {
  // Remove articles that no longer exist (deleted or turned into redirects).
  const removed = cache.prepare('DELETE FROM pages WHERE pageid NOT IN (SELECT pageid FROM listing)').run().changes;
  if (removed) log(`Removed ${removed} articles that no longer exist`);

  const todo = cache
    .prepare(`SELECT l.pageid, l.title, l.revid FROM listing l LEFT JOIN pages p ON p.pageid = l.pageid
              WHERE p.pageid IS NULL OR p.revid IS NOT l.revid ORDER BY l.pageid`)
    .all();
  const total = Math.min(todo.length, LIMIT);
  log(`${todo.length} articles to fetch${total < todo.length ? ` (limited to ${total})` : ''}`);
  if (!total) return true;

  const upsert = cache.prepare(`INSERT OR REPLACE INTO pages (pageid, title, revid, display, raw, cats, fetched)
                                VALUES (?,?,?,?,?,?,?)`);
  let done = 0;
  let failed = 0;
  let idx = 0;
  const t0 = Date.now();
  let batch = [];
  const flush = () => {
    if (!batch.length) return;
    cache.exec('BEGIN');
    for (const row of batch) upsert.run(...row);
    cache.exec('COMMIT');
    batch = [];
  };

  const worker = async () => {
    while (idx < total && !stopping && Date.now() - started < MAX_MS) {
      const item = todo[idx++];
      try {
        const d = await api({ action: 'parse', pageid: String(item.pageid), prop: 'text|displaytitle|categories|revid', disableeditsection: '1', disabletoc: '1', disablelimitreport: '1' });
        if (!d.parse) throw new Error(d.error?.info || 'no parse');
        const p = d.parse;
        const display = String(p.displaytitle || '').replace(/<(?!\/?i>)[^>]+>/g, '');
        const cats = (p.categories || []).filter((c) => !c.hidden).map((c) => String(c.category).replace(/_/g, ' '));
        batch.push([
          item.pageid,
          p.title,
          p.revid ?? item.revid,
          display && display !== p.title ? display : null,
          zlib.deflateRawSync(p.text, { level: 6 }),
          cats.join('\n'),
          Date.now(),
        ]);
        if (batch.length >= 50) flush();
      } catch (e) {
        failed++;
        if (failed < 20) log(`  ! ${item.title}: ${e.message}`);
      }
      done++;
      if (done % 250 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        log(`  ${done}/${total} (${rate.toFixed(1)}/s, ~${Math.round((total - done) / rate / 60)} min left, ${failed} failed)`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  flush();
  log(`Fetched ${done - failed} articles (${failed} failed)`);
  const remaining = cache
    .prepare(`SELECT count(*) n FROM listing l LEFT JOIN pages p ON p.pageid = l.pageid WHERE p.pageid IS NULL OR p.revid IS NOT l.revid`)
    .get().n;
  return remaining === 0;
}

// ------------------------------------------------------------------ 3. export

function exportDb(complete) {
  log('Exporting offline database…');
  fs.rmSync(OUT_DB, { force: true });
  const out = new DatabaseSync(OUT_DB);
  out.exec(`
    PRAGMA page_size = 4096;
    PRAGMA journal_mode = DELETE;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL COLLATE NOCASE, display TEXT,
      summary TEXT, html BLOB, cats TEXT, revid INTEGER
    );
    CREATE TABLE redirects (src TEXT PRIMARY KEY COLLATE NOCASE, dst TEXT NOT NULL, frag TEXT) WITHOUT ROWID;
    CREATE TABLE categories (name TEXT NOT NULL COLLATE NOCASE, id INTEGER NOT NULL);
    CREATE VIRTUAL TABLE fts USING fts5(title, body, content='', tokenize='unicode61 remove_diacritics 2');
  `);
  const insA = out.prepare('INSERT INTO articles VALUES (?,?,?,?,?,?,?)');
  const insF = out.prepare('INSERT INTO fts (rowid, title, body) VALUES (?,?,?)');
  const insC = out.prepare('INSERT INTO categories VALUES (?,?)');
  let n = 0;
  out.exec('BEGIN');
  for (const r of cache.prepare('SELECT pageid, title, revid, display, raw, cats FROM pages ORDER BY title').iterate()) {
    const { html, text } = cleanArticleHtml(zlib.inflateRawSync(r.raw).toString('utf8'));
    insA.run(r.pageid, r.title, r.display, summaryFrom(html), zlib.deflateRawSync(html, { level: 9 }), r.cats, r.revid);
    insF.run(r.pageid, r.title, text);
    for (const c of (r.cats || '').split('\n').filter(Boolean)) insC.run(c, r.pageid);
    if (++n % 10000 === 0) log(`  ${n} articles`);
  }
  const insR = out.prepare('INSERT OR IGNORE INTO redirects VALUES (?,?,?)');
  let nr = 0;
  for (const r of cache.prepare('SELECT src, dst, frag FROM redirects').iterate()) nr += insR.run(r.src, r.dst, r.frag).changes;
  out.exec('COMMIT');
  out.exec(`
    CREATE INDEX articles_title ON articles(title);
    CREATE INDEX categories_name ON categories(name);
    INSERT INTO fts(fts) VALUES('optimize');
  `);
  const version = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13); // e.g. 20261126T0410
  const meta = { version, articles: n, redirects: nr, complete: complete ? '1' : '0', source: 'https://forgottenrealms.fandom.com', license: 'CC BY-SA 3.0' };
  const insM = out.prepare('INSERT INTO meta VALUES (?,?)');
  for (const [k, v] of Object.entries(meta)) insM.run(k, String(v));
  out.exec('VACUUM');
  out.close();
  const manifest = packDatabase(OUT_DB, OUT_DIR, { name: 'wiki', version, extra: { articles: n, redirects: nr, complete } });
  log(`  ${n} articles, ${nr} redirects → ${(manifest.dbBytes / 1e6).toFixed(1)} MB database, ${(manifest.downloadBytes / 1e6).toFixed(1)} MB download in ${manifest.parts.length} parts`);
}

// ------------------------------------------------------------------ main

(async () => {
  let complete = getState('complete') === '1';
  if (!EXPORT_ONLY) {
    const listedAgo = Date.now() - Number(getState('listed') || 0);
    if (listedAgo > 6 * 3600_000) await refreshListing();
    complete = await fetchChanged();
    setState('complete', complete ? 1 : 0);
  }
  const have = cache.prepare('SELECT count(*) n FROM pages').get().n;
  if (have === 0) {
    log('Nothing cached yet — skipping export.');
    return;
  }
  exportDb(complete);
  log(`Done in ${Math.round((Date.now() - started) / 60000)} min.${complete ? '' : ' (Partial: run again to continue fetching.)'}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
