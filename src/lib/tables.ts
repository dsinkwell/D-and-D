// Every table in the SRD and the rulebooks, read cell by cell, so Ask can answer questions such
// as "How much does full plate cost?" or "range increment of a longbow" straight from the table
// ("Table 7–5: Weapons, PHB p. 116"), instead of hoping a passage excerpt contains the right row.
//
// The index is built once per device (books: one pass over every stored chunk) and kept in
// IndexedDB, keyed by the books' and SRD's versions, so it is rebuilt only when they change.
import { get, set } from 'idb-keyval';
import { bookToc, booksReady, bookEntryHref, listBuiltInBooks, scanBlocks, type BookEntry } from './books';
import { dbStatus } from './db';
import { loadChapters, loadDoc } from './srd';

export interface Table {
  caption: string; // "Table 7–5: Weapons"
  source: string; // "PHB p. 116" / "SRD"
  href: string;
  rank: number; // 0 = core 3.5 book, 1 = SRD, 2 = other 3.5 book, 3 = 3.0 book
  headers: string[];
  rows: string[][];
  nameCol: number; // the column that names each row (not always the first: "01–05 | Cure light wounds | 50 gp")
}

interface Index {
  tables: Table[];
  rows: Map<string, [number, number, boolean][]>; // row name → [table, row, exact name (not just the part before a comma)]
}

const VERSION = 6; // (index format; answering changes need no bump) // bump when the parsing below changes
const CORE = new Set(['phb', 'dmg', 'mm']);

export const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** Row names without footnote marks: "Longsword1" / "Full plate*" → "longsword" / "full plate". */
const rowKey = (label: string) => norm(label.replace(/[*†‡§]+|(?<=[a-z])\d+$/gi, ''));

let indexP: Promise<Index | null> | null = null;
let indexKey = '';

/** The table index (null when there is nothing to index yet). */
export async function tableIndex(): Promise<Index | null> {
  const st = await dbStatus();
  const key = `tables:v${VERSION}:${st.installed.books || 'none'}`;
  if (indexP && key === indexKey) return indexP;
  indexKey = key;
  indexP = (async () => {
    let tables = (await get<Table[]>(key).catch(() => undefined)) || null;
    if (!tables) {
      tables = await buildTables();
      await set(key, tables).catch(() => {}); // private mode: rebuilt next time
    }
    const rows = new Map<string, [number, number, boolean][]>();
    tables.forEach((t, ti) =>
      t.rows.forEach((r, ri) => {
        const label = r[t.nameCol] || '';
        const k = rowKey(label);
        if (k.length < 3) return;
        // "Horse, heavy" is also found as "horse"
        const head = label.includes(',') ? rowKey(label.split(',')[0]) : '';
        // "Endure elements (potion)", "Magic missile (1st)" are asked about without the bracket
        const bare = rowKey(label.replace(/\s*\([^)]*\)/g, ''));
        const keys: [string, boolean][] = [[k, true], [k.replace(/ /g, ''), true], [bare, true]];
        if (head.length >= 4 && head !== k) keys.push([head, false]);
        for (const [kk, exact] of keys) {
          const list = rows.get(kk) || [];
          if (!list.some(([a, b]) => a === ti && b === ri)) list.push([ti, ri, exact]);
          rows.set(kk, list);
        }
      }),
    );
    return { tables, rows };
  })().catch((e) => {
    indexP = null;
    throw e;
  });
  return indexP;
}

// ------------------------------------------------------------------ building

const TABLE_CAPTION = /^\s*(?:Table|T)\s*[\d–-]/i;

