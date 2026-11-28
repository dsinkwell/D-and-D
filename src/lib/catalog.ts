// One catalog of rules content: the 3.5 SRD and the built-in rulebooks merged, so a spell,
// feat or monster that appears in several places is one row with several sources.
import { BookEntry, BookInfo, BookKind, bookEntryHref, booksReady, entriesOfKind, listBuiltInBooks } from './books';
import { Category, Entry, entryHref, loadEntries } from './srd';
import { allHomebrew, homebrewHref, houseRulesOn, type HomebrewRecord } from './homebrew';
import { onTypeChanged } from './userdata';

export interface Source {
  label: string; // "PHB p. 232" or "SRD"
  short: string; // "PHB" / "SRD"
  href: string;
  book?: string;
  page?: number;
  edition: string; // "3.5" | "3.0"
  srd?: boolean;
  homebrew?: boolean;
  name?: string; // for menus: "Player's Handbook", "Magic of Faerûn (3.0)"
  shelf?: string; // "Core Rules" / "Forgotten Realms" / "Supplements"
  ord?: number;
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
  if (s.homebrew) return -1; // the group's own version first
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

onTypeChanged('homebrew', () => resetCatalog());
if (typeof window !== 'undefined') window.addEventListener('rc-houserules', () => resetCatalog());

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

  // homebrew entries of this kind, and the printed entries they replace (house rules)
  const brew = (await allHomebrew()).filter((r) => r.data.kind === kind);
  for (const r of brew) addHomebrew(get(r.name), r);
  const replaced = new Map<string, string>();
  if (houseRulesOn()) for (const r of await allHomebrew()) for (const x of r.data.replaces || []) replaced.set(nameKey(x), r.name);

  const out = [...items.values()];
  for (const it of out) {
    it.sources.sort((a, b) => sourceRank(a) - sourceRank(b));
    it.extra = metaLine(it);
    const by = replaced.get(it.key);
    if (by && !it.sources.some((s) => s.homebrew)) it.extra = `House rule: replaced by ${by}${it.extra ? ` · ${it.extra}` : ''}`;
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function addSrd(it: CatalogItem, e: Entry) {
  const m = e.m || {};
  it.sources.push({ label: 'SRD', short: 'SRD', name: 'SRD (3.5 reference)', href: entryHref(e), edition: '3.5', srd: true });
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

function addHomebrew(it: CatalogItem, r: HomebrewRecord) {
  const f = Object.fromEntries(r.data.fields.map(([k, v]) => [k.toLowerCase(), v]));
  it.sources.push({ label: 'Homebrew', short: 'Homebrew', name: 'Homebrew', href: homebrewHref(r.id), edition: '3.5', homebrew: true });
  it.summary ??= r.data.text.split(/(?<=[.!?])\s/)[0]?.slice(0, 200);
  // "Sor/Wiz 2, Clr 3" → spell levels (so homebrew spells appear in spellbooks)
  for (const m of (f.level || '').matchAll(/([A-Za-z/ ]+?)\s+(\d)\b/g)) it.lv[spellClass(m[1])] ??= Number(m[2]);
  if (f.school) it.school ??= f.school.replace(/\s*[[(].*$/, '').trim();
  if (f.type && it.kind === 'feat') it.ftype = mergeTypes(it.ftype, f.type);
  if (f['challenge rating'] || f.cr) it.cr ??= f['challenge rating'] || f.cr;
  if (f.price || f['market price']) it.price ??= f.price || f['market price'];
  if (f.portfolio) it.portfolio ??= f.portfolio;
}

function addBook(it: CatalogItem, e: BookEntry, b: BookInfo) {
  const m = e.meta || {};
  it.sources.push({ label: `${b.short} p. ${e.page}`, short: b.short, name: bookMenuName(b), shelf: b.shelf, ord: b.ord, href: bookEntryHref(e), book: b.id, page: e.page, edition: b.edition });
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
// Book names for menus: the title wherever it fits comfortably on a phone (about 30 characters),
// a shortened one otherwise, and the 3.0 books marked as such.
const MENU_NAME: Record<string, string> = { frcs: 'FR Campaign Setting' };
export const bookMenuName = (b: Pick<BookInfo, 'id' | 'title' | 'edition'>) =>
  `${MENU_NAME[b.id] ?? b.title}${b.edition === '3.5' ? '' : ` (${b.edition})`}`;

const SHELF_ORDER = ['Core Rules', 'Forgotten Realms', 'Supplements'];

export interface SourceOption {
  value: string; // the short code the list is filtered by ("PHB")
  label: string; // "Player's Handbook"
  group?: string; // the shelf, for <optgroup>
}

/** The sources in these items, for a book menu: SRD first, then the books by shelf and shelf order, homebrew last. */
export function sourceOptions(items: CatalogItem[]): SourceOption[] {
  const seen = new Map<string, Source>();
  for (const it of items) for (const s of it.sources) if (!seen.has(s.short)) seen.set(s.short, s);
  const rank = (s: Source) => (s.srd ? -1 : s.homebrew ? 99 : SHELF_ORDER.indexOf(s.shelf || '') + 1);
  return [...seen.values()]
    .sort((a, b) => rank(a) - rank(b) || (a.ord ?? 0) - (b.ord ?? 0) || (a.name || a.short).localeCompare(b.name || b.short))
    .map((s) => ({ value: s.short, label: s.name || s.short, group: s.book ? s.shelf : undefined }));
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

  // homebrew: by name, other names and the printed names it replaces ("Hide" finds Stealth)
  const hon = houseRulesOn();
  for (const h of await allHomebrew()) {
    const names = [h.name, ...(h.data.aliases || []), ...(hon ? h.data.replaces || [] : [])].map(nameKey);
    const byName = names.some((n) => n === lower || n.startsWith(lower) || (words.length && words.every((w) => n.split(' ').includes(w))));
    const inText = !byName && words.length > 0 && words.every((w) => nameKey(h.data.text).includes(w));
    if (!byName && !inText) continue;
    const kind = h.data.kind === 'rule' ? 'rule' : h.data.kind;
    const r = rowFor(kind, h.name, `hb:${h.id}`);
    addHomebrew(r, h);
    r.rank = Math.min(r.rank, byName ? -1 : 50);
    if (names.slice(1).some((n) => n === lower)) (r as Row & { alias?: boolean }).alias = true; // found by an alias or replaced name
  }

  for (const r of rows.values()) {
    const t = nameKey(r.title);
    const hb = r.sources.some((x) => x.homebrew) ? 0.5 : 0; // the group's own entries first among equals
    const exact = t === lower || (r as Row & { alias?: boolean }).alias;
    let s = hb + (exact ? 4 : t.startsWith(lower) ? 3 : words.every((w) => t.split(' ').includes(w)) ? 2 : words.some((w) => t.includes(w)) ? 1 : 0);
    if (r.kind !== 'rule') s += 0.6;
    else if (GENERIC.test(r.title)) s -= 1;
    r.score = s;
    r.sources.sort((a, b) => sourceRank(a) - sourceRank(b));
    r.extra = metaLine(r);
  }
  return [...rows.values()].sort((a, b) => b.score - a.score || a.rank - b.rank).slice(0, limit);
}
