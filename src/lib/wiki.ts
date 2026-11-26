import DOMPurify from 'dompurify';
import { clear, del, entries as idbEntries, get, set, keys as idbKeys } from 'idb-keyval';
import { wikiStore, readLocal, writeLocal, normalize } from './storage';
import { wikiHref } from './router';
import { offlineArticle, offlineCategory, offlineSearch, offlineWikiReady } from './wikiOffline';

// Forgotten Realms Wiki (https://forgottenrealms.fandom.com) — text licensed CC BY-SA.
// We read it live through the standard MediaWiki API and keep a private offline copy
// of every article you open (or bulk-save) in IndexedDB.

export interface WikiSettings {
  api: string; // MediaWiki api.php endpoint
  proxy: string; // optional prefix, e.g. "https://my-proxy.example.workers.dev/?url="
}

export const DEFAULT_WIKI: WikiSettings = {
  api: 'https://forgottenrealms.fandom.com/api.php',
  proxy: '',
};

const SETTINGS_KEY = 'rc.wiki';
export const getWikiSettings = (): WikiSettings => ({ ...DEFAULT_WIKI, ...readLocal<Partial<WikiSettings>>(SETTINGS_KEY, {}) });
export const saveWikiSettings = (s: WikiSettings) => writeLocal(SETTINGS_KEY, s);