async function buildTables(): Promise<Table[]> {
  const out: Table[] = [];
  const dom = new DOMParser();
  const parse = (html: string) => dom.parseFromString(html, 'text/html').querySelector('table');

  // SRD
  for (const ch of await loadChapters()) {
    const doc = await loadDoc(ch.id).catch(() => null);
    if (!doc) continue;
    let heading = '';
    let anchor = '';
    doc.blocks.forEach((b, i) => {
      const h = b.match(/^<h\d[^>]*id="([^"]+)"[^>]*>(.*?)<\/h\d>/);
      if (h) {
        anchor = h[1];
        heading = textOf(h[2]);
      }
      if (!b.startsWith('<table')) return;
      const el = parse(b);
      if (!el) return;
      const prev = doc.blocks.slice(Math.max(0, i - 2), i).map(textOf).reverse().find((t) => TABLE_CAPTION.test(t) || /^Table:/.test(t));
      const caption = textOf(el.querySelector('caption')?.innerHTML || '') || prev || heading || ch.title;
      const t = tableFrom(el, caption, 'SRD', `#/srd/d/${ch.id}${anchor ? `?at=${anchor}` : ''}`, 1);
      if (t) out.push(t);
    });
  }

  // the rulebooks
  if (await booksReady().catch(() => false)) {
    const books = new Map((await listBuiltInBooks()).map((b) => [b.id, b]));
    const tocs = new Map<string, BookEntry[]>();
    for (const id of books.keys()) tocs.set(id, await bookToc(id));
    const found: { book: string; idx: number; html: string; prev: string[] }[] = [];
    await scanBlocks((book, idx, block, blocks, i) => {
      if (block.startsWith('<table')) found.push({ book, idx, html: block, prev: blocks.slice(Math.max(0, i - 3), i) });
    });
    for (const f of found) {
      const el = parse(f.html);
      const b = books.get(f.book);
      if (!el || !b) continue;
      // the deepest section the table sits in (for its page and a link)
      const toc = tocs.get(f.book) || [];
      let at: BookEntry | undefined;
      for (const e of toc) if (e.start <= f.idx && f.idx < e.end && (!at || e.level >= at.level)) at = e;
      const prev = f.prev.map(textOf).reverse().find((t) => TABLE_CAPTION.test(t));
      const caption = textOf(el.querySelector('caption')?.innerHTML || '') || prev || (at && TABLE_CAPTION.test(at.title) ? at.title : at?.title) || b.title;
      const rank = b.edition !== '3.5' ? 3 : CORE.has(b.id) ? 0 : 2;
      const t = tableFrom(el, caption, `${b.short}${at ? ` p. ${at.page}` : ''}`, at ? bookEntryHref(at) : `#/book/${b.id}`, rank);
      if (t) out.push(t);
    }
  }
  return out;
}

