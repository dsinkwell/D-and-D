// Direct answers: questions that ask for one field ("range of fireball", "Mystra's portfolio",
// "who rules Cormyr", "what level is fireball for wizards") are answered exactly from the stat
// lines of the books/SRD or the wiki's info boxes — no model involved.
import { catalog, CatalogItem, nameKey } from '../catalog';
import { blocksFor } from '../books';
import { query } from '../db';
import { getEntry, loadDoc, Category, CLASS_NAMES, SCHOOLS, crValue } from '../srd';
import { offlineArticle, offlineTitleExists } from '../wikiOffline';
import { wikiHref } from '../router';
import { textOf } from './highlight';

export interface Direct {
  html: string; // the answer as a sentence, value in <b>
  title: string;
  href: string;
  source: string; // "PHB p. 232", "SRD", "Forgotten Realms Wiki"
}

export interface ListAnswer {
  label: string;
  href: string;
  items: CatalogItem[];
  total: number;
}

// ------------------------------------------------------------------ attributes

interface Attr {
  labels?: string[]; // stat labels in the books/SRD ("Range")
  wiki?: string[]; // info-box labels on the wiki ("Capital")
  phrase: (who: string, v: string) => string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b = (v: string) => `<b>${esc(v.replace(/\.+$/, ''))}</b>`;
const ATTRS: Record<string, Attr> = {
  range: { labels: ['Range'], phrase: (w, v) => `${w} has a range of ${b(v)}.` },
  duration: { labels: ['Duration'], phrase: (w, v) => `${w} lasts ${b(v)}.` },
  components: { labels: ['Components'], phrase: (w, v) => `${w} has the components ${b(v)}.` },
  'casting time': { labels: ['Casting Time'], phrase: (w, v) => `${w} has a casting time of ${b(v)}.` },
  'saving throw': { labels: ['Saving Throw'], phrase: (w, v) => `The saving throw for ${w} is ${b(v)}.` },
  'spell resistance': { labels: ['Spell Resistance'], phrase: (w, v) => `Spell resistance against ${w}: ${b(v)}.` },
  area: { labels: ['Area'], phrase: (w, v) => `${w} has an area of ${b(v)}.` },
  target: { labels: ['Target', 'Targets'], phrase: (w, v) => `${w} targets ${b(v)}.` },
  effect: { labels: ['Effect'], phrase: (w, v) => `${w}: effect ${b(v)}.` },
  school: { labels: ['__school'], phrase: (w, v) => `${w} is ${/^[aeiou]/i.test(v) ? 'an' : 'a'} ${b(v)} spell.` },
  level: { labels: ['Level'], phrase: (w, v) => `${w} is level ${b(v)}.` },
  'challenge rating': { labels: ['Challenge Rating', '__cr'], phrase: (w, v) => `${w} has a Challenge Rating of ${b(v)}.` },
  'hit dice': { labels: ['Hit Dice'], phrase: (w, v) => `${w} has ${b(v.match(/^.*?\(\d+ hp\)/)?.[0] || v)} Hit Dice.` },
  'hit die': { labels: ['Hit Die'], phrase: (w, v) => `${w} uses a ${b(v.replace(/\.$/, ''))} Hit Die.` },
  'armor class': { labels: ['Armor Class', 'AC'], phrase: (w, v) => `${w} has an Armor Class of ${b(v)}.` },
  speed: { labels: ['Speed'], phrase: (w, v) => `${w} has a speed of ${b(v)}.` },
  initiative: { labels: ['Initiative', 'Init'], phrase: (w, v) => `${w} has an initiative of ${b(v)}.` },
  attack: { labels: ['Attack'], phrase: (w, v) => `${w}'s attack: ${b(v)}.` },
  'full attack': { labels: ['Full Attack'], phrase: (w, v) => `${w}'s full attack: ${b(v)}.` },
  'special attacks': { labels: ['Special Attacks'], phrase: (w, v) => `${w}'s special attacks: ${b(v)}.` },
  'special qualities': { labels: ['Special Qualities'], phrase: (w, v) => `${w}'s special qualities: ${b(v)}.` },
  saves: { labels: ['Saves'], phrase: (w, v) => `${w}'s saves: ${b(v)}.` },
  abilities: { labels: ['Abilities'], phrase: (w, v) => `${w}'s ability scores: ${b(v)}.` },
  skills: { labels: ['Skills'], phrase: (w, v) => `${w}'s skills: ${b(v)}.` },
  feats: { labels: ['Feats'], phrase: (w, v) => `${w}'s feats: ${b(v)}.` },
  environment: { labels: ['Environment'], phrase: (w, v) => `${w} is found in ${b(v)}.` },
  organization: { labels: ['Organization'], phrase: (w, v) => `${w} is found ${b(v)}.` },
  treasure: { labels: ['Treasure'], phrase: (w, v) => `${w}'s treasure: ${b(v)}.` },
  advancement: { labels: ['Advancement'], phrase: (w, v) => `${w}'s advancement: ${b(v)}.` },
  'level adjustment': { labels: ['Level Adjustment'], phrase: (w, v) => `${w} has a level adjustment of ${b(v)}.` },
  alignment: { labels: ['Alignment'], wiki: ['Alignment'], phrase: (w, v) => `${w}'s alignment is ${b(v)}.` },
  price: { labels: ['__price', 'Price', 'Market Price', 'Cost'], phrase: (w, v) => `${w} costs ${b(v)}.` },
  'caster level': { labels: ['Caster Level', '__cl'], phrase: (w, v) => `${w} has a caster level of ${b(v)}.` },
  aura: { labels: ['Aura'], phrase: (w, v) => `${w} has ${b(v)} aura.` },
  slot: { labels: ['Body Slot', '__slot'], phrase: (w, v) => `${w} is worn in the ${b(v)} slot.` },
  weight: { labels: ['Weight'], phrase: (w, v) => `${w} weighs ${b(v)}.` },
  activation: { labels: ['Activation'], phrase: (w, v) => `${w} is activated with ${b(v)}.` },
  prerequisites: { labels: ['Prerequisite', 'Prerequisites'], phrase: (w, v) => `${w} requires ${b(v)}.` },
  benefit: { labels: ['Benefit'], phrase: (w, v) => `${w}: ${b(v)}` },
  requirements: { labels: ['Requirements', 'Entry Requirements'], phrase: (w, v) => `To qualify for ${w}: ${b(v)}` },
  'skill points': { labels: ['Skill Points at Each Level', 'Skill Points at 1st Level'], phrase: (w, v) => `${w} gets ${b(v)} skill points.` },
  portfolio: { labels: ['Portfolio'], wiki: ['Portfolio'], phrase: (w, v) => `${w}'s portfolio is ${b(v)}.` },
  domains: { labels: ['Domains'], wiki: ['Domains'], phrase: (w, v) => `${w}'s domains are ${b(v)}.` },
  symbol: { labels: ['Symbol'], wiki: ['Symbol'], phrase: (w, v) => `${w}'s symbol is ${b(v)}.` },
  'favored weapon': { labels: ['Favored Weapon'], wiki: ['Favored weapon'], phrase: (w, v) => `${w}'s favored weapon is ${b(v)}.` },
  worshipers: { labels: ['Worshipers'], wiki: ['Worshipers'], phrase: (w, v) => `${w} is worshiped by ${b(v)}.` },
  'home plane': { labels: ['Home Plane'], wiki: ['Home Plane', 'Home plane'], phrase: (w, v) => `${w}'s home plane is ${b(v)}.` },
  capital: { wiki: ['Capital'], phrase: (w, v) => `The capital of ${w} is ${b(v)}.` },
  ruler: { wiki: ['Ruler', 'Rulers', 'Leader', 'Leaders', 'Head of state', 'Monarch', '__head'], phrase: (w, v) => `${w} is ruled by ${b(v)}.` },
  population: { wiki: ['Population'], phrase: (w, v) => `${w} has a population of ${b(v)}.` },
  home: { wiki: ['Home', 'Residence', 'Base of operations', 'Headquarters'], phrase: (w, v) => `${w} lives in ${b(v)}.` },
  races: { wiki: ['Races'], phrase: (w, v) => `${w}'s peoples: ${b(v)}.` },
  race: { wiki: ['Race'], phrase: (w, v) => `${w} is ${b(v)}.` },
  class: { wiki: ['Class'], phrase: (w, v) => `${w}'s class: ${b(v)}.` },
  title: { wiki: ['Titles', 'Title(s)', 'Title'], phrase: (w, v) => `${w}'s titles: ${b(v)}.` },
  languages: { wiki: ['Languages'], phrase: (w, v) => `${w} speaks ${b(v)}.` },
  religion: { wiki: ['Religion', 'Religions', 'Deities', 'Deity'], phrase: (w, v) => `${w} worships ${b(v)}.` },
  government: { wiki: ['Government', 'Type'], phrase: (w, v) => `${w}'s government: ${b(v)}.` },
  founded: { wiki: ['Founded', 'Established'], phrase: (w, v) => `${w} was founded ${b(v)}.` },
  location: { wiki: ['Location', 'Region'], phrase: (w, v) => `${w} is located in ${b(v)}.` },
  size: { labels: ['__size'], wiki: ['Size'], phrase: (w, v) => `${w} is ${b(v)}.` },
  type: { labels: ['__type'], phrase: (w, v) => `${w} is ${b(v)}.` },
};

const SYNONYMS: Record<string, string> = {
  cr: 'challenge rating', 'challenge rating': 'challenge rating', hd: 'hit dice', 'hit points': 'hit dice', hp: 'hit dice',
  ac: 'armor class', 'armour class': 'armor class', 'armor class': 'armor class', 'casting time': 'casting time', 'cast time': 'casting time',
  save: 'saving throw', saves: 'saves', 'saving throws': 'saves', 'saving throw': 'saving throw', sr: 'spell resistance',
  cost: 'price', price: 'price', value: 'price', 'market price': 'price', worth: 'price', cl: 'caster level', 'caster level': 'caster level',
  'body slot': 'slot', slot: 'slot', prereq: 'prerequisites', prereqs: 'prerequisites', prerequisite: 'prerequisites', prerequisites: 'prerequisites',
  requirement: 'requirements', requirements: 'requirements', 'hit die': 'hit die', 'skill points': 'skill points',
  'ability scores': 'abilities', stats: 'abilities', 'favoured weapon': 'favored weapon', 'favored weapon': 'favored weapon',
  worshippers: 'worshipers', followers: 'worshipers', leader: 'ruler', rulers: 'ruler', king: 'ruler', queen: 'ruler', monarch: 'ruler',
  residence: 'home', titles: 'title', language: 'languages', deity: 'religion', god: 'religion', gods: 'religion', 'home plane': 'home plane', plane: 'home plane',
};
const attrKey = (raw: string) => {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return ATTRS[s] ? s : SYNONYMS[s] || (s.endsWith('s') && ATTRS[s.slice(0, -1)] ? s.slice(0, -1) : null);
};

// ------------------------------------------------------------------ entities

const KINDS: Category[] = ['spell', 'feat', 'monster', 'item', 'prestige', 'class', 'deity', 'trap', 'power', 'race', 'skill', 'condition'];
let names: Promise<Map<string, CatalogItem>> | null = null;
function nameIndex() {
  names ??= Promise.all(KINDS.map((k) => catalog(k).catch(() => []))).then((lists) => {
    const m = new Map<string, CatalogItem>();
    for (const list of lists) for (const it of list) if (!m.has(it.key)) m.set(it.key, it);
    return m;
  });
  return names;
}
export const resetDirect = () => (names = null);
export const warmDirect = () => void nameIndex().catch(() => {});

const clean = (s: string) => s.replace(/^(the|a|an)\s+/i, '').replace(/[?.!]+$/, '').trim();

async function findItem(name: string): Promise<CatalogItem | null> {
  const idx = await nameIndex();
  const n = clean(name);
  for (const cand of [n, n.replace(/s$/, ''), n.replace(/es$/, ''), n.replace(/ies$/, 'y'), `${n}s`]) {
    const it = idx.get(nameKey(cand));
    if (it) return it;
  }
  return null;
}

async function findWiki(name: string): Promise<string | null> {
  const n = clean(name);
  const tc = n.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  const first = n.charAt(0).toUpperCase() + n.slice(1);
  return offlineTitleExists([n, first, tc]).catch(() => null);
}

// ------------------------------------------------------------------ values

async function itemText(it: CatalogItem): Promise<{ text: string; html: string; source: string; href: string }> {
  const s = it.sources[0];
  if (s.srd) {
    const id = s.href.replace(/^#\/srd\/e\//, '');
    const e = await getEntry(id);
    const doc = e ? await loadDoc(e.d) : null;
    const html = doc && e ? doc.blocks.slice(e.s, e.e).join('\n') : '';
    return { text: textOf(html), html, source: 'SRD', href: s.href };
  }
  const m = s.href.match(/^#\/book\/([^/]+)\/(.+)$/)!;
  const rows = await query<any>('books', 'SELECT book, start, "end" FROM entries WHERE book = ? AND anchor = ?', [m[1], decodeURIComponent(m[2])]);
  const e = rows[0];
  const html = e ? (await blocksFor(e.book, e.start, Math.min(e.end, e.start + 60))).join('\n') : '';
  return { text: textOf(html), html, source: s.label, href: s.href };
}

/** A price column in the entry's table ("Type I 2,500 gp, Type II 5,000 gp…"). */
function tablePrice(html: string): string | null {
  for (const t of html.match(/<table[\s\S]*?<\/table>/g) || []) {
    const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => textOf(c[1])));
    const col = rows[0]?.findIndex((h) => /price|cost/i.test(h)) ?? -1;
    if (col < 0) continue;
    const vals = rows.slice(1, 7).filter((r) => r[col]).map((r) => (col > 0 ? `${r[0]} ${r[col]}` : r[col]));
    if (vals.length) return vals.join(', ');
  }
  return null;
}

const ALL_LABELS = Object.values(ATTRS).flatMap((a) => a.labels || []).filter((l) => !l.startsWith('__'));

function statValue(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const rx = new RegExp(`(?:^|\\n|\\s)${label.replace(/[/()]/g, '\\$&')}\\s*:\\s*([^\\n]+)`, 'i');
    const m = text.match(rx);
    if (m) {
      // cut at the next stat label on the same line ("Level: Sor/Wiz 3 Components: V, S")
      let v = m[1];
      const next = new RegExp(`\\s(?:${ALL_LABELS.map((l) => l.replace(/[/()]/g, '\\$&')).join('|')})\\s*:`, 'i');
      const cut = v.search(next);
      if (cut > 0) v = v.slice(0, cut);
      v = v.trim().replace(/[;,]$/, '');
      if (v && v.length < 300) return v;
    }
  }
  return null;
}

