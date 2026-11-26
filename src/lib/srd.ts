import MiniSearch from 'minisearch';
import { SEARCH_OPTIONS } from './searchOptions.js';

export type Category = 'spell' | 'power' | 'feat' | 'monster' | 'item' | 'class' | 'prestige' | 'race' | 'skill' | 'condition' | 'deity' | 'rule';

export interface Entry {
  i: string; // id: "<doc>/<anchor>"
  t: string; // title
  c: Category;
  d: string; // chapter id
  a: string; // anchor
  s: number; // first block
  e: number; // end block (exclusive)
  p?: string; // parent heading
  x?: string; // summary
  al?: string[];
  m?: Record<string, any>;
}

export interface Chapter {
  id: string;
  title: string;
  group: string;
}

export interface Doc extends Chapter {
  blocks: string[];
  toc: [number, number, string, string][];
}

export const CATEGORY_LABEL: Record<Category, string> = {
  spell: 'Spell',
  power: 'Psionic power',
  feat: 'Feat',
  monster: 'Monster',
  item: 'Magic item',
  class: 'Class',
  prestige: 'Prestige class',
  race: 'Race',
  skill: 'Skill',
  condition: 'Condition',
  deity: 'Deity',
  rule: 'Rule',
};

const base = import.meta.env.BASE_URL;
const getJSON = async <T>(p: string): Promise<T> => {
  const r = await fetch(`${base}srd/${p}`);
  if (!r.ok) throw new Error(`Failed to load ${p}`);
  return r.json();
};

let entriesP: Promise<Entry[]> | null = null;
let byId: Map<string, Entry> | null = null;
export function loadEntries() {
  entriesP ??= getJSON<Entry[]>('entries.json').then((e) => {
    byId = new Map(e.map((x) => [x.i, x]));
    return e;
  });
  return entriesP;
}
export async function getEntry(id: string) {
  await loadEntries();
  return byId!.get(id);
}

let chaptersP: Promise<Chapter[]> | null = null;
export const loadChapters = () => (chaptersP ??= getJSON<Chapter[]>('chapters.json'));

const docCache = new Map<string, Promise<Doc>>();
export function loadDoc(id: string) {
  if (!docCache.has(id)) {
    const p = getJSON<Doc>(`docs/${id}.json`);
    p.catch(() => docCache.delete(id));
    docCache.set(id, p);
  }
  return docCache.get(id)!;
}

let indexP: Promise<MiniSearch> | null = null;
export function loadIndex() {
  indexP ??= fetch(`${base}srd/search.json`)
    .then((r) => r.text())
    .then((txt) => MiniSearch.loadJSON(txt, SEARCH_OPTIONS as any));
  return indexP;
}

export interface SrdHit {
  entry: Entry;
  score: number;
}

/** Full-text search over the SRD. Exact/prefix title matches are boosted to the top. */
export async function searchSrd(q: string, limit = 60): Promise<SrdHit[]> {
  const query = q.trim();
  if (!query) return [];
  const [entries, index] = await Promise.all([loadEntries(), loadIndex()]);
  const lower = query.toLowerCase();
  let results = index.search(query);
  if (!results.length) results = index.search(query, { combineWith: 'OR' });
  const hits = results.slice(0, 400).map((r) => {
    const entry = entries[r.id as number];
    const t = entry.t.toLowerCase();
    let score = r.score;
    if (t === lower || entry.al?.some((a) => a.toLowerCase() === lower)) score *= 6;
    else if (t.startsWith(lower)) score *= 2.5;
    if (entry.c !== 'rule') score *= 1.3;
    return { entry, score };
  });
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Quick title-only matching used while the full index is still loading. */
export async function titleSearch(q: string, limit = 30): Promise<SrdHit[]> {
  const entries = await loadEntries();
  const lower = q.trim().toLowerCase();
  if (!lower) return [];
  return entries
    .filter((e) => e.t.toLowerCase().includes(lower))
    .map((entry) => ({ entry, score: entry.t.toLowerCase().startsWith(lower) ? 2 : 1 }))
    .sort((a, b) => b.score - a.score || a.entry.t.localeCompare(b.entry.t))
    .slice(0, limit);
}

export function entryHref(e: Entry) {
  return `#/srd/e/${e.d}/${e.a}`;
}

// ------------------------------------------------------------------ filters metadata

export const SPELL_CLASSES = ['Brd', 'Clr', 'Drd', 'Pal', 'Rgr', 'Sor/Wiz'];
export const CLASS_NAMES: Record<string, string> = {
  Brd: 'Bard',
  Clr: 'Cleric',
  Drd: 'Druid',
  Pal: 'Paladin',
  Rgr: 'Ranger',
  'Sor/Wiz': 'Sorcerer / Wizard',
};
export const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation', 'Universal'];

export function crValue(cr?: string): number {
  if (!cr) return 99;
  const m = cr.match(/(\d+)\s*\/\s*(\d+)|(\d+)/);
  if (!m) return 99;
  return m[3] ? Number(m[3]) : Number(m[1]) / Number(m[2]);
}

export function priceValue(price?: string): number {
  if (!price) return Number.POSITIVE_INFINITY;
  const m = price.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}