const textOf = (html: string): string =>
  html
    .replace(/&amp;(?=[a-z#]+;)/g, '&') // some titles are escaped twice ("&amp;amp;")
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** Cells of a row with colspans expanded, so every row lines up with the headers. */
function cellsOf(tr: Element): { text: string; th: boolean }[] {
  const out: { text: string; th: boolean }[] = [];
  for (const c of Array.from(tr.children)) {
    const span = Math.min(12, Number(c.getAttribute('colspan')) || 1);
    const text = textOf(c.innerHTML);
    for (let k = 0; k < span; k++) out.push({ text, th: c.tagName === 'TH' });
  }
  return out;
}

function tableFrom(el: Element, rawCaption: string, source: string, href: string, rank: number): Table | null {
  const caption = textOf(rawCaption);
  const trs = Array.from(el.querySelectorAll('tr'));
  if (trs.length < 2) return null;
  const rows = trs.map(cellsOf).filter((r) => r.some((c) => c.text));
  if (rows.length < 2) return null;
  // header rows: the leading rows made of <th> cells (or the first row), joined column by column
  // ("Speed" over "(30 ft.)" → "Speed (30 ft.)")
  let h = 0;
  while (h < rows.length - 1 && h < 3 && rows[h].every((c) => c.th || !c.text)) h++;
  if (h === 0) h = 1;
  const width = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => {
    const parts: string[] = [];
    for (let r = 0; r < h; r++) {
      const t = rows[r][i]?.text || '';
      if (t && parts[parts.length - 1] !== t) parts.push(t);
    }
    return parts.join(' ');
  });
  if (headers.filter(Boolean).length < 2) return null;
  const body = rows.slice(h).map((r) => r.map((c) => c.text));
  // rows that are only a group label ("Light armor", "Simple Weapons") carry no values
  const data = body.filter((r) => r[0] && r.slice(1).some(Boolean));
  if (!data.length) return null;
  // the name column: the first one whose cells are mostly words, not rolls or numbers
  const wordy = (c?: string) => !!c && /[a-z]{3}/i.test(c) && !/^[\d–—\-+% ]+$/.test(c);
  let nameCol = 0;
  for (let i = 0; i < Math.min(6, width); i++) {
    if (data.filter((r) => wordy(r[i])).length >= data.length * 0.6) {
      nameCol = i;
      break;
    }
  }
  return { caption, source, href, rank, headers, rows: data, nameCol };
}

// ------------------------------------------------------------------ answering

// What a question asks for → words that appear in the column heading
const ASKS: [RegExp, RegExp][] = [
  [/\b(cost|costs|price|prices|priced|worth|how much (?:does|is|do|are)|buy)\b/, /\b(cost|price|market price)\b/],
  [/\b(weigh|weighs|weight|heavy)\b/, /\bweight\b/],
  [/\b(range increment|range|how far)\b/, /\brange\b/],
  [/\b(damage|dmg)\b/, /\b(dmg|damage)\b/],
  [/\b(crit|critical|threat range)\b/, /\bcritical\b/],
  [/\b(spell failure|asf)\b/, /\bspell failure\b/],
  [/\b(max(?:imum)? dex|dex(?:terity)? bonus)\b/, /\bmax(?:imum)? dex/],
  [/\b(armor check|check penalty|acp)\b/, /\bcheck penalty\b/],
  [/\b(armor bonus|ac bonus|shield bonus|bonus to ac|how much ac|ac)\b/, /\b(armor|shield|armor ?\/ ?shield) bonus\b|^ac$/],
  [/\b(speed|move|movement)\b/, /\bspeed\b/],
  [/\b(hardness)\b/, /\bhardness\b/],
  [/\b(hit points|hp)\b/, /\b(hit points|hp)\b/],
  [/\b(type|damage type|piercing|slashing|bludgeoning)\b/, /^type$/],
  [/\b(size)\b/, /\bsize\b/],
  [/\b(dc|difficulty)\b/, /\bdc\b/],
  [/\b(caster level|cl)\b/, /\bcaster level\b/],
];

// Words that name a column, not a row ("cost", "armor" in "full plate armor")
const STOP_Q = new Set(['masterwork', 'mighty', 'composite', 'small', 'medium', 'large', 'a', 'an', 'the', 'of', 'for', 'in', 'on', 'is', 'does', 'do', 'what', 'whats', 'how', 'much', 'many', 'cost', 'costs', 'and', 'or', 'with', 'my', 'your', 'its']);
// nouns that may follow a material or kind ("iron door", "stone wall")
const PLACE_NOUN = new Set(['door', 'doors', 'wall', 'walls', 'chest', 'gate', 'floor', 'lock', 'portcullis', 'rope', 'chain']);
const NOT_ROW = new Set(['weigh', 'weighs', 'increment', 'critical', 'crit', 'hardness', 'penalty', 'failure', 'bonus', 'chance', 'cost', 'price', 'weight', 'range', 'damage', 'type', 'size', 'speed', 'armor', 'weapon', 'weapons', 'shield', 'table', 'level', 'class', 'item', 'items', 'the', 'what', 'how', 'much', 'does']);

export interface TableHit {
  row: string; // "Full plate"
  header: string; // "Cost"
  value: string; // "1,500 gp"
  table: Table;
  others: { value: string; table: Table }[]; // the same cell in other tables, when it differs
}

/** The table cell a question asks for, or null. */
export async function tableLookup(q: string): Promise<TableHit | null> {
  const s = q.toLowerCase().replace(/[’']/g, '');
  let found = ASKS.filter(([qrx]) => qrx.test(s));
  // "how much does chainmail weigh" asks for the weight, not the price
  if (found.length > 1 && !/\b(cost|costs|price|prices|priced|worth|buy)\b/.test(s)) found = found.filter((a) => a !== ASKS[0]);
  const asks = found.map(([, hrx]) => hrx);
  if (!asks.length) return null; // "What is a longsword?" is not a table question
  const idx = await tableIndex().catch(() => null);
  if (!idx) return null;

  // the row: the longest run of question words that names a table row which has the column
  // asked for ("arcane spell failure of chain mail": "spell failure" is a row somewhere too)
  const words = norm(q).split(' ');
  let hits: { table: Table; row: string[]; col: number; exact: boolean }[] = [];
  // "potion of …", "scroll of …": only tables about potions / scrolls
  const form = s.match(/\b(potion|oil|scroll|wand|ring|rod|staff|staves)s?\b/)?.[1];
  for (let n = Math.min(5, words.length); n >= 1 && !hits.length; n--) {
    for (let i = 0; i + n <= words.length && !hits.length; i++) {
      const w = words.slice(i, i + n);
      if (n === 1 && (w[0].length < 4 || NOT_ROW.has(w[0]))) continue;
      // one word inside a longer name ("cure light wounds") is not that name
      if (n === 1 && [words[i - 1], words[i + 1]].some((x) => x && !STOP_Q.has(x) && !NOT_ROW.has(x) && !PLACE_NOUN.has(x))) continue;
      const phrase = w.join(' ');
      // "full plate armor" → "full plate"; "longbows" → "longbow"; "chain mail" → "chainmail"
      // "composite longbow" → "longbow composite" (tables write "Longbow, composite")
      const rotated = n > 1 ? `${w.slice(1).join(' ')} ${w[0]}` : phrase;
      const tries = new Set([phrase, phrase.replace(/s$/, ''), phrase.replace(/ (armor|armour|weapon)$/, ''), phrase.replace(/ /g, ''), rotated]);
      for (const t of tries) {
        for (const [ti, ri, exact] of idx.rows.get(t) || []) {
          const tb = idx.tables[ti];
          if (form && !new RegExp(`\\b${form === 'staves' ? 'staff' : form}`, 'i').test(`${tb.caption} ${tb.headers.join(' ')}`)) continue;
          const col = pickColumn(tb.headers, asks, tb.nameCol);
          const v = col >= 0 && col !== tb.nameCol ? tb.rows[ri][col] : '';
          // a roll range ("01–03") in a price column is a misaligned table, not a value
          if (v && !/^[—–-]?$/.test(v.trim()) && !/^\d+\s*[–-]\s*\d+$/.test(v.trim())) hits.push({ table: tb, row: tb.rows[ri], col, exact });
        }
      }
    }
  }
  if (!hits.length) return null;
  // "Longbow" itself before "Longbow, composite"
  if (hits.some((h) => h.exact)) hits = hits.filter((h) => h.exact);
  // the plain tables first: a random-roll table's "+1,650 gp" (masterwork included) is not the price
  const weight = (h: (typeof hits)[number]) => h.table.rank + (/random|\bd%|roll/i.test(`${h.table.caption} ${h.table.headers[0]}`) ? 5 : 0) + (/^\+/.test(h.row[h.col]) ? 3 : 0);
  hits.sort((a, b) => weight(a) - weight(b));
  const best = hits[0];
  const value = cleanValue(best.row[best.col]);
  // several rows of the same table under one name ("Horse, heavy" / "Horse, light")
  const siblings = hits.filter((h) => h.table === best.table && h.row !== best.row).slice(0, 3);
  if (siblings.length) {
    const list = [best, ...siblings].map((h) => `${h.row[h.table.nameCol]}: ${cleanValue(h.row[h.col])}`).join('; ');
    return { row: best.row[best.table.nameCol].split(',')[0].replace(/\s*\([^)]*\)/g, ''), header: shownHeader(best.table.headers[best.col], asks), value: list, table: best.table, others: [] };
  }
  const others: TableHit['others'] = [];
  for (const h of hits.slice(1)) {
    if (h.table === best.table || weight(h) >= 5) continue; // not random-roll tables or "+…" prices
    const v = cleanValue(h.row[h.col]);
    if (norm(v) !== norm(value) && !others.some((o) => norm(o.value) === norm(v)) && others.length < 2) others.push({ value: v, table: h.table });
  }
  return { row: best.row[best.table.nameCol].replace(/[*†‡§]+$/, ''), header: shownHeader(best.table.headers[best.col], asks), value, table: best.table, others };
}

/** A footnote number after a value: "20 ft. 2" → "20 ft.", "30%1" → "30%". */
const cleanValue = (v: string) => v.replace(/(?<=\.|%|\)|\bgp|\blb|\bft)\s?\d$/, '').trim();

/** A merged heading ("0-Level Arcane Spells Market Price") shown as the part asked about ("Market Price"). */
function shownHeader(h: string, asks: RegExp[]): string {
  const c = cleanHeader(h);
  if (c.split(' ').length <= 4) return c;
  const m = /market price|price|cost|weight|range increment|damage|critical|speed|hardness|hit points/i.exec(c);
  return m ? m[0].replace(/^./, (x) => x.toUpperCase()) : c;
}

/** "Weight1" / "Weight 1" (a footnote number) → "Weight". */
const cleanHeader = (h: string) => h.replace(/(?<=[a-z])\s?\d$/i, '').trim();

/** The column a question asks for; among several (Dmg (S) / Dmg (M)), the one for a Medium creature. */
function pickColumn(headers: string[], asks: RegExp[], nameCol: number): number {
  const cols = headers.map((h, i) => ({ h: cleanHeader(h).toLowerCase(), i })).filter((c) => c.i !== nameCol && asks.some((rx) => rx.test(c.h)));
  if (!cols.length) return -1;
  // a 0 here means "not found", so the name column itself is never answered
  const medium = cols.find((c) => /\(m\)|medium|\(30 ft/.test(c.h));
  return (medium || cols[0]).i;
}