function special(it: CatalogItem, text: string, label: string, html = ''): string | null {
  if (label === '__school') return it.school || text.match(/^\s*(Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation|Universal)[^\n]{0,40}/)?.[0]?.trim() || null;
  if (label === '__cr') return it.cr || null;
  if (label === '__price') return it.price || text.match(/\bPrice[^:\n]{0,16}:?\s*([\d,]+\s*gp(?:\s*\([^)]*\))?)/)?.[1] || tablePrice(html);
  if (label === '__cl') return text.match(/\bCL (\d+(?:st|nd|rd|th))/)?.[1] || null;
  if (label === '__slot') return null;
  if (label === '__size' || label === '__type') return it.ctype ? text.match(/^\s*((?:Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)[^\n]{0,60})/i)?.[1]?.trim() || it.ctype : null;
  return null;
}

async function wikiField(title: string, labels: string[]): Promise<string | null> {
  const a = await offlineArticle(title);
  if (!a) return null;
  const pairs = [...a.html.matchAll(/pi-data-label[^>]*>([\s\S]*?)<\/h3>[\s\S]*?pi-data-value[^>]*>([\s\S]*?)<\/div>/g)];
  const clean = (v: string) => textOf(v.replace(/<sup[\s\S]*?<\/sup>/g, '')).replace(/\s*\n\s*/g, ', ').trim();
  for (const label of labels) {
    if (label === '__head') {
      // countries list their head of state under the title itself ("Queen: Raedra Obarskyr")
      const i = pairs.findIndex(([, l]) => textOf(l) === 'Type');
      const head = i >= 0 ? pairs[i + 1] : null;
      if (head && !/^(Legislative|Judicial|Executive|Established|Founded|Preceded|Succeeded|\d)/.test(textOf(head[1]))) return `${textOf(head[1])} ${clean(head[2])}`;
      continue;
    }
    for (const [, l, v] of pairs) {
      if (textOf(l).toLowerCase() === label.toLowerCase()) {
        const val = clean(v);
        if (val) return val;
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ question patterns

interface Parsed {
  attr: string | null;
  entity: string;
  extra?: string;
  what?: boolean; // "what is X" → definition
}

function parse(q: string): Parsed | null {
  const s = q.toLowerCase().replace(/’/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^how long does (.+?) last$/))) return { attr: 'duration', entity: m[1] };
  if ((m = s.match(/^how far (?:does|can) (.+?) (?:reach|go|travel|shoot)$/))) return { attr: 'range', entity: m[1] };
  if ((m = s.match(/^how much (?:does|is|do|are) (.+?)(?: cost| worth)?$/))) return { attr: 'price', entity: m[1] };
  if ((m = s.match(/^(?:who|what) rules (?:over )?(.+)$/))) return { attr: 'ruler', entity: m[1] };
  if ((m = s.match(/^who (?:is|are) the (?:ruler|rulers|leader|leaders|king|queen|monarch) of (.+)$/))) return { attr: 'ruler', entity: m[1] };
  if ((m = s.match(/^where (?:does|did|do) (.+?) (?:live|reside|dwell)$/))) return { attr: 'home', entity: m[1] };
  if ((m = s.match(/^where is (.+)$/))) return { attr: 'location', entity: m[1] };
  if ((m = s.match(/^what (?:spell )?level is (.+?)(?: for (?:an? |the )?(.+?))?$/))) return { attr: 'level', entity: m[1], extra: m[2] };
  if ((m = s.match(/^(?:what|which) school (?:is|of magic is) (.+)$/))) return { attr: 'school', entity: m[1] };
  if ((m = s.match(/^what (?:does|do) (.+?) (?:require|need)$/))) return { attr: 'prerequisites', entity: m[1] };
  if ((m = s.match(/^(?:who|what) (?:does|do) (.+?) worship$/))) return { attr: 'religion', entity: m[1] };
  if ((m = s.match(/^(?:what is |what's |whats |what are |tell me |give me |show me )?(?:the )?(.+?) (?:of|for) (.+)$/))) {
    const a = attrKey(m[1]);
    if (a) return { attr: a, entity: m[2] };
  }
  if ((m = s.match(/^(?:what is |what's |whats |what are )?(?:the |an? )?(.+?)(?:['’]s|['’]|s)? (.+)$/))) {
    const a = attrKey(m[2]);
    if (a) return { attr: a, entity: m[1] };
  }
  if ((m = s.match(/^(.+?) (cr|ac|hp|hit dice|price|cost|range|duration|alignment|portfolio|capital|level)$/))) {
    const a = attrKey(m[2]);
    if (a) return { attr: a, entity: m[1] };
  }
  if ((m = s.match(/^(?:what|who) (?:is|are|was|were) (?:an? |the )?(.+)$/))) return { attr: null, entity: m[1], what: true };
  return null;
}

const titleCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const STATLIKE = /\b(CR \d|HD \d|hp \d|Init [+-]|AC \d)|\b[A-Z][a-z]{2}\d+\//;
const WIKI_SRC = 'Forgotten Realms Wiki';

async function rulesAnswer(p: Parsed, attr: Attr | null): Promise<Direct | null> {
  if (attr && !attr.labels) return null;
  const it = await findItem(p.entity);
  if (!it) return null;
  const { text, html, source, href } = await itemText(it);
  const who = esc(it.title);
  if (!attr) {
    const first = (it.summary || '').split(/(?<=[.!?])\s/)[0];
    if (!first || STATLIKE.test(first)) return null; // a stat block is not a description
    return { html: `<b>${who}</b>: ${esc(first)}`, title: it.title, href, source };
  }
  if (p.attr === 'level') {
    const x = p.extra?.replace(/s$/, '');
    const want = x ? Object.keys(it.lv).find((k) => k.toLowerCase().includes(x.slice(0, 4)) || (CLASS_NAMES[k] || '').toLowerCase().includes(x)) : null;
    if (want) return { html: `${who} is a level ${b(String(it.lv[want]))} ${esc(CLASS_NAMES[want] || want)} spell.`, title: it.title, href, source };
    const lv = Object.entries(it.lv).map(([k, v]) => `${k} ${v}`).join(', ') || statValue(text, ['Level']);
    return lv ? { html: `${who} is level ${b(lv)}.`, title: it.title, href, source } : null;
  }
  for (const l of attr.labels || []) {
    const v = l.startsWith('__') ? special(it, text, l, html) : statValue(text, [l]);
    if (v) return { html: attr.phrase(who, v), title: it.title, href, source };
  }
  return null;
}

async function wikiAnswer(p: Parsed, attr: Attr | null): Promise<Direct | null> {
  if (attr && !attr.wiki) return null;
  const title = await findWiki(p.entity);
  if (!title) return null;
  if (!attr) {
    const rows = await query<any>('wiki', 'SELECT summary, display FROM articles WHERE title = ?', [title]).catch(() => []);
    const first = esc((rows[0]?.summary || '').split(/(?<=[.!?])\s(?=[A-Z])/)[0]);
    if (!first) return null;
    const name = esc(rows[0].display || title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { html: first.replace(new RegExp(`^(${name})`), '<b>$1</b>'), title, href: wikiHref(title), source: WIKI_SRC };
  }
  const v = await wikiField(title, attr.wiki!);
  return v ? { html: attr.phrase(esc(titleCase(title)), v), title, href: wikiHref(title), source: WIKI_SRC } : null;
}

/** "Who is the god of thieves?" → deities whose portfolio mentions it (Realms deities first). */
async function deityOf(q: string): Promise<Direct | null> {
  const m = q.toLowerCase().match(/^(?:who|which|what) (?:is|are|was) (?:the )?(?:god|goddess|deity|deities|gods|power|patron)(?: \w+)? of (?:the )?(.+?)[?.!]*$/);
  if (!m) return null;
  const want = m[1].replace(/s$/, '').slice(0, 7);
  const all = (await catalog('deity')).filter((d) => d.portfolio && new RegExp(`\\b${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(d.portfolio));
  if (!all.length) return null;
  const fr = (d: CatalogItem) => (d.sources.some((s) => /FRCS|F&P|PGtF|Faiths/.test(s.label)) ? 0 : 1);
  // the term early in a short portfolio = that deity's main concern
  const score = (d: CatalogItem) => fr(d) * 10 + d.portfolio!.toLowerCase().indexOf(want) / 20 + d.portfolio!.split(',').length * 0.3;
  all.sort((a, z) => score(a) - score(z));
  const top = all.slice(0, 3);
  const name = (d: CatalogItem) => esc(d.title.replace(/\s*\(.*\)$/, ''));
  const lead = `${b(top[0].title.replace(/\s*\(.*\)$/, ''))}: ${esc(top[0].portfolio!)}.`;
  const more = top.length > 1 ? ` Also: ${top.slice(1).map((d) => `${name(d)} (${esc(d.portfolio!)})`).join('; ')}.` : '';
  return { html: lead + more, title: top[0].title, href: top[0].sources[0].href, source: top[0].sources[0].label };
}

/** Answer a single-fact question exactly, or null when the question isn't one. */
export async function directAnswer(q: string): Promise<Direct | null> {
  const god = await deityOf(q).catch(() => null);
  if (god) return god;
  const p = parse(q);
  if (!p) return null;
  const attr = p.attr ? ATTRS[p.attr] : null;
  // People and places are best described by the wiki; rules things by the books.
  const wikiFirst = /^\s*(who|where)\b/i.test(q);
  const order = wikiFirst ? [wikiAnswer, rulesAnswer] : [rulesAnswer, wikiAnswer];
  for (const f of order) {
    const a = await f(p, attr).catch(() => null);
    if (a) return a;
  }
  return null;
}

// ------------------------------------------------------------------ list questions

const NUM = '(\\d+)(?:st|nd|rd|th)?';
const CLASS_WORDS: Record<string, string> = {
  bard: 'Brd', bards: 'Brd', cleric: 'Clr', clerics: 'Clr', druid: 'Drd', druids: 'Drd', paladin: 'Pal', paladins: 'Pal', ranger: 'Rgr', rangers: 'Rgr',
  wizard: 'Sor/Wiz', wizards: 'Sor/Wiz', sorcerer: 'Sor/Wiz', sorcerers: 'Sor/Wiz', 'sor/wiz': 'Sor/Wiz', 'sorcerer/wizard': 'Sor/Wiz',
};
const CREATURE_TYPES = ['aberration', 'animal', 'construct', 'dragon', 'elemental', 'fey', 'giant', 'humanoid', 'magical beast', 'monstrous humanoid', 'ooze', 'outsider', 'plant', 'undead', 'vermin'];

/** "level 3 cleric spells", "evocation spells for wizards", "undead monsters cr 4 to 6" → a filtered list. */
export async function listAnswer(q: string): Promise<ListAnswer | null> {
  const s = q.toLowerCase().replace(/[?!.]+$/, '');
  if (/\bspells?\b/.test(s)) {
    let cls = '';
    for (const [w, c] of Object.entries(CLASS_WORDS)) if (new RegExp(`\\b${w.replace('/', '\\/')}\\b`).test(s)) cls = c;
    const lv = s.match(new RegExp(`(?:level|lvl) ${NUM}|${NUM}[- ]level`));
    const level = lv ? Number(lv[1] || lv[2]) : null;
    const school = SCHOOLS.find((sc) => s.includes(sc.toLowerCase()));
    if (!cls && level === null && !school) return null;
    const items = (await catalog('spell')).filter(
      (it) =>
        (!cls || it.lv[cls] !== undefined) &&
        (level === null || (cls ? it.lv[cls] === level : Object.values(it.lv).includes(level))) &&
        (!school || (it.school || '').startsWith(school)),
    );
    const params = new URLSearchParams();
    if (cls) params.set('class', cls);
    if (level !== null) params.set('level', String(level));
    if (school) params.set('school', school);
    const label = [level !== null ? `Level ${level}` : '', school || '', cls ? CLASS_NAMES[cls] || cls : '', 'spells'].filter(Boolean).join(' ');
    return { label, href: `#/rules/spell?${params}`, items: items.slice(0, 12), total: items.length };
  }
  if (/\b(monsters?|creatures?|undead|dragons?|outsiders?|aberrations?|constructs?|elementals?|giants?|oozes?|plants?|vermin|fey|beasts?)\b/.test(s) && /\bcr\b|challenge/.test(s)) {
    const type = CREATURE_TYPES.find((t) => new RegExp(`\\b${t}s?\\b`).test(s));
    const r = s.match(/(?:cr|challenge rating) (\d+(?:\/\d+)?)(?:\s*(?:-|to|–)\s*(\d+))?/);
    if (!r) return null;
    const lo = crValue(r[1]);
    const hi = r[2] ? crValue(r[2]) : lo;
    const items = (await catalog('monster')).filter((it) => {
      const c = crValue(it.cr);
      return c >= lo && c <= hi && (!type || (it.ctype || '').toLowerCase().startsWith(type));
    });
    items.sort((a, b2) => crValue(a.cr) - crValue(b2.cr) || a.title.localeCompare(b2.title));
    const params = new URLSearchParams({ sort: 'cr' });
    if (type) params.set('type', titleCase(type));
    return { label: `${type ? titleCase(type) + ' ' : ''}monsters, CR ${r[1]}${r[2] ? `–${r[2]}` : ''}`, href: `#/rules/monster?${params}`, items: items.slice(0, 12), total: items.length };
  }
  return null;
}
