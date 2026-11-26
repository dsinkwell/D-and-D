// Built-in rulebooks: queries against the encrypted books database (scripts/books/build_books.py),
// once it has been unlocked and installed on this device.
import { ftsQuery, inflate, isInstalled, query } from './db';

export type BookKind = 'spell' | 'feat' | 'monster' | 'prestige' | 'class' | 'deity' | 'item' | 'trap' | 'power' | 'rule';

export const BOOK_KIND_LABEL: Record<BookKind, string> = {
  spell: 'Spell',
  feat: 'Feat',
  monster: 'Monster',
  prestige: 'Prestige class',
  class: 'Class',
  deity: 'Deity',
  item: 'Magic item',
  trap: 'Trap',
  power: 'Psionic power',
  rule: 'Section',
};

export interface BookInfo {
  id: string;
  title: string;
  short: string;
  shelf: string;
  edition: string;
  pages: number;
}

export interface BookEntry {
  id: number;
  book: string;
  anchor: string;
  title: string;
  kind: BookKind;
  level: number;
  parent: string | null;
  path: string | null;
  page: number;
  start: number;
  end: number;
  summary: string | null;
  meta: Record<string, any> | null;
}

export const booksReady = () => isInstalled('books');

let booksP: Promise<BookInfo[]> | null = null;
export function listBuiltInBooks(): Promise<BookInfo[]> {
  booksP ??= query<BookInfo>('books', 'SELECT id, title, short, shelf, edition, pages FROM books ORDER BY ord').catch((e) => {
    booksP = null;
    throw e;
  });
  return booksP;
}
export function resetBooksCache() {
  booksP = null;
  chunkCache.clear();
}

export async function bookInfo(id: string) {
  return (await listBuiltInBooks()).find((b) => b.id === id);
}

const parse = (r: any): BookEntry => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null });
const COLS = 'id, book, anchor, title, kind, level, parent, path, page, start, "end", summary, meta';

export async function bookToc(book: string): Promise<BookEntry[]> {
  return (await query('books', `SELECT ${COLS} FROM entries WHERE book = ? ORDER BY start`, [book])).map(parse);
}

export async function bookEntry(book: string, anchor: string): Promise<BookEntry | null> {
  const r = await query('books', `SELECT ${COLS} FROM entries WHERE book = ? AND anchor = ?`, [book, anchor]);
  return r[0] ? parse(r[0]) : null;
}

export async function neighbours(e: BookEntry): Promise<{ prev: BookEntry | null; next: BookEntry | null }> {
  const prev = await query('books', `SELECT ${COLS} FROM entries WHERE book = ? AND start < ? AND level <= ? ORDER BY start DESC LIMIT 1`, [e.book, e.start, e.level]);
  const next = await query('books', `SELECT ${COLS} FROM entries WHERE book = ? AND start >= ? AND level <= ? ORDER BY start LIMIT 1`, [e.book, e.end, e.level]);
  return { prev: prev[0] ? parse(prev[0]) : null, next: next[0] ? parse(next[0]) : null };
}

// Blocks are stored in chunks of N rendered HTML blocks per book.
const chunkCache = new Map<string, Promise<string[]>>();
let chunkSize = 0;
async function getChunkSize() {
  if (!chunkSize) chunkSize = Number((await query<{ value: string }>('books', "SELECT value FROM meta WHERE key = 'chunk'"))[0]?.value || 200);
  return chunkSize;
}
function chunk(book: string, n: number) {
  const key = `${book}:${n}`;
  if (!chunkCache.has(key)) {
    chunkCache.set(
      key,
      query<{ data: Uint8Array }>('books', 'SELECT data FROM chunks WHERE book = ? AND n = ?', [book, n]).then(async (r) => JSON.parse(await inflate(r[0]?.data))),
    );
  }
  return chunkCache.get(key)!;
}

export async function blocksFor(book: string, start: number, end: number): Promise<string[]> {
  const size = await getChunkSize();
  const out: string[] = [];
  for (let n = Math.floor(start / size); n <= Math.floor((end - 1) / size); n++) {
    const blocks = await chunk(book, n);
    blocks.forEach((b, i) => {
      const idx = n * size + i;
      if (idx >= start && idx < end) out.push(b);
    });
  }
  return out;
}

export interface BookHit {
  entry: BookEntry;
  bookShort: string;
}

/** Full-text search over all built-in books: title matches first, then body text. */
export async function searchBuiltIn(q: string, limit = 60): Promise<BookHit[]> {
  if (!q.trim() || !(await booksReady())) return [];
  const fts = ftsQuery(q);
  if (!fts) return [];
  const books = await listBuiltInBooks();
  const short = new Map(books.map((b) => [b.id, b.short]));
  const seen = new Set<number>();
  const out: BookHit[] = [];
  const add = (rows: any[]) => {
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ entry: parse(r), bookShort: short.get(r.book) || r.book });
    }
  };
  const eCols = COLS.split(', ').map((c) => `e.${c}`).join(', ');
  add(
    await query(
      'books',
      `SELECT ${eCols} FROM fts JOIN entries e ON e.id = fts.rowid WHERE fts MATCH ?
       ORDER BY (e.kind = 'rule'), length(e.title), bm25(fts, 10.0, 1.0) LIMIT 20`,
      [`title: (${fts})`],
    ),
  );
  add(
    await query('books', `SELECT ${eCols} FROM fts JOIN entries e ON e.id = fts.rowid WHERE fts MATCH ? ORDER BY bm25(fts, 10.0, 1.0) LIMIT ?`, [fts, limit]),
  );
  return out.slice(0, limit);
}

/** Entries of one kind across all books (spells, feats, monsters…), for the Rules browser. */
export async function entriesOfKind(kind: BookKind): Promise<BookHit[]> {
  if (!(await booksReady())) return [];
  const books = await listBuiltInBooks();
  const short = new Map(books.map((b) => [b.id, b.short]));
  const rows = await query('books', `SELECT ${COLS} FROM entries WHERE kind = ? ORDER BY title`, [kind]);
  return rows.map((r: any) => ({ entry: parse(r), bookShort: short.get(r.book) || r.book }));
}

/** Same-named entries in the books (e.g. "Fireball" in the PHB) for cross-links from the SRD. */
export async function findInBooks(title: string, kind?: string): Promise<BookHit[]> {
  if (!(await booksReady())) return [];
  const books = await listBuiltInBooks();
  const short = new Map(books.map((b) => [b.id, b.short]));
  const rows = await query(
    'books',
    `SELECT ${COLS} FROM entries WHERE title = ? ${kind ? 'AND kind = ?' : "AND kind != 'rule'"} ORDER BY book LIMIT 8`,
    kind ? [title, kind] : [title],
  );
  return rows.map((r: any) => ({ entry: parse(r), bookShort: short.get(r.book) || r.book }));
}

export const bookEntryHref = (e: { book: string; anchor: string }) => `#/book/${e.book}/${encodeURIComponent(e.anchor)}`;
