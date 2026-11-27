// Builds the bundled 3.5 SRD data used by the app.
//
// Input:  vendor/srd-md/**/*.md  (Revised v3.5 System Reference Document, OGL 1.0a,
//         Markdown conversion from https://github.com/olimot/srd-v3.5-md)
// Output: public/srd/chapters.json   chapter list (grouped, ordered)
//         public/srd/entries.json    every searchable entry (spells, feats, monsters, items, rules…)
//         public/srd/search.json     prebuilt MiniSearch full-text index
//         public/srd/docs/<id>.json  rendered HTML blocks for each chapter
//
// Run with: npm run build:srd

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import MiniSearch from 'minisearch';
import { SEARCH_OPTIONS } from '../src/lib/searchOptions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'vendor/srd-md');
const OUT = path.join(root, 'public/srd');

// ---------------------------------------------------------------- helpers

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);
const stripTags = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const stripMd = (s) => s.replace(/\\([[\]()*_])/g, '$1').replace(/[*_]/g, '').trim();
const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';

const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s(\-&/])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\b(Ii|Iii|Iv|Vi|Vii)\b/g, (m) => m.toUpperCase());

function truncate(s, n = 150) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

// ---------------------------------------------------------------- chapter order from README

const readme = fs.readFileSync(path.join(SRC, 'README.md'), 'utf8');
const chapters = [];
{
  let group = null;
  for (const line of readme.split('\n')) {
    const g = line.match(/^- ## (.+)$/);
    if (g) group = g[1].trim();
    const l = line.match(/^\s+- \[(.+?)\]\((.+?\.md)\)/);
    if (l && group) chapters.push({ id: path.basename(l[2], '.md'), file: l[2], title: l[1], group });
  }
}
const listed = new Set(chapters.map((c) => c.file));
for (const dir of fs.readdirSync(SRC)) {
  const p = path.join(SRC, dir);
  if (!fs.statSync(p).isDirectory()) continue;
  for (const f of fs.readdirSync(p).filter((f) => f.endsWith('.md')).sort()) {
    const rel = `${dir}/${f}`;
    if (!listed.has(rel)) {
      chapters.push({ id: path.basename(f, '.md'), file: rel, title: titleCase(path.basename(f, '.md').replace(/-/g, ' ')), group: titleCase(dir.replace(/-/g, ' ')) });
    }
  }
}

// ---------------------------------------------------------------- categorisation rules

const isMonsterFile = (f) => /^monsters\/monsters-|epic-monsters|psionic-monsters/.test(f);
const isClassFile = (f) => /character-classes|npc-classes|psionic-classes|epic-classes/.test(f);
const isPrestigeFile = (f) => /prestige-classes/.test(f);
const isRaceFile = (f) => /\/races\.md|psionic-races/.test(f);
const isSpellFile = (f) => /^spells\/spells-|psionic-spells/.test(f);
const isPowerFile = (f) => /psionic-powers-[a-z]-[a-z]/.test(f);
const isItemFile = (f) => /^magic-items\/|epic-magic-items|psionic-items/.test(f);
const ITEM_SECTION = /Descriptions?$|^Specific|Artifacts$|^Nonepic Magic Item/;
const ITEM_LABELS = /^(Physical Description|Activation|Special Qualities|Identifying .*|Aura|Manifester Level|Caster Level|Prerequisites|Market Price|Cost to Create|Weight|Description)$/;
const RACE_EXCLUDE = new Set(['Favored Class', 'Race and Languages', 'Small Characters', 'Age, Height, and Weight']);

const SPELL_FIELDS = ['Level', 'Components', 'Casting Time', 'Range', 'Target', 'Targets', 'Effect', 'Area', 'Duration', 'Saving Throw', 'Spell Resistance'];
const POWER_FIELDS = ['Discipline', 'Level', 'Display', 'Manifesting Time', 'Range', 'Target', 'Targets', 'Effect', 'Area', 'Duration', 'Saving Throw', 'Power Resistance', 'Power Points'];

function parseFields(blocksMd) {
  const out = {};
  for (const md of blocksMd) {
    const m = md.match(/^\*\*([A-Za-z /]+):\*\*\s*([\s\S]*)$/);
    if (m) out[m[1].trim()] = stripMd(m[2]).replace(/\s+/g, ' ');
  }
  return out;
}

function parseLevels(levelStr) {
  // "Sor/Wiz 6, Water 7"  -> { "Sor/Wiz": 6, "Water": 7 }
  const lv = {};
  for (const part of (levelStr || '').split(',')) {
    const m = part.trim().match(/^(.+?)\s+(\d+)$/);
    if (m) lv[m[1].replace(/^Wiz$/, 'Sor/Wiz')] = Number(m[2]);
  }
  return lv;
}

function parseStatTable(html) {
  const row = (label) => {
    const m = html.match(new RegExp(`<th>${label}:?</th><td>(.*?)</td>`));
    return m ? stripTags(m[1]) : undefined;
  };
  const meta = {};
  const SIZE = /^(Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)(?:-size)?\s+(.+?)(?:\s*\((.+)\))?$/i;
  const typeRows = [...html.matchAll(/<tr><td><\/td><td>(.*?)<\/td>/g)].map((m) => stripTags(m[1]));
  meta.type = typeRows.find((t) => SIZE.test(t)) || typeRows[0];
  if (!meta.type) delete meta.type;
  const cr = row('Challenge Rating');
  if (cr) meta.cr = cr;
  const hd = row('Hit Dice');
  if (hd) meta.hd = hd;
  if (meta.type) {
    const t = meta.type.match(SIZE);
    if (t) {
      meta.size = t[1].charAt(0).toUpperCase() + t[1].slice(1).toLowerCase();
      meta.ctype = t[2].replace(/\s+/g, ' ');
    }
  }
  return meta;
}

// ---------------------------------------------------------------- main pass

const docsOut = [];
const entries = [];
const searchDocs = [];

for (const ch of chapters) {
  const md = fs.readFileSync(path.join(SRC, ch.file), 'utf8');
  const tokens = marked.lexer(md);
  const blocks = []; // { html, md, level?, title?, anchor?, small?, boldLead? }
  const used = new Set();
  const uniqueAnchor = (title) => {
    let a = slugify(title);
    let n = 2;
    while (used.has(a)) a = `${slugify(title)}-${n++}`;
    used.add(a);
    return a;
  };

  for (const tok of tokens) {
    if (tok.type === 'space') continue;
    const single = [tok];
    single.links = tokens.links;
    let html = marked.parser(single).trim();
    const b = { html, md: tok.raw.trim() };
    if (tok.type === 'heading') {
      const small = tok.text.match(/<small>(.*?)<\/small>/);
      b.level = tok.depth;
      b.title = stripMd(stripTags(tok.text.replace(/<small>.*?<\/small>/, '')));
      b.small = small ? stripTags(small[1]) : undefined;
      b.anchor = tok.depth === 1 ? 'top' : uniqueAnchor(b.title);
      b.html = html.replace(/^<h(\d)>/, `<h$1 id="${b.anchor}">`);
    } else if (tok.type === 'paragraph') {
      const m = tok.raw.match(/^\*\*([^*\n]{2,80}?):\*\*/);
      if (m) b.boldLead = stripMd(m[1]);
    }
    blocks.push(b);
  }

  // Heading stack walk to find bold-lead entries in item/condition contexts.
  const stack = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.level) {
      while (stack.length && stack[stack.length - 1].level >= b.level) stack.pop();
      stack.push(b);
      continue;
    }
    if (!b.boldLead) continue;
    const titles = stack.map((s) => s.title);
    let cat = null;
    const nearest = titles[titles.length - 1] || '';
    if (isItemFile(ch.file) && ITEM_SECTION.test(nearest) && !ITEM_LABELS.test(b.boldLead) && !titles.some((t) => /^Intelligent/.test(t))) cat = 'item';
    if (/special-abilities-and-conditions/.test(ch.file) && titles.includes('Conditions')) cat = 'condition';
    if (cat) {
      b.itemCat = cat;
      b.anchor = uniqueAnchor(b.boldLead);
      b.html = b.html.replace(/^<p>/, `<p id="${b.anchor}" class="item-lead">`);
      b.parentTitle = stack[stack.length - 1]?.title;
    }
  }

  const docTitle = ch.title;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let start = i,
      end = blocks.length,
      ownEnd = blocks.length,
      cat = 'rule',
      meta = {},
      title,
      parent;

    if (b.level && b.level >= 2) {
      title = b.title;
      if (title === 'Feat Name') continue;
      for (let j = i + 1; j < blocks.length; j++) {
        if (blocks[j].level && ownEnd === blocks.length) ownEnd = j;
        if (blocks[j].level && blocks[j].level <= b.level) {
          end = j;
          break;
        }
      }
      // parent heading for breadcrumb
      for (let j = i - 1; j >= 0; j--) {
        if (blocks[j].level && blocks[j].level < b.level) {
          parent = blocks[j].level === 1 ? undefined : blocks[j].title;
          break;
        }
      }
      const range = blocks.slice(i + 1, end);
      const firstBody = blocks[i + 1];
      const hasStat = (bl) => bl && /<th>Hit Dice:?<\/th>/.test(bl.html);

      if (b.small && /^\[.+\]$/.test(b.small)) {
        cat = 'feat';
        meta.ftype = b.small.slice(1, -1);
      } else if (b.small && (b.level === 2 || (b.level === 3 && /^skills-/.test(ch.id))) && /\((Str|Dex|Con|Int|Wis|Cha|None)/.test('(' + b.small)) {
        cat = 'skill';
        meta.ability = b.small;
      } else if (b.level === 2 && isSpellFile(ch.file) && parseFields(blocks.slice(i + 1, ownEnd).map((x) => x.md)).Level) {
        cat = 'spell';
        const school = firstBody && !firstBody.boldLead ? stripMd(firstBody.md).replace(/\s+/g, ' ') : '';
        const f = parseFields(blocks.slice(i + 1, ownEnd).map((x) => x.md));
        meta.school = school;
        for (const k of SPELL_FIELDS) if (f[k]) meta[k] = f[k];
        meta.lv = parseLevels(f.Level);
      } else if (b.level === 2 && isPowerFile(ch.file)) {
        cat = 'power';
        const f = parseFields(blocks.slice(i + 1, ownEnd).map((x) => x.md));
        for (const k of POWER_FIELDS) if (f[k]) meta[k] = f[k];
        meta.lv = parseLevels(f.Level);
      } else if (isMonsterFile(ch.file) && firstBody && /^\*\*[A-Z][^*:]+\*\*$/.test(firstBody.md) && /Challenge Ratings?:/.test(blocks.slice(i + 1, ownEnd).map((x) => x.md).join('\n'))) {
        // True dragons: stats are given per age category, with a bold type line and CR field.
        cat = 'monster';
        const own = blocks.slice(i + 1, ownEnd);
        const f = parseFields(own.map((x) => x.md));
        const typeLine = own.find((x) => /^\*\*[^*:]+\*\*$/.test(x.md));
        const crs = ((f['Challenge Rating'] || f['Challenge Ratings'] || '').match(/\d+/g) || []).map(Number);
        meta = { ctype: typeLine ? stripMd(typeLine.md).replace(/\s*\(.*$/, '') : undefined, type: typeLine ? stripMd(typeLine.md) : undefined };
        if (crs.length) meta.cr = crs.length > 1 ? `${Math.min(...crs)}–${Math.max(...crs)}` : String(crs[0]);
        meta.ages = true;
      } else if (hasStat(firstBody) || (b.level === 2 && isMonsterFile(ch.file) && range.some(hasStat))) {
        cat = 'monster';
        const stat = hasStat(firstBody) ? firstBody : range.find(hasStat);
        meta = parseStatTable(stat.html);
        if (!hasStat(firstBody)) meta.group = true;
      } else if (b.level === 2 && isClassFile(ch.file) && range.some((x) => x.level && /Class (Skills|Features)/.test(x.title))) {
        cat = 'class';
      } else if (b.level === 2 && isPrestigeFile(ch.file) && range.some((x) => x.level && /Requirements|Class Features/.test(x.title))) {
        cat = 'prestige';
      } else if (b.level === 2 && isRaceFile(ch.file) && !RACE_EXCLUDE.has(title)) {
        cat = 'race';
      }
    } else if (b.itemCat) {
      title = b.boldLead;
      cat = b.itemCat;
      parent = b.parentTitle;
      for (let j = i + 1; j < blocks.length; j++) {
        if (blocks[j].level || blocks[j].itemCat) {
          end = j;
          break;
        }
      }
      ownEnd = end;
      if (cat === 'item') {
        const aura = blocks.slice(i, end).map((x) => x.md).find((m) => /CL \d+/.test(m) && /Price/.test(m));
        if (aura) {
          const price = aura.match(/Price\s*([^;.]+?)(?:;|\.|$)/);
          const cl = aura.match(/CL (\d+)/);
          if (price) meta.price = stripMd(price[1]).trim();
          if (cl) meta.cl = Number(cl[1]);
        }
        meta.kind = parent;
      }
    } else continue;

    // summary
    let summary = '';
    for (let j = start + (b.level ? 1 : 0); j < ownEnd && !summary; j++) {
      const x = blocks[j];
      if (!x.html.startsWith('<p')) continue;
      if (/^\*\*[^*]+:\*\*/.test(x.md) && !b.itemCat) continue;
      if (j === start + 1 && cat === 'spell') continue; // school line
      summary = stripTags(x.html);
      if (b.itemCat) summary = summary.replace(/^[^:]{1,80}:\s*/, '');
    }

    const id = `${ch.id}/${b.anchor}`;
    const ownText = blocks
      .slice(start + (b.level ? 1 : 0), ownEnd)
      .map((x) => stripTags(x.html))
      .join(' ');

    const aliases = [];
    const comma = title.match(/^(.+?), (Greater|Lesser|Mass|Improved|Superior|Legendary|Elite)$/);
    if (comma) aliases.push(`${comma[2]} ${comma[1]}`);

    const entry = { i: id, t: title, c: cat, d: ch.id, a: b.anchor, s: start, e: end };
    if (parent) entry.p = parent;
    if (summary) entry.x = truncate(summary);
    if (Object.keys(meta).length) entry.m = meta;
    if (aliases.length) entry.al = aliases;
    entries.push(entry);
    searchDocs.push({ id: entries.length - 1, title, aliases: aliases.join(' '), parent: parent || '', text: ownText });
  }

  docsOut.push({ ...ch, docTitle, blocks });
}

