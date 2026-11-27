// Homebrew entries (spells, feats, items, monsters, skills, house rules…) and the group's house
// rules. They are user records (src/lib/userdata.ts), shown like book entries (#/homebrew/<id>)
// and merged into the catalog, search, tap-to-link and Ask (catalog.ts reads them).
//
// A homebrew entry can `replace` printed entries (the group's skills: Stealth replaces Hide and
// Move Silently). While house rules are switched on, the printed entries show a "House rule"
// banner pointing to the replacement, searches for the old names find the new entry, and Ask is
// given the house rule first.
import { getRecord, listRecords, loadUserData, type UserRecord } from './userdata';
import type { Category } from './srd';

export interface HomebrewData {
  kind: Category;
  fields: [string, string][]; // stat lines: ["Level", "Sor/Wiz 2"]
  text: string; // description; blank line = new paragraph, **bold**, *italic*
  aliases?: string[]; // other names it is found by
  replaces?: string[]; // printed entries it replaces while house rules are on ("Hide", "Move Silently")
  draft?: boolean; // made by the app (e.g. drafted from the SRD) and not yet reviewed
}

export type HomebrewRecord = UserRecord<HomebrewData>;

export const FIELD_PRESETS: Partial<Record<Category, string[]>> = {
  spell: ['School', 'Level', 'Components', 'Casting Time', 'Range', 'Target', 'Duration', 'Saving Throw', 'Spell Resistance'],
  feat: ['Type', 'Prerequisite', 'Benefit', 'Normal', 'Special'],
  item: ['Price', 'Body Slot', 'Caster Level', 'Aura', 'Activation', 'Weight'],
  monster: ['Size/Type', 'Hit Dice', 'Initiative', 'Speed', 'Armor Class', 'Base Attack/Grapple', 'Attack', 'Full Attack', 'Space/Reach', 'Special Attacks', 'Special Qualities', 'Saves', 'Abilities', 'Skills', 'Feats', 'Challenge Rating', 'Alignment'],
  skill: ['Key Ability', 'Trained Only', 'Armor Check Penalty', 'Replaces', 'Class Skill For'],
  rule: [],
  class: ['Hit Die', 'Skill Points', 'Class Skills'],
  prestige: ['Requirements', 'Hit Die', 'Skill Points'],
  race: ['Size', 'Speed', 'Ability Adjustments', 'Favored Class'],
  condition: [],
  deity: ['Alignment', 'Portfolio', 'Domains', 'Favored Weapon'],
  trap: ['CR', 'Type', 'Search DC', 'Disable Device DC', 'Market Price'],
};

export const homebrewHref = (id: string) => `#/homebrew/${id}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>');

/** The entry as HTML in the same shape as book entries (stat lines, then paragraphs). */
export function homebrewHtml(d: HomebrewData): string {
  const stats = d.fields.filter(([k, v]) => k.trim() && v.trim());
  const head = stats.length ? `<p>${stats.map(([k, v]) => `<b>${esc(k)}:</b> ${inline(v)}`).join('<br>')}</p>` : '';
  const body = d.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/^#{1,3}\s/.test(p) ? `<h3>${inline(p.replace(/^#+\s*/, ''))}</h3>` : /^[-•]\s/m.test(p) ? `<ul>${p.split('\n').map((l) => `<li>${inline(l.replace(/^[-•]\s*/, ''))}</li>`).join('')}</ul>` : `<p>${inline(p).replace(/\n/g, '<br>')}</p>`))
    .join('\n');
  return head + body;
}

export const homebrewText = (d: HomebrewData) => `${d.fields.map(([k, v]) => `${k}: ${v}`).join('\n')}\n${d.text}`;

export async function allHomebrew(): Promise<HomebrewRecord[]> {
  await loadUserData();
  return listRecords<HomebrewData>('homebrew');
}

// ------------------------------------------------------------------ house rules on/off

const HR_KEY = 'rc.houserules.on';
export function houseRulesOn(): boolean {
  try {
    return localStorage.getItem(HR_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setHouseRulesOn(on: boolean) {
  try {
    localStorage.setItem(HR_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event('rc-houserules'));
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The homebrew entry that replaces a printed entry (by name), while house rules are on. */
export async function replacementFor(title: string, evenWhenOff = false): Promise<HomebrewRecord | null> {
  if (!houseRulesOn() && !evenWhenOff) return null;
  const k = norm(title.replace(/\s*\([^)]*\)\s*$/, '')); // "Hide (Dex; Armor Check Penalty)"
  for (const r of await allHomebrew()) if ((r.data.replaces || []).some((x) => norm(x) === k)) return r;
  return null;
}

/** Homebrew entries whose name, aliases or replaced names appear in a question (for Ask). */
export async function homebrewIn(q: string): Promise<HomebrewRecord[]> {
  const qn = ` ${norm(q)} `;
  const out: HomebrewRecord[] = [];
  for (const r of await allHomebrew()) {
    const names = [r.name, ...(r.data.aliases || []), ...(houseRulesOn() ? r.data.replaces || [] : [])].map(norm).filter((n) => n.length >= 3);
    if (names.some((n) => qn.includes(` ${n} `))) out.push(r);
  }
  return out;
}

export const getHomebrew = (id: string) => getRecord<HomebrewData>(id);
