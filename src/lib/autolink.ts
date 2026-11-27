// Tap-to-link rules text: spell, feat, skill, condition and magic-item names inside an entry
// become links to that entry ("…as the *dispel magic* spell", "…is flat-footed").
//
// Runs on the HTML of a page just before it is shown; the stored text is never changed.
// Names come from the merged catalog (SRD + rulebooks), so a link opens the best source.
// To keep ordinary words ordinary, each kind has its own rule for when a name counts:
//   spells, items  – the name is set in italics (as the books print them), or followed by "spell"
//   feats          – Title Case; one-word feats ("Dodge", "Run") only in a feat list or before "feat"
//   skills         – Capitalised and used as a skill: "Hide check", "Spot +6", "ranks in Tumble",
//                    "Knowledge (arcana)", or in a Skills line
//   conditions     – the curated condition words below, in any case
// Conditions and skills are linked once per page; spells, feats and items every time they appear
// in a new paragraph.
import { useEffect, useMemo, useState } from 'react';
import { catalog, catalogGeneration, nameKey } from './catalog';
import { Category } from './srd';

type LinkKind = 'spell' | 'feat' | 'skill' | 'condition' | 'item';

interface Target {
  kind: LinkKind;
  needsContext?: boolean; // a feat that shares its name with a rules section ("Damage Reduction")
  href: string;
  title: string;
  words: string[]; // lower-case words of the name
}

export interface LinkIndex {
  italic: Map<string, Target>; // nameKey → spell or item (for italic phrases)
  byFirst: Map<string, Target[]>; // first word → names starting with it, longest first
}

// Conditions that are also everyday words in rules text are left out ("dead", "disabled",
// "stable", "turned", "checked", "normal").
const CONDITIONS = new Set([
  'ability damaged', 'ability drained', 'blinded', 'blown away', 'cowering', 'dazed', 'dazzled', 'deafened', 'dying',
  'energy drained', 'entangled', 'exhausted', 'fascinated', 'fatigued', 'flat-footed', 'frightened', 'grappling',
  'helpless', 'incorporeal', 'invisible', 'knocked down', 'nauseated', 'panicked', 'paralyzed', 'petrified', 'pinned',
  'prone', 'shaken', 'sickened', 'staggered', 'stunned', 'unconscious',
]);

// Feat titles that are really section headings in some books.
const NOT_FEATS = /^(benefit|normal|special|prerequisites?|feats?|general|metamagic|item creation|fighter bonus feats?|regional|divine|epic|tactical|magic|.* feats)$/i;

// Spell names that are also school names or name parts ("divination spells", "begins with greater")
// are never linked; "symbol" only in italics.
const NOT_SPELLS = /^(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation|greater|lesser|mass)$/i;
const ITALIC_ONLY_SPELLS = /^symbol$/i;

// Epic feats named after special abilities: linked only in a feat list or before "feat".
const ABILITY_NAMES = /^(damage reduction|energy resistance|fast healing|spell resistance|frightful presence|trample|regeneration|blindsight|improved spell resistance)$/i;