// ---------------------------------------------------------------- cross-links: italic spell & power names, bold condition names

const linkable = new Map();
for (const e of entries) {
  if (e.c === 'spell' || e.c === 'power') {
    linkable.set(e.t.toLowerCase(), e.i);
    for (const a of e.al || []) linkable.set(a.toLowerCase(), e.i);
  }
}

for (const doc of docsOut) {
  let here = '';
  for (const b of doc.blocks) {
    if (b.level) {
      here = `${doc.id}/${b.anchor}`;
      continue;
    }
    if (b.itemCat) here = `${doc.id}/${b.anchor}`;
    b.html = b.html.replace(/<em>([^<]{3,60}?)([,;:.]?)<\/em>/g, (whole, name, punct) => {
      const key = decode(name).trim().toLowerCase();
      const target = linkable.get(key);
      if (!target || target === here) return whole;
      return `<a class="xref" href="#/srd/e/${target}"><em>${name}</em></a>${punct}`;
    });
  }
}

// ---------------------------------------------------------------- write

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });

for (const doc of docsOut) {
  const out = {
    id: doc.id,
    title: doc.title,
    group: doc.group,
    blocks: doc.blocks.map((b) => b.html),
    toc: doc.blocks
      .map((b, i) => (b.level && b.level >= 2 && b.level <= 3 ? [i, b.level, b.title, b.anchor] : null))
      .filter(Boolean),
  };
  fs.writeFileSync(path.join(OUT, 'docs', `${doc.id}.json`), JSON.stringify(out));
}

fs.writeFileSync(path.join(OUT, 'chapters.json'), JSON.stringify(chapters.map(({ id, title, group }) => ({ id, title, group }))));
fs.writeFileSync(path.join(OUT, 'entries.json'), JSON.stringify(entries));

const ms = new MiniSearch(SEARCH_OPTIONS);
ms.addAll(searchDocs);
fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify(ms));

// ---------------------------------------------------------------- report

const counts = {};
for (const e of entries) counts[e.c] = (counts[e.c] || 0) + 1;
const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
console.log(`chapters: ${chapters.length}, entries: ${entries.length}`);
console.log(counts);
console.log('entries.json', size('entries.json'), '| search.json', size('search.json'));