export const wikiOrigin = () => getWikiSettings().api.replace(/\/api\.php.*$/, '');
export const wikiPageUrl = (title: string) => `${wikiOrigin()}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

export interface Article {
  title: string;
  displayTitle: string;
  html: string;
  text: string; // normalised plain text, for offline search
  categories: string[];
  revid?: number;
  fetched: number;
  source?: 'offline' | 'saved' | 'live';
  frag?: string | null;
}

export interface WikiSearchHit {
  title: string;
  snippet: string;
  offline?: boolean;
}

export class WikiError extends Error {
  constructor(
    message: string,
    public kind: 'offline' | 'missing' | 'network' | 'api',
  ) {
    super(message);
  }
}

export const normTitle = (t: string) => {
  const s = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

async function api(params: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const { api: endpoint, proxy } = getWikiSettings();
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const url = `${endpoint}?${qs}`;
  const target = proxy ? proxy + encodeURIComponent(url) : url;
  if (!navigator.onLine) throw new WikiError('You are offline.', 'offline');
  let res: Response;
  try {
    res = await fetch(target, { signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new WikiError('Could not reach the Forgotten Realms Wiki. Check your connection (or the wiki settings under About).', 'network');
  }
  if (!res.ok) throw new WikiError(`The wiki returned HTTP ${res.status}.`, 'api');
  const data = await res.json();
  if (data.error) {
    throw new WikiError(data.error.info || data.error.code, data.error.code === 'missingtitle' ? 'missing' : 'api');
  }
  return data;
}

// ------------------------------------------------------------------ search

export async function searchWiki(q: string, signal?: AbortSignal): Promise<WikiSearchHit[]> {
  const data = await api({ action: 'query', list: 'search', srsearch: q, srlimit: '25', srprop: 'snippet', srnamespace: '0' }, signal);
  return (data.query?.search ?? []).map((r: any) => ({
    title: r.title,
    snippet: DOMPurify.sanitize(r.snippet || '', { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] }),
  }));
}

/** Search articles saved on this device (used offline, and as a supplement online). */
export async function searchSaved(q: string, limit = 25): Promise<WikiSearchHit[]> {
  const terms = normalize(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const all = (await idbEntries(wikiStore)) as [string, Article][];
  const hits: { a: Article; score: number }[] = [];
  for (const [, a] of all) {
    const t = normalize(a.title);
    if (!terms.every((w) => t.includes(w) || a.text.includes(w))) continue;
    let score = terms.reduce((s, w) => s + (t.includes(w) ? 10 : 0) + Math.min(5, a.text.split(w).length - 1), 0);
    if (t === terms.join(' ')) score += 50;
    hits.push({ a, score });
  }
  hits.sort((x, y) => y.score - x.score);
  return hits.slice(0, limit).map(({ a }) => {
    const idx = a.text.indexOf(terms[0]);
    const snippet = idx >= 0 ? '…' + a.text.slice(Math.max(0, idx - 60), idx + 100) + '…' : '';
    return { title: a.title, snippet, offline: true };
  });
}

// ------------------------------------------------------------------ articles

function processHtml(raw: string): { html: string; text: string } {
  const doc = new DOMParser().parseFromString(`<div id="root">${raw}</div>`, 'text/html');
  const root = doc.getElementById('root')!;
  root
    .querySelectorAll('.mw-editsection, .navbox, #toc, .toc, script, noscript, style, link, .printfooter, .mw-empty-elt, .noprint, .mbox-image, .editsection')
    .forEach((el) => el.remove());

  root.querySelectorAll('img').forEach((img) => {
    const real = img.getAttribute('data-src');
    if (real) img.setAttribute('src', real);
    img.removeAttribute('srcset');
    img.removeAttribute('data-srcset');
    img.setAttribute('loading', 'lazy');
    img.classList.remove('lazyload');
  });

  const origin = wikiOrigin();
  root.querySelectorAll('a[href]').forEach((a) => {
    let h = a.getAttribute('href')!;
    if (h.startsWith(origin)) h = h.slice(origin.length);
    if (h.startsWith('#')) {
      a.setAttribute('data-frag', decodeURIComponent(h.slice(1)));
      a.setAttribute('href', 'javascript:void(0)');
      return;
    }
    if (/redlink=1/.test(h)) {
      const span = doc.createElement('span');
      span.className = 'redlink';
      span.textContent = a.textContent;
      a.replaceWith(span);
      return;
    }
    const m = h.match(/^\/wiki\/([^?#]+)(#.*)?$/);
    if (m) {
      const title = decodeURIComponent(m[1]).replace(/_/g, ' ');
      const ns = title.includes(':') ? title.split(':')[0] : '';
      if (!ns || ns === 'Category') {
        a.setAttribute('href', wikiHref(title));
        a.classList.add('wikilink');
        return;
      }
      h = origin + h; // File:, Template:, etc. — open on the wiki itself
    }
    if (h.startsWith('/')) h = origin + h;
    a.setAttribute('href', h);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  const html = DOMPurify.sanitize(root.innerHTML, {
    ADD_ATTR: ['target', 'loading'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'],
  });
  const text = normalize(root.textContent || '').replace(/\s+/g, ' ');
  return { html, text };
}

export async function getSavedArticle(title: string): Promise<Article | undefined> {
  return get(normTitle(title), wikiStore);
}

/**
 * Returns an article, preferring the network when online (and refreshing the saved copy),
 * falling back to the saved copy when offline or the wiki is unreachable.
 */
export async function getArticle(title: string, opts: { preferCache?: boolean; force?: boolean; signal?: AbortSignal } = {}): Promise<{ article: Article; fromCache: boolean }> {
  const key = normTitle(title);
  if (!opts.force) {
    // 1. The full offline copy, if installed on this device.
    const off = await offlineArticle(key).catch(() => null);
    if (off) {
      const html = DOMPurify.sanitize(off.html.replace(/<a href="https?:\/\//g, (m) => m.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ')), {
        ADD_ATTR: ['target'],
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'],
      });
      return {
        article: { title: off.title, displayTitle: DOMPurify.sanitize(off.display || off.title, { ALLOWED_TAGS: ['i'] }), html, text: '', categories: off.cats, revid: off.revid, fetched: 0, source: 'offline', frag: off.frag },
        fromCache: true,
      };
    }
  }
  const cached = await get<Article>(key, wikiStore);
  const fresh = cached && Date.now() - cached.fetched < 1000 * 60 * 60 * 24 * 14;
  if (cached && !opts.force && (opts.preferCache || fresh || !navigator.onLine)) return { article: { ...cached, source: 'saved' }, fromCache: true };
  try {
    const data = await api(
      { action: 'parse', page: key, prop: 'text|displaytitle|categories|revid', redirects: '1', disableeditsection: '1', disabletoc: '1' },
      opts.signal,
    );
    const p = data.parse;
    const { html, text } = processHtml(p.text);
    const article: Article = {
      title: p.title,
      displayTitle: DOMPurify.sanitize(p.displaytitle || p.title, { ALLOWED_TAGS: ['i', 'b', 'span'] }),
      html,
      text,
      categories: (p.categories || []).filter((c: any) => !c.hidden).map((c: any) => String(c.category).replace(/_/g, ' ')),
      revid: p.revid,
      fetched: Date.now(),
    };
    await set(normTitle(article.title), article, wikiStore);
    if (normTitle(article.title) !== key) await set(key, article, wikiStore); // remember the redirect too
    return { article: { ...article, source: 'live' }, fromCache: false };
  } catch (e) {
    if (cached && (e as any)?.name !== 'AbortError') return { article: { ...cached, source: 'saved' }, fromCache: true };
    throw e;
  }
}

export async function deleteSaved(title: string) {
  await del(normTitle(title), wikiStore);
}

export async function listSaved(): Promise<{ title: string; fetched: number }[]> {
  const all = (await idbEntries(wikiStore)) as [string, Article][];
  const seen = new Set<string>();
  const out: { title: string; fetched: number }[] = [];
  for (const [, a] of all) {
    if (seen.has(a.title)) continue;
    seen.add(a.title);
    out.push({ title: a.title, fetched: a.fetched });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export async function countSaved() {
  return (await idbKeys(wikiStore)).length;
}

export async function clearSaved() {
  await clear(wikiStore);
}

// ------------------------------------------------------------------ categories

export interface CategoryMember {
  title: string;
  isCategory: boolean;
}

export async function getCategoryMembers(category: string, cont?: string, signal?: AbortSignal): Promise<{ members: CategoryMember[]; cont?: string; offline?: boolean }> {
  if (!cont && (!navigator.onLine || (await offlineWikiReady()))) {
    const titles = await offlineCategory(category).catch(() => null);
    if (titles && (titles.length || !navigator.onLine)) return { members: titles.map((title) => ({ title, isCategory: false })), offline: true };
  }
  const params: Record<string, string> = {
    action: 'query',
    list: 'categorymembers',
    cmtitle: category.startsWith('Category:') ? category : `Category:${category}`,
    cmlimit: '200',
    cmtype: 'page|subcat',
    cmprop: 'title|type',
  };
  if (cont) params.cmcontinue = cont;
  const data = await api(params, signal);
  return {
    members: (data.query?.categorymembers ?? []).map((m: any) => ({ title: m.title, isCategory: m.type === 'subcat' || m.ns === 14 })),
    cont: data.continue?.cmcontinue,
  };
}

/** Download every article in a category (not sub-categories) for offline use. */
export async function saveCategoryOffline(
  category: string,
  onProgress: (done: number, total: number, current: string) => void,
  signal: AbortSignal,
): Promise<{ saved: number; failed: string[] }> {
  const pages: string[] = [];
  let cont: string | undefined;
  do {
    const r = await getCategoryMembers(category, cont, signal);
    pages.push(...r.members.filter((m) => !m.isCategory).map((m) => m.title));
    cont = r.cont;
  } while (cont && !signal.aborted);

  let done = 0;
  const failed: string[] = [];
  const queue = [...pages];
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const t = queue.shift()!;
      onProgress(done, pages.length, t);
      try {
        const existing = await getSavedArticle(t);
        if (!existing) {
          await getArticle(t, { signal });
          await new Promise((r) => setTimeout(r, 150)); // be polite to the wiki
        }
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return;
        failed.push(t);
      }
      done++;
      onProgress(done, pages.length, t);
    }
  };
  await Promise.all([worker(), worker()]);
  return { saved: done - failed.length, failed };
}

/**
 * Best available wiki search: the offline database when installed (instant, no network),
 * otherwise the live wiki, with articles saved on this device as a fallback.
 */
export async function searchWikiBest(q: string, signal?: AbortSignal): Promise<{ hits: WikiSearchHit[]; mode: 'offline' | 'live' | 'saved'; error?: string }> {
  if (await offlineWikiReady()) {
    return { hits: (await offlineSearch(q, 40)).map((h) => ({ title: h.title, snippet: escapeHtml(h.snippet) })), mode: 'offline' };
  }
  const saved = await searchSaved(q, 15);
  if (!navigator.onLine) return { hits: saved, mode: 'saved' };
  try {
    const live = await searchWiki(q, signal);
    const seen = new Set(live.map((h) => h.title));
    return { hits: [...live, ...saved.filter((s) => !seen.has(s.title))], mode: 'live' };
  } catch (e) {
    if ((e as any)?.name === 'AbortError') throw e;
    return { hits: saved, mode: 'saved', error: e instanceof WikiError ? e.message : 'Wiki search failed.' };
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Which of these titles exists on the wiki? Offline copy first, then one live API call. */
export async function findWikiTitle(candidates: string[]): Promise<string | null> {
  const { offlineTitleExists } = await import('./wikiOffline');
  if (await offlineWikiReady()) return offlineTitleExists(candidates);
  if (!navigator.onLine) return null;
  try {
    const d = await api({ action: 'query', titles: candidates.slice(0, 20).join('|'), redirects: '1' });
    const pages: any[] = d.query?.pages ?? [];
    for (const c of candidates) {
      const norm = normTitle(c);
      const target = (d.query?.redirects ?? []).find((r: any) => r.from === norm)?.to ?? (d.query?.normalized ?? []).find((n: any) => n.from === c)?.to ?? norm;
      const page = pages.find((p) => p.title === target && !p.missing && !p.invalid);
      if (page) return page.title;
    }
  } catch {
    /* offline or unreachable */
  }
  return null;
}
