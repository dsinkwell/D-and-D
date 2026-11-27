// One catalog of rules content: the 3.5 SRD and the built-in rulebooks merged, so a spell,
// feat or monster that appears in several places is one row with several sources.
import { BookEntry, BookInfo, BookKind, bookEntryHref, booksReady, entriesOfKind, listBuiltInBooks } from './books';
import { Category, Entry, entryHref, loadEntries } from './srd';

export interface Source {
  label: string; // "PHB p. 232" or "SRD"
  short: string; // "PHB" / "SRD"
  href: string;
  book?: string;
  page?: number;
  edition: string; // "3.5" | "3.0"
  srd?: boolean;
}

export interface CatalogItem {
  key: string;
  title: string;
  kind: Category;
  summary?: string;
  sources: Source[]; // best first: 3.5 books, then the SRD, then 3.0 books
  // Normalised filter fields, merged from every source.
  lv: Record<string, number>; // spell levels by class/domain
  school?: string;
  ftype?: string[];
  ctype?: string;
  cr?: string;
  price?: string;
  itemKind?: string;
  discipline?: string;
  portfolio?: string;
  extra?: string; // short meta line
}

/** Comparison key for a title: case, punctuation, "[General]" tags and “, Mass” order ignored. */
export function nameKey(t: string): string {
  let s = t.toLowerCase().replace(/\s*\[[^\]]*\]\s*$/, '').replace(/[’']/g, '');
  const m = s.match(/^(.+?),\s*(greater|lesser|mass|improved|superior|swift|quickened)$/);
  if (m) s = `${m[2]} ${m[1]}`;
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

// Books write spell levels as "Sor/Wiz 3", "Sorcerer/wizard 3", "sorcerer/ wizard 3"…
const SPELL_CLASS_ALIASES: Record<string, string> = {
  wiz: 'Sor/Wiz', sor: 'Sor/Wiz', 'sor/wiz': 'Sor/Wiz', 'sorcerer/wizard': 'Sor/Wiz', sorcerer: 'Sor/Wiz', wizard: 'Sor/Wiz',
  brd: 'Brd', bard: 'Brd', clr: 'Clr', cleric: 'Clr', drd: 'Drd', druid: 'Drd', pal: 'Pal', paladin: 'Pal', rgr: 'Rgr', ranger: 'Rgr',
  'wu jen': 'Wu Jen', warmage: 'Warmage', assassin: 'Assassin', asn: 'Assassin', blackguard: 'Blackguard', blk: 'Blackguard',
  hth: 'Hathran', hrp: 'Harper', adept: 'Adept', shugenja: 'Shugenja', 'duskblade': 'Duskblade', healer: 'Healer', hlr: 'Healer',
};
const spellClass = (k: string) => {
  const key = k.toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
  return SPELL_CLASS_ALIASES[key] || key.replace(/\b\w/g, (c) => c.toUpperCase());
};

function sourceRank(s: Source) {
  return s.edition === '3.5' && !s.srd ? 0 : s.srd ? 1 : 2;
}

const BOOK_KIND: Partial<Record<Category, BookKind>> = { spell: 'spell', feat: 'feat', monster: 'monster', item: 'item', trap: 'trap', prestige: 'prestige', class: 'class', deity: 'deity', power: 'power' };

const cache = new Map<string, Promise<CatalogItem[]>>();
let generation = 0;
/** Bumped whenever the catalog is reset (books installed or updated). */
export const catalogGeneration = () => generation;
export function resetCatalog() {
  cache.clear();
  generation++;
}

export function catalog(kind: Category): Promise<CatalogItem[]> {
  if (!cache.has(kind)) {
    cache.set(
      kind,
      build(kind).catch((e) => {
        cache.delete(kind);
        throw e;
      }),
    );
  }
  return cache.get(kind)!;
}

async function build(kind: Category): Promise<CatalogItem[]> {
  const items = new Map<string, CatalogItem>();
  const get = (title: string, extra = '') => {
    const key = nameKey(title) + extra;
    let it = items.get(key);
    if (!it) {
      it = { key, title, kind, sources: [], lv: {} };
      items.set(key, it);
    }
    return it;
  };

  for (const e of (await loadEntries()).filter((x) => x.c === kind && nameKey(x.t))) addSrd(get(e.t), e);

  const bk = BOOK_KIND[kind];
  if (bk && (await booksReady().catch(() => false))) {
    const books = new Map((await listBuiltInBooks()).map((b) => [b.id, b]));
    for (const { entry } of await entriesOfKind(bk)) {
      const b = books.get(entry.book);
      // adventure-site areas ("10. Chamber of the Thief-King (EL 12)") and table captions
      // ("2–30: The Reaping Mauler") carry stat blocks but aren't entries of their own
      if (/^\d+[.)]\s|^\d+[–-]\d+:|\(EL \d/.test(entry.title)) continue;
      if (b && nameKey(entry.title)) addBook(get(entry.title, kind === 'trap' && entry.meta?.cr ? ` cr${entry.meta.cr}` : ''), entry, b);
    }
  }

  const out = [...items.values()];
  for (const it of out) {
    it.sources.sort((a, b) => sourceRank(a) - sourceRank(b));
    it.extra = metaLine(it);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function addSrd(it: CatalogItem, e: Entry) {
  const m = e.m || {};
  it.sources.push({ label: 'SRD', short: 'SRD', href: entryHref(e), edition: '3.5', srd: true });
  it.summary ??= e.x;
  for (const [k, v] of Object.entries(m.lv || {})) it.lv[k] ??= v as number;
  it.school ??= m.school?.replace(/\s*\[.*\]/, '');
  if (m.ftype) it.ftype = mergeTypes(it.ftype, m.ftype);
  it.ctype ??= m.ctype?.replace(/\s*\(.*$/, '') || m.type;
  it.cr ??= m.cr;
  it.price ??= m.price;
  it.itemKind ??= m.kind ? itemKindName(m.kind) : undefined;
  it.discipline ??= m.Discipline?.replace(/\s*\(.*$/, '').trim();
}

function addBook(it: CatalogItem, e: BookEntry, b: BookInfo) {
  const m = e.meta || {};
  it.sources.push({ label: `${b.short} p. ${e.page}`, short: b.short, href: bookEntryHref(e), book: b.id, page: e.page, edition: b.edition });
  it.summary ??= e.summary || undefined;
  for (const [k, v] of Object.entries(m.lv || {})) it.lv[spellClass(k)] ??= v as number;
  if (m.school) it.school ??= String(m.school).replace(/\s*[[(].*$/, '').trim();
  if (m.ftype) it.ftype = mergeTypes(it.ftype, m.ftype);
  it.ctype ??= m.ctype;
  it.cr ??= m.cr;
  it.price ??= m.price;
  it.portfolio ??= m.portfolio;
  if (it.kind === 'item' && !it.itemKind) it.itemKind = itemKindName(`${e.path || ''} › ${e.parent || ''}`);
}

/** Short item type for list prefixes: "Wondrous Item", "Ring", "Armor property"… from an SRD
 * kind ("Magic Armor and Shield Special Ability") or a book section path ("… › Rings"). */
export function itemKindName(src: string): string | undefined {
  const s = src.toLowerCase();
  const rules: [RegExp, string][] = [
    [/armor and shield special abilit|armor special abilit|armor propert/, 'Armor property'],
    [/weapon special abilit|weapon propert/, 'Weapon property'],
    [/wondrous/, 'Wondrous Item'],
    [/\bcursed/, 'Cursed Item'],
    [/\bartifact/, 'Artifact'],
    [/\brings?\b/, 'Ring'],
    [/\brods?\b/, 'Rod'],
    [/\bstaffs?\b|\bstaves\b/, 'Staff'],
    [/\bwands?\b/, 'Wand'],
    [/\bpotions?\b|\boils?\b/, 'Potion'],
    [/\bscrolls?\b/, 'Scroll'],
    [/\bshields?\b/, 'Shield'],
    [/\barmors?\b/, 'Armor'],
    [/\bweapons?\b|\bammunition\b/, 'Weapon'],
    [/\bclothing\b/, 'Wondrous Item'],
    [/\btools?\b/, 'Wondrous Item'],
    [/\bintelligent/, 'Intelligent Item'],
  ];
  for (const [rx, name] of rules) if (rx.test(s)) return name;
  return undefined;
}

function mergeTypes(cur: string[] | undefined, add: string): string[] {
  const s = new Set(cur || []);
  for (const raw of add.split(/,\s*/)) {
    const t = raw.replace(/[^\p{L}\p{N} '\-]/gu, '').trim(); // drop placeholder glyphs (U+FFFC) from some PDFs
    if (/^[A-Za-z][A-Za-z '\-]{1,28}$/.test(t)) s.add(t.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  return [...s];
}

function metaLine(it: CatalogItem): string {
  switch (it.kind) {
    case 'spell': {
      const lv = Object.entries(it.lv).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ');
      return [it.school, lv].filter(Boolean).join(' · ');
    }
    case 'power':
      return [it.discipline, Object.entries(it.lv).map(([k, v]) => `${k} ${v}`).join(', ')].filter(Boolean).join(' · ');
    case 'feat':
      return (it.ftype || []).join(', ');
    case 'monster':
      return [it.ctype, it.cr && `CR ${it.cr}`].filter(Boolean).join(' · ');
    case 'item':
      return [it.price, it.itemKind].filter(Boolean).join(' · ');
    case 'deity':
      return it.portfolio || '';
    case 'trap':
      return [it.cr && `CR ${it.cr}`, it.price].filter(Boolean).join(' · ');
    default:
      return '';
  }
}

/** Short names of the sources of a list, for the Source filter (books in shelf order, SRD first). */
export function sourceOptions(items: CatalogItem[]): string[] {
  const seen = new Set<string>();
  for (const it of items) for (const s of it.sources) seen.add(s.short);
  const all = [...seen];
  return ['SRD', ...all.filter((s) => s !== 'SRD')].filter((s) => seen.has(s));
}

// ------------------------------------------------------------------ unified search

const GENERIC = /^(combat|ecology|habitat\/society|society|tactics|description|introduction|overview|history|treasure|strategies and tactics|sample .*|typical treasure|advancement|level adjustment|special|notes?|variant.*|lore|.* lore|.* characters|.* in faerûn|creating .*|appendix.*)$/i;

/**
 * Search the SRD and the rulebooks together. One row per name (a spell in the PHB and the SRD
 * is one result with two sources), ranked by how well the name matches, entries before
 * general sections.
 */
export async function searchRules(q: string, limit = 80): Promise<CatalogItem[]> {
  const query = q.trim();
  if (!query) return [];
  const { searchSrd } = await import('./srd');
  const { searchBuiltIn } = await import('./books');
  const haveBooks = await booksReady().catch(() => false);
  const [srd, bk, books] = await Promise.all([
    searchSrd(query, 80),
    haveBooks ? searchBuiltIn(query, 150).catch(() => []) : Promise.resolve([]),
    haveBooks ? listBuiltInBooks().catch(() => [] as BookInfo[]) : Promise.resolve([] as BookInfo[]),
  ]);
  const bookById = new Map(books.map((b) => [b.id, b]));
  const lower = nameKey(query);
  const words = lower.split(' ').filter(Boolean);

  type Row = CatalogItem & { rank: number; score: number };
  const rows = new Map<string, Row>();
  const rowFor = (kind: Category, title: string, sectionKey?: string): Row => {
    const key = kind === 'rule' ? `rule:${sectionKey}` : `${kind}:${nameKey(title)}`;
    let r = rows.get(key);
    if (!r) {
      r = { key, title, kind, sources: [], lv: {}, rank: 1e9, score: 0 };
      rows.set(key, r);
    }
    return r;
  };

  srd.forEach(({ entry: e }, i) => {
    const r = rowFor(e.c, e.t, `srd:${e.i}`);
    addSrd(r, e);
    r.rank = Math.min(r.rank, i);
  });
  bk.forEach(({ entry: e }, i) => {
    const b = bookById.get(e.book);
    if (!b) return;
    const kind: Category = e.kind === 'rule' ? 'rule' : (e.kind as Category);
    const r = rowFor(kind, e.title, `${e.book}:${e.id}`);
    addBook(r, e, b);
    r.rank = Math.min(r.rank, i);
  });

  for (const r of rows.values()) {
    const t = nameKey(r.title);
    let s = t === lower ? 4 : t.startsWith(lower) ? 3 : words.every((w) => t.split(' ').includes(w)) ? 2 : words.some((w) => t.includes(w)) ? 1 : 0;
    if (r.kind !== 'rule') s += 0.6;
    else if (GENERIC.test(r.title)) s -= 1;
    r.score = s;
    r.sources.sort((a, b) => sourceRank(a) - sourceRank(b));
    r.extra = metaLine(r);
  }
  return [...rows.values()].sort((a, b) => b.score - a.score || a.rank - b.rank).slice(0, limit);
}
