import { del, get, set, values } from 'idb-keyval';
import { bookFileStore, bookMetaStore, bookTextStore, requestPersistence } from './storage';

// "Bring your own books": PDFs you own are stored and indexed only on this device.
// Nothing here is uploaded anywhere.

export interface Book {
  id: string;
  title: string;
  shelf: string; // e.g. "Core", "Forgotten Realms", "Other"
  pages: number;
  size: number;
  added: number;
  textChars: number;
}

export const SHELVES = ['Core Rules', 'Forgotten Realms', 'Supplements', 'Adventures', 'Other'];

type PdfJs = typeof import('pdfjs-dist');
let pdfjsP: Promise<PdfJs> | null = null;
export function pdfjs(): Promise<PdfJs> {
  pdfjsP ??= (async () => {
    const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
    const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    lib.GlobalWorkerOptions.workerSrc = worker;
    return lib;
  })();
  return pdfjsP;
}

export async function listBooks(): Promise<Book[]> {
  const all = (await values(bookMetaStore)) as Book[];
  return all.sort((a, b) => a.shelf.localeCompare(b.shelf) || a.title.localeCompare(b.title));
}

export const getBook = (id: string) => get<Book>(id, bookMetaStore);
export const getBookFile = (id: string) => get<Blob>(id, bookFileStore);

export async function updateBook(book: Book) {
  await set(book.id, book, bookMetaStore);
}

export async function deleteBook(id: string) {
  await Promise.all([del(id, bookMetaStore), del(id, bookTextStore), del(id, bookFileStore)]);
  textCache.delete(id);
}

export async function importPdf(file: File, shelf: string, onProgress: (page: number, total: number) => void): Promise<Book> {
  const lib = await pdfjs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  let title = file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  try {
    const meta: any = await doc.getMetadata();
    const t = meta?.info?.Title?.trim();
    if (t && t.length > 3 && !/^untitled|\.(indd|doc|qxd)|^microsoft/i.test(t)) title = t;
  } catch {
    /* no metadata */
  }

  const pages: string[] = [];
  let chars = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let s = '';
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string') continue;
      s += it.str + (it.hasEOL ? '\n' : ' ');
    }
    s = s.replace(/(\w)-\n(\w)/g, '$1$2').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    chars += s.length;
    pages.push(s);
    page.cleanup();
    if (i % 5 === 0 || i === doc.numPages) onProgress(i, doc.numPages);
  }
  await doc.destroy();

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const book: Book = { id, title, shelf, pages: pages.length, size: file.size, added: Date.now(), textChars: chars };
  await requestPersistence();
  await set(id, new Blob([buf], { type: 'application/pdf' }), bookFileStore);
  await set(id, pages, bookTextStore);
  await set(id, book, bookMetaStore);
  return book;
}

// ------------------------------------------------------------------ search

// Length-preserving fold (lowercase + strip accents char-by-char) so match offsets
// in the folded text line up with the original text for snippets.
const foldCache = new Map<string, string>();
function fold(s: string) {
  let out = '';
  for (const ch of s) {
    let f = foldCache.get(ch);
    if (f === undefined) {
      const base = ch.normalize('NFKD')[0] || ch;
      f = base.toLowerCase();
      if (f.length !== ch.length) f = ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
      if (ch === '’' || ch === '‘') f = "'";
      foldCache.set(ch, f);
    }
    out += f;
  }
  return out;
}

const textCache = new Map<string, { raw: string[]; folded: string[] }>();
async function getText(id: string) {
  let t = textCache.get(id);
  if (!t) {
    const raw = ((await get<string[]>(id, bookTextStore)) || []).map((p) => p.replace(/\s+/g, ' '));
    t = { raw, folded: raw.map(fold) };
    textCache.set(id, t);
  }
  return t;
}

export interface BookHit {
  book: Book;
  page: number; // 1-based
  snippet: string; // plain text
  score: number;
}

function parseQuery(q: string) {
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_, p) => {
    phrases.push(fold(p.trim()));
    return ' ';
  });
  return [...phrases, ...fold(rest).split(/\s+/).filter((w) => w.length > 0)];
}

export async function searchBooks(q: string, opts: { bookId?: string; limit?: number } = {}): Promise<BookHit[]> {
  const terms = parseQuery(q);
  if (!terms.length) return [];
  const books = opts.bookId ? [await getBook(opts.bookId)].filter(Boolean) as Book[] : await listBooks();
  const hits: BookHit[] = [];
  for (const book of books) {
    const { raw, folded } = await getText(book.id);
    for (let i = 0; i < folded.length; i++) {
      const page = folded[i];
      let score = 0;
      let first = -1;
      let ok = true;
      for (const t of terms) {
        const at = page.indexOf(t);
        if (at < 0) {
          ok = false;
          break;
        }
        if (first < 0 || at < first) first = at;
        let n = 0;
        for (let k = at; k >= 0 && n < 20; k = page.indexOf(t, k + t.length)) n++;
        score += n;
      }
      if (!ok) continue;
      const start = Math.max(0, first - 70);
      const snippet = (start > 0 ? '…' : '') + raw[i].slice(start, first + 150).trim() + '…';
      hits.push({ book, page: i + 1, snippet, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, opts.limit ?? 60);
}

export function highlight(snippet: string, q: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  let html = esc(snippet);
  const terms = parseQuery(q)
    .filter((t) => t.length > 1)
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return html;
  const re = new RegExp(`(${terms.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return html.replace(re, '<mark>$1</mark>');
}
