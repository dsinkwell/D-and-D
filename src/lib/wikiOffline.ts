// Queries against the offline Forgotten Realms Wiki database (built by scripts/build-wiki.mjs,
// installed on the device by src/lib/db.ts).
import { ftsQuery, inflate, isInstalled, query } from './db';

export interface OfflineArticle {
  id: number;
  title: string;
  display: string | null;
  html: string;
  cats: string[];
  revid: number;
  frag?: string | null;
}

export const offlineWikiReady = () => isInstalled('wiki');

const norm = (t: string) => t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

/** Resolve a title (following redirects) to an article, or null if not in the offline copy. */
export async function offlineArticle(title: string): Promise<OfflineArticle | null> {
  if (!(await offlineWikiReady())) return null;
  let t = norm(title);
  let frag: string | null = null;
  const redir = await query<{ dst: string; frag: string | null }>('wiki', 'SELECT dst, frag FROM redirects WHERE src = ?', [t]);
  if (redir[0]) {
    t = redir[0].dst;
    frag = redir[0].frag;
  }
  const rows = await query<{ id: number; title: string; display: string | null; html: Uint8Array; cats: string; revid: number }>(
    'wiki',
    'SELECT id, title, display, html, cats, revid FROM articles WHERE title = ?',
    [t],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, title: r.title, display: r.display, html: await inflate(r.html), cats: (r.cats || '').split('\n').filter(Boolean), revid: r.revid, frag };
}

/** Does the offline wiki have an article (or redirect) with this exact title? Returns the canonical title. */
export async function offlineTitleExists(titles: string[]): Promise<string | null> {
  if (!(await offlineWikiReady())) return null;
  for (const raw of titles) {
    const t = norm(raw);
    const a = await query<{ title: string }>('wiki', 'SELECT title FROM articles WHERE title = ?', [t]);
    if (a[0]) return a[0].title;
    const r = await query<{ dst: string }>('wiki', 'SELECT dst FROM redirects WHERE src = ?', [t]);
    if (r[0]) return r[0].dst;
  }
  return null;
}

export interface OfflineHit {
  title: string;
  snippet: string;
}

/** Full-text search: exact title/redirect first, then title matches, then body matches. */
export async function offlineSearch(q: string, limit = 40): Promise<OfflineHit[]> {
  const text = q.trim();
  if (!text || !(await offlineWikiReady())) return [];
  const fts = ftsQuery(text);
  if (!fts) return [];
  const seen = new Set<string>();
  const out: OfflineHit[] = [];
  const push = (rows: { title: string; summary: string | null }[]) => {
    for (const r of rows) {
      if (seen.has(r.title)) continue;
      seen.add(r.title);
      out.push({ title: r.title, snippet: r.summary || '' });
    }
  };

  const exact = await offlineArticle(text).catch(() => null);
  if (exact) push([{ title: exact.title, summary: (await query<{ summary: string }>('wiki', 'SELECT summary FROM articles WHERE id = ?', [exact.id]))[0]?.summary }]);

  push(
    await query<{ title: string; summary: string }>(
      'wiki',
      `SELECT a.title, a.summary FROM fts JOIN articles a ON a.id = fts.rowid
       WHERE fts MATCH ? ORDER BY length(a.title), bm25(fts, 10.0, 1.0) LIMIT 15`,
      [`title: (${fts})`],
    ),
  );
  push(
    await query<{ title: string; summary: string }>(
      'wiki',
      `SELECT a.title, a.summary FROM fts JOIN articles a ON a.id = fts.rowid
       WHERE fts MATCH ? ORDER BY bm25(fts, 10.0, 1.0) LIMIT ?`,
      [fts, limit],
    ),
  );
  return out.slice(0, limit);
}

export async function offlineCategory(name: string): Promise<string[] | null> {
  if (!(await offlineWikiReady())) return null;
  const cat = norm(name.replace(/^Category:/i, ''));
  const rows = await query<{ title: string }>(
    'wiki',
    'SELECT a.title FROM categories c JOIN articles a ON a.id = c.id WHERE c.name = ? ORDER BY a.title',
    [cat],
  );
  return rows.map((r) => r.title);
}

export async function offlineMeta(): Promise<Record<string, string> | null> {
  if (!(await offlineWikiReady())) return null;
  const rows = await query<{ key: string; value: string }>('wiki', 'SELECT key, value FROM meta');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
