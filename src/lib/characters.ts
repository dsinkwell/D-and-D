// Characters and their spells: spells per day from the class tables (public/srd/spellcasting.json,
// built from the SRD) plus bonus spells from the key ability score, the spells each character
// knows or has prepared, and what has been cast today.
import { catalog, nameKey, type CatalogItem } from './catalog';
import { createRecord, updateRecord, type UserRecord } from './userdata';

export interface SpellRef {
  key: string; // nameKey of the spell
  title: string;
  href: string;
  level: number;
}

export interface PreparedSlot {
  spell?: SpellRef;
  used: boolean;
  domain?: boolean; // a cleric's domain slot
}

export interface CastingClass {
  id: string;
  cls: string; // "Wizard", "Cleric"… or "Other"
  name?: string; // for "Other": the class's name ("Warmage")
  level: number;
  score: number; // key ability score
  // "Other" classes (and adjustments to any class): spells per day typed in by hand, by spell level
  manual?: (number | null)[];
  manualKnown?: (number | null)[];
  casting?: 'prepared' | 'spontaneous'; // for "Other"
  listKey?: string; // for "Other": which class's spell list to choose from ("Sor/Wiz", "Clr"…)
  extra?: number[]; // +/- slots per spell level (items such as a pearl of power, house rules)
  domains?: string; // cleric domains ("Fire, Sun")
  known: SpellRef[]; // wizard spellbook / sorcerer & bard spells known
  prepared: PreparedSlot[][]; // by spell level
  used: number[]; // spontaneous casters: slots used today, by spell level
}

export interface Character {
  classes: CastingClass[];
  notes?: string;
}

export interface ClassInfo {
  key: string; // spell-list key in the catalog ("Sor/Wiz")
  ability: string; // "Int"
  casting: 'prepared' | 'spontaneous';
  perDay: Record<string, (number | null)[]>;
  domain?: Record<string, number[]>;
  known?: Record<string, (number | null)[]>;
}

export const SRD_CLASSES = ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Wizard'];
export const LIST_KEYS: [string, string][] = [
  ['Sor/Wiz', 'Sorcerer/Wizard'],
  ['Clr', 'Cleric'],
  ['Drd', 'Druid'],
  ['Brd', 'Bard'],
  ['Pal', 'Paladin'],
  ['Rgr', 'Ranger'],
];

let infoP: Promise<Record<string, ClassInfo>> | null = null;
export function classTables(): Promise<Record<string, ClassInfo>> {
  infoP ??= fetch(`${import.meta.env.BASE_URL}srd/spellcasting.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => {
      infoP = null;
      return {};
    });
  return infoP;
}

export const abilityMod = (score: number) => Math.floor((score - 10) / 2);

/** Bonus spells for a key ability score (3.5 PHB Table 1–1), spell levels 1–9. */
export function bonusSpells(score: number, spellLevel: number): number {
  const mod = abilityMod(score);
  if (spellLevel < 1 || mod < spellLevel) return 0;
  return Math.floor((mod - spellLevel) / 4) + 1;
}

export interface LevelSlots {
  level: number; // spell level 0–9
  base: number | null; // from the class table; null = "—" (none yet)
  bonus: number;
  domain: number;
  extra: number;
  total: number; // base + bonus + extra (not counting the domain slot)
  known?: number | null; // spontaneous casters: spells known allowed
  tooLow: boolean; // key ability too low to cast spells of this level (needs 10 + level)
}

export function slotsFor(c: CastingClass, info: Record<string, ClassInfo>): LevelSlots[] {
  const ci = info[c.cls];
  const lv = String(Math.max(1, Math.min(20, c.level)));
  const base = c.cls === 'Other' || !ci ? c.manual || [] : ci.perDay[lv] || [];
  const known = c.cls === 'Other' || !ci ? c.manualKnown : ci.known?.[lv];
  const dom = ci?.domain?.[lv] || [];
  const out: LevelSlots[] = [];
  for (let l = 0; l <= 9; l++) {
    const b = base[l] ?? null;
    const extra = c.extra?.[l] || 0;
    const tooLow = c.score < 10 + l;
    if (b === null && !extra) continue;
    const bonus = b === null ? 0 : bonusSpells(c.score, l);
    const total = tooLow ? 0 : Math.max(0, (b || 0) + bonus + extra);
    out.push({ level: l, base: b, bonus, domain: tooLow ? 0 : dom[l] || 0, extra, total, known: known ? known[l] ?? null : undefined, tooLow });
  }
  return out;
}

export const castingOf = (c: CastingClass, info: Record<string, ClassInfo>) => (c.cls === 'Other' || !info[c.cls] ? c.casting || 'prepared' : info[c.cls].casting);
export const listKeyOf = (c: CastingClass, info: Record<string, ClassInfo>) => (c.cls === 'Other' || !info[c.cls] ? c.listKey || 'Sor/Wiz' : info[c.cls].key);
export const className = (c: CastingClass) => (c.cls === 'Other' ? c.name || 'Other class' : c.cls);
/** Wizards prepare from their spellbook; clerics, druids, paladins and rangers from their whole list. */
export const usesSpellbook = (c: CastingClass) => c.cls === 'Wizard' || (c.cls === 'Other' && c.casting === 'prepared' && c.listKey === 'Sor/Wiz');

/** Spells on a class's list at one spell level (SRD + books), and a cleric's domain spells. */
export async function spellsFor(listKey: string, level: number, domains?: string): Promise<(CatalogItem & { lvl: number })[]> {
  const all = await catalog('spell');
  const doms = (domains || '')
    .split(/[,;/]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const out: (CatalogItem & { lvl: number })[] = [];
  for (const it of all) {
    let lvl = it.lv[listKey];
    if (lvl === undefined && doms.length) for (const [k, v] of Object.entries(it.lv)) if (doms.includes(k.toLowerCase())) lvl = v;
    if (lvl === level) out.push({ ...it, lvl });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export const refOf = (it: CatalogItem, level: number): SpellRef => ({ key: it.key || nameKey(it.title), title: it.title, href: it.sources[0]?.href || '', level });

export function newClass(cls = 'Wizard'): CastingClass {
  return { id: Math.random().toString(36).slice(2, 10), cls, level: 1, score: 14, known: [], prepared: [], used: [] };
}

export function createCharacter(name: string, cls = 'Wizard') {
  return createRecord<Character>('character', name, { classes: [newClass(cls)] });
}

export const updateCharacter = (id: string, change: (c: Character) => void, rename?: string) => updateRecord<Character>(id, change, rename);

/** A new day: every slot unused again (prepared spells stay prepared). */
export function rest(ch: Character) {
  for (const c of ch.classes) {
    c.used = [];
    for (const lvl of c.prepared) for (const s of lvl || []) if (s) s.used = false;
  }
}

/** Prepared slots for a level, sized to today's allowance (keeps what was prepared). */
export function preparedAt(c: CastingClass, s: LevelSlots): PreparedSlot[] {
  const cur = c.prepared[s.level] || [];
  const want = s.total + s.domain;
  const out: PreparedSlot[] = [];
  for (let i = 0; i < want; i++) out.push(cur[i] ? { ...cur[i], domain: i >= s.total } : { used: false, domain: i >= s.total });
  return out;
}

export type CharacterRecord = UserRecord<Character>;