const WORD = /[A-Za-z][A-Za-z'’-]*/g;
const SMALL = new Set(['of', 'the', 'and', 'or', 'a', 'an', 'to', 'in', 'on', 'with', 'for', 'from', 'by', 'at']);

const LINK_KINDS: [Category, LinkKind][] = [
  ['spell', 'spell'],
  ['feat', 'feat'],
  ['skill', 'skill'],
  ['condition', 'condition'],
  ['item', 'item'],
];

let indexP: Promise<LinkIndex> | null = null;
let indexGen = -1;

export function linkIndex(): Promise<LinkIndex> {
  if (indexGen !== catalogGeneration()) indexP = null;
  indexGen = catalogGeneration();
  indexP ??= build().catch((e) => {
    indexP = null;
    throw e;
  });
  return indexP;
}

async function build(): Promise<LinkIndex> {
  const italic = new Map<string, Target>();
  const byFirst = new Map<string, Target[]>();
  const lists = await Promise.all(LINK_KINDS.map(([cat]) => catalog(cat).catch(() => [])));
  // a "feat" with a skill's or condition's name is a junk heading in some book
  const otherNames = new Set([...lists[2], ...lists[3]].map((it) => nameKey(it.title)));
  for (const [n, [, kind]] of LINK_KINDS.entries()) {
    const items = lists[n];
    for (const it of items) {
      const href = it.sources[0]?.href;
      if (!href) continue;
      const title = it.title.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
      if (kind === 'condition' && !CONDITIONS.has(title.toLowerCase())) continue;
      if (kind === 'spell' && NOT_SPELLS.test(title)) continue;
      if (kind === 'feat' && (NOT_FEATS.test(title) || title.length < 3 || otherNames.has(nameKey(title)))) continue;
      // book titles in capitals or with stray characters are not names worth matching
      if (!/^[A-Za-z][A-Za-z'’ ,()-]*[A-Za-z)]$/.test(title)) continue;
      const t: Target = { kind, href, title, words: (title.toLowerCase().match(WORD) || []).map(normWord) };
      if (kind === 'feat' && ABILITY_NAMES.test(title)) t.needsContext = true;
      if (!t.words.length) continue;
      if (kind === 'spell' || kind === 'item') {
        const k = nameKey(title);
        // spells win over items of the same name; the first (best-sourced) entry wins otherwise
        if (!italic.has(k) || (kind === 'spell' && italic.get(k)!.kind !== 'spell')) italic.set(k, t);
      }
      if (kind === 'item') continue; // items only link from italics
      // "Magic Missile" and "Cure Light Wounds, Mass" (→ also "mass cure light wounds")
      const variants = [t.words];
      const m = title.match(/^(.+?),\s*(greater|lesser|mass|improved|superior)$/i);
      if (m) variants.push([m[2].toLowerCase(), ...(m[1].toLowerCase().match(WORD) || []).map(normWord)]);
      for (const words of variants) {
        const v = { ...t, words };
        const list = byFirst.get(words[0]) || [];
        if (!list.some((x) => x.kind === v.kind && x.words.join(' ') === words.join(' '))) list.push(v);
        byFirst.set(words[0], list);
      }
    }
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length);
  return { italic, byFirst };
}

const normWord = (w: string) => w.toLowerCase().replace(/’/g, "'");

const isCap = (w: string) => /^[A-Z]/.test(w);
const titleCase = (words: string[]) => words.every((w, i) => isCap(w) || (i > 0 && SMALL.has(w.toLowerCase())));

/** The text of the block a node sits in (paragraph, stat line, list item, table cell). */
function blockOf(node: Node): Element | null {
  let el = node.parentElement;
  while (el && !/^(P|LI|TD|TH|DD|DT|BLOCKQUOTE)$/.test(el.tagName) && !el.classList.contains('stat')) el = el.parentElement;
  return el;
}
const FEAT_CONTEXT = /^\s*(feats?|bonus feats?|prerequisites?|prerequisite|epic feats?|requirements?)\b/i;
const SKILL_CONTEXT = /^\s*(skills?|class skills?|skills and feats|requirements?)\b/i;

function allowed(t: Target, text: string, end: number, start: number, matched: string[], block: string): boolean {
  const after = text.slice(end, end + 24);
  const before = text.slice(Math.max(0, start - 40), start);
  switch (t.kind) {
    case 'condition':
      return true;
    case 'spell':
      // non-italic spell names only when written as "the fireball spell"
      if (matched.length === 1 && ITALIC_ONLY_SPELLS.test(matched[0])) return false;
      return /^\s+spells?\b/i.test(after) && (titleCase(matched) || matched.every((w) => w === w.toLowerCase()));
    case 'feat':
      if (!titleCase(matched)) return false;
      // "Damage Reduction:", "Energy Resistance (Ex)", "Fast Healing 3" are special abilities
      if (/^\s*(:|\((Ex|Su|Sp)\)|\d)/.test(after)) return false;
      // part of a longer name ("the Forest Communion of the Crescent Moon")
      if (/[^.!?:;\s]\s+[A-Z][a-z’']+\s+(of\s+the|of|the)\s+$/.test(before)) return false;
      if (matched.length > 1 && !t.needsContext) return true;
      return /^\s+feats?\b/i.test(after) || FEAT_CONTEXT.test(block);
    case 'skill':
      if (!titleCase(matched)) return false;
      return (
        /^\s*(\(|checks?\b|skill\b|ranks?\b|modifier\b|bonus\b|[+−–-]\s?\d)/.test(after) ||
        /\branks? in\s+$/i.test(before) ||
        SKILL_CONTEXT.test(block)
      );
    default:
      return false;
  }
}

export interface AutolinkOptions {
  /** Don't link to the page being shown. */
  selfHref?: string;
  selfTitle?: string;
}

/** Returns `html` with rules names turned into links. */
export function autolink(html: string, idx: LinkIndex, opts: AutolinkOptions = {}): string {
  if (typeof DOMParser === 'undefined' || !html) return html;
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root')!;
  const selfKey = opts.selfTitle ? nameKey(opts.selfTitle) : '';
  // In a whole chapter, each heading's section counts as "self" for that heading's name.
  const sectionKey = new Map<Element, string>();
  let current = '';
  for (const child of Array.from(root.children)) {
    if (/^H[1-6]$/.test(child.tagName)) current = nameKey(child.textContent || '');
    sectionKey.set(child, current);
  }
  const topOf = (n: Node) => {
    let e = n.parentElement;
    while (e && e.parentElement !== root && e !== root) e = e.parentElement;
    return e;
  };
  const isSelf = (t: Target, at: Node) => {
    const k = nameKey(t.title);
    if (t.href === opts.selfHref || k === selfKey) return true;
    const top = topOf(at);
    return !!top && sectionKey.get(top) === k;
  };
  const onceDone = new Set<string>(); // condition/skill hrefs already linked on this page
  const doneInBlock = new WeakMap<Element, Set<string>>();

  const makeLink = (t: Target, text: string) => {
    const a = doc.createElement('a');
    a.href = t.href;
    a.className = `rl rl-${t.kind}`;
    a.textContent = text;
    return a;
  };
  const skip = (el: Element | null) => {
    for (let e = el; e && e !== root; e = e.parentElement) {
      if (/^(A|H1|H2|H3|H4|H5|H6|BUTTON)$/.test(e.tagName) || e.classList.contains('lbl') || e.classList.contains('ability-name')) return true;
      // bold run-in labels name the paragraph itself ("Trap Sense (Ex):", "Benefit:")
      if (/^(B|STRONG)$/.test(e.tagName) && /:\s*$|\((Ex|Su|Sp)\)/.test(e.textContent || '')) return true;
    }
    return false;
  };

  // 1. Italic phrases: spells and magic items.
  for (const em of Array.from(root.querySelectorAll('i, em'))) {
    if (skip(em) || em.querySelector('a')) continue;
    const raw = (em.textContent || '').replace(/[.,;:]+$/, '').trim();
    // italic run-in labels ("Spell Resistance:") name a paragraph, not a spell
    if (!raw || raw.length > 60 || /:\s*$/.test(em.textContent || '')) continue;
    const t = idx.italic.get(nameKey(raw)) || idx.italic.get(nameKey(raw.replace(/\s*[+−-]\d+$/, '')));
    // one-word items ("charming", "ghost touch") are too often ordinary words in italics
    if (!t || isSelf(t, em) || (t.kind === 'item' && t.words.length < 2)) continue;
    const a = makeLink(t, '');
    const only = em.childNodes.length === 1 && em.firstChild?.nodeType === 3 ? (em.firstChild as Text).data : null;
    const m = only?.match(/^(\s*)(.*?)([\s.,;:]*)$/s);
    if (m) {
      // keep surrounding spaces and punctuation outside the underline
      a.textContent = m[2];
      em.textContent = '';
      if (m[1]) em.appendChild(doc.createTextNode(m[1]));
      em.appendChild(a);
      if (m[3]) em.appendChild(doc.createTextNode(m[3]));
    } else {
      while (em.firstChild) a.appendChild(em.firstChild);
      em.appendChild(a);
    }
  }

  // 2. Plain text.
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || skip(parent) || parent.closest('i, em')) continue;
    const text = node.data;
    if (!/[A-Za-z]{3}/.test(text)) continue;
    const block = blockOf(node);
    // in a table, the row's label cell gives the context ("Feats:" | "Multiattack" | "Multiattack, Toughness")
    const row = block?.tagName === 'TD' ? (block.parentElement as HTMLTableRowElement | null) : null;
    const blockText = (row && row.cells[0] !== block ? `${row.cells[0]?.textContent || ''} ` : '') + (block?.textContent || '');
    const words = [...text.matchAll(WORD)].map((m) => ({ w: m[0], start: m.index!, end: m.index! + m[0].length }));
    const hits: { start: number; end: number; t: Target }[] = [];
    for (let i = 0; i < words.length; i++) {
      const cands = idx.byFirst.get(normWord(words[i].w));
      if (!cands) continue;
      for (const t of cands) {
        const n = t.words.length;
        if (i + n > words.length) continue;
        let ok = true;
        for (let k = 0; k < n && ok; k++) {
          if (normWord(words[i + k].w) !== t.words[k]) ok = false;
          // words of a name are separated by spaces (or a comma for "…, Mass") only
          else if (k > 0 && !/^[\s,]+$/.test(text.slice(words[i + k - 1].end, words[i + k].start))) ok = false;
        }
        if (!ok) continue;
        const start = words[i].start;
        const end = words[i + n - 1].end;
        // whole words only ("light" is not a name inside "low-light" or "lowlight")
        if (/[A-Za-z\u00AD-]$/.test(text.slice(0, start)) || /^[A-Za-z\u00AD]/.test(text.slice(end))) continue;
        const matched = words.slice(i, i + n).map((x) => x.w);
        if (!allowed(t, text, end, start, matched, blockText)) continue;
        if (isSelf(t, node)) break;
        const once = t.kind === 'condition' || t.kind === 'skill';
        if (once && onceDone.has(t.href)) break;
        if (block) {
          const seen = doneInBlock.get(block) || new Set<string>();
          if (seen.has(t.href)) break;
          seen.add(t.href);
          doneInBlock.set(block, seen);
        }
        if (once) onceDone.add(t.href);
        hits.push({ start, end, t });
        i += n - 1;
        break;
      }
    }
    if (!hits.length) continue;
    const frag = doc.createDocumentFragment();
    let pos = 0;
    for (const h of hits) {
      if (h.start > pos) frag.appendChild(doc.createTextNode(text.slice(pos, h.start)));
      frag.appendChild(makeLink(h.t, text.slice(h.start, h.end)));
      pos = h.end;
    }
    if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
    node.replaceWith(frag);
  }
  return root.innerHTML;
}

/** React hook: `html` with rules links added once the link index is ready (plain until then). */
export function useAutolinked(html: string, opts: AutolinkOptions = {}): string {
  const [idx, setIdx] = useState<LinkIndex | null>(null);
  useEffect(() => {
    let live = true;
    linkIndex()
      .then((i) => live && setIdx(i))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    if (!idx || !html) return html;
    try {
      return autolink(html, idx, opts);
    } catch {
      return html;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, idx, opts.selfHref, opts.selfTitle]);
}
