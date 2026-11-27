// Spells per day (and spells known) for the SRD's spellcasting classes, read from the class
// tables in public/srd/docs/character-classes-*.json → public/srd/spellcasting.json.
// Used by character spellbooks (src/lib/characters.ts). Runs after build-srd.mjs.
//
// Each class: { perDay: { "1": [3, 1, null, …] }, domain: { "1": [0, 1, …] }, known?: { "1": [4, 2, …] } }
// Index = spell level (0–9). null = "—" (no spells of that level yet); 0 = only bonus spells.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'public/srd/docs');

const CLASSES = {
  Bard: { key: 'Brd', ability: 'Cha', casting: 'spontaneous' },
  Cleric: { key: 'Clr', ability: 'Wis', casting: 'prepared' },
  Druid: { key: 'Drd', ability: 'Wis', casting: 'prepared' },
  Paladin: { key: 'Pal', ability: 'Wis', casting: 'prepared' },
  Ranger: { key: 'Rgr', ability: 'Wis', casting: 'prepared' },
  Sorcerer: { key: 'Sor/Wiz', ability: 'Cha', casting: 'spontaneous' },
  Wizard: { key: 'Sor/Wiz', ability: 'Int', casting: 'prepared' },
};

const text = (h) =>
  h
    .replace(/<sup>[\s\S]*?<\/sup>/g, '') // footnote marks: "2<sup>1</sup>" is 2, not 21
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const rowsOf = (table) => [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => text(c[1])));
const levelOf = (label) => {
  const m = label.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
};
const SPELL_LEVEL = /^(0|1st|2nd|3rd|[4-9]th)$/;

/** The spell-level columns at the end of a class table, row by character level. */
function readTable(table) {
  const rows = rowsOf(table);
  const head = rows.find((r) => r.filter((c) => SPELL_LEVEL.test(c)).length >= 3);
  if (!head) return null;
  const spellCols = head.filter((c) => SPELL_LEVEL.test(c)).map((c) => (c === '0' ? 0 : Number(c[0])));
  const k = spellCols.length;
  const out = {};
  const domain = {};
  for (const r of rows) {
    const lv = levelOf(r[0] || '');
    if (!lv || lv > 20 || r.length < k + 1) continue;
    const per = Array(10).fill(null);
    const dom = Array(10).fill(0);
    r.slice(-k).forEach((c, i) => {
      const sl = spellCols[i];
      const m = c.match(/^(\d+)(?:\s*\+\s*(\d+))?$/);
      if (m) {
        per[sl] = Number(m[1]);
        if (m[2]) dom[sl] = Number(m[2]);
      }
    });
    out[lv] = per;
    if (dom.some(Boolean)) domain[lv] = dom;
  }
  return { perDay: out, domain };
}

const result = {};
for (const file of fs.readdirSync(docs).filter((f) => /^character-classes/.test(f))) {
  const doc = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
  doc.blocks.forEach((b, i) => {
    if (!b.startsWith('<table')) return;
    const cap = text(b.match(/<caption[^>]*>([\s\S]*?)<\/caption>/)?.[1] || '') || doc.blocks.slice(Math.max(0, i - 2), i).map(text).reverse().find((t) => /^Table/.test(t)) || text(b).slice(0, 80);
    for (const [name, info] of Object.entries(CLASSES)) {
      if (new RegExp(`Table: The ${name}\\b`).test(cap) && /Spells per Day/.test(text(b))) {
        const t = readTable(b);
        if (t) result[name] = { ...info, perDay: t.perDay, domain: t.domain };
      }
      if (new RegExp(`Table: ${name} Spells Known`).test(cap)) {
        const t = readTable(b);
        if (t && result[name]) result[name].known = t.perDay;
        else if (t) result[name] = { ...info, known: t.perDay };
      }
    }
  });
}

const missing = Object.keys(CLASSES).filter((c) => !result[c]?.perDay || Object.keys(result[c].perDay).length !== 20);
if (missing.length) {
  console.error('spellcasting: could not read', missing.join(', '));
  process.exitCode = 1;
}
fs.writeFileSync(path.join(root, 'public/srd/spellcasting.json'), JSON.stringify(result));
console.log(`spellcasting.json: ${Object.keys(result).join(', ')}`);
