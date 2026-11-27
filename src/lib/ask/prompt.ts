// The prompt for written answers: the Ask search's exact answer (if any) and best passages,
// trimmed to the sentences around the match, plus instructions. Used by the native app's
// written answers (Apple's on-device model or a downloaded open model).
import { ask, namedIn, passageAt, type Passage } from './engine';
import { directAnswer, type Direct } from './direct';
import { highlight, keyTerms, termsIn, textOf } from './highlight';
import { query } from '../db';
import { catalog, nameKey } from '../catalog';

export const INSTRUCTIONS = [
  'You answer questions about the Dungeons & Dragons 3.5 rules and the Forgotten Realms, using only the sources you are given.',
  'Answer the question directly in your first sentence (start with Yes or No if it is a yes/no question).',
  'Then give the rule or fact that decides it, including any numbers, conditions or exceptions the sources state.',
  'Use only the sources that address the question and ignore the others. Do not add facts the question did not ask about.',
  'Write 2 to 4 plain sentences. Cite the source you used in brackets, like [PHB p. 57].',
  'If the sources do not answer the question, say so instead of guessing.',
].join(' ');

export interface BuiltPrompt {
  instructions: string;
  prompt: string; // sources + question
  sources: Passage[];
  searchMs: number;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Pick the passages worth giving the model: the same rule from the SRD and a book counts once
 * (the book's version, which has a page), and only passages that score close to the best one
 * are kept, so off-topic results (e.g. "Creating Magic Armor" for a spellcasting question)
 * don't leak into the answer.
 */
export function selectSources(q: string, passages: Passage[], max = 3, about?: string): Passage[] {
  const byTitle = new Map<string, Passage>();
  const order: string[] = [];
  // when the question is about one thing ("Who is Elminster?"), results merely titled after it
  // ("Elminster Enraged", a novel) are noise
  const subject = about ? norm(about) : '';
  for (const p of passages) {
    // the spell "Spell Resistance" and the rule "Spell Resistance" are different things
    const k = `${norm(p.title)}|${p.kind === 'rule' || p.kind === 'wiki' ? p.kind : 'entry'}`;
    const nt = norm(p.title);
    if (subject && nt !== subject && nt.startsWith(subject + ' ')) continue;
    const cur = byTitle.get(k);
    if (!cur) {
      byTitle.set(k, p);
      order.push(k);
    } else if (cur.label === 'SRD' && p.label !== 'SRD' && p.source === 'books') byTitle.set(k, p); // prefer the book's copy, keep the rank
  }
  const unique = order.map((k) => byTitle.get(k)!);
  if (!unique.length) return [];
  // Meaning similarity is the best relevance signal (word overlap can't tell "can wizards cast
  // in armor" from "creating magic armor"); fall back to fused rank + word overlap without it.
  const topSim = Math.max(...unique.map((p) => p.sim || 0));
  const rel = unique.map((p) => highlight(p.html, q, 360, p.title).score);
  const topScore = unique[0].score || 1;
  const topRel = Math.max(...rel, 0.0001);
  // An extra source must mention every key word of the question that the best source mentions:
  // "Can a wizard cast spells in armor?" keeps "Arcane Spells and Armor" (wizard, cast, spell,
  // armor) but drops "Creating Magic Armor" (no wizard), which a small model otherwise answers from.
  const terms = keyTerms(q);
  const excerptOf = (p: Passage) => textOf(highlight(p.html, q, 900, p.title).excerpt) + ' ' + p.title;
  const need = termsIn(excerptOf(unique[0]), terms);
  const keep = unique.filter((p, i) => {
    if (i === 0) return true;
    const has = termsIn(excerptOf(p), need);
    if (has.length < need.length) return false;
    if (topSim > 0 && p.sim) return p.sim >= topSim - 0.035; // bge scores bunch closely; 0.035 drops the clearly weaker ones
    return p.score >= topScore * 0.6 && rel[i] >= topRel * 0.5;
  });
  // drop passages whose text mostly repeats one already chosen ("Flat-Footed" vs "Conditions")
  const grams = (t: string) => {
    const w = textOf(t).toLowerCase().match(/[a-z0-9]+/g) || [];
    return new Set(w.slice(0, -2).map((x, i) => `${x} ${w[i + 1]} ${w[i + 2]}`));
  };
  const out: Passage[] = [];
  const seen: Set<string>[] = [];
  for (const p of keep) {
    const g = grams(highlight(p.html, q, 600, p.title).excerpt);
    const dup = seen.some((s) => {
      let n = 0;
      g.forEach((x) => s.has(x) && n++);
      return g.size > 0 && n / g.size > 0.5;
    });
    if (dup) continue;
    seen.push(g);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

// ------------------------------------------------------------------ cross-references

// "This spell functions like dispel magic, except…", "…as the invisibility spell…",
// "(see Arcane Spell Failure, page 122)": the deciding rule is in the section referred to.
const REF_PATTERNS: { rx: RegExp; always: boolean; spell?: boolean }[] = [
  { rx: /\bfunctions? (?:like|as) (?:the )?([a-z][a-z’' ,/-]{2,40}?)\s*(?=,|\.|;| except| but| spell\b)/gi, always: true, spell: true },
  // Complete Arcane & co.: "As resist energy, except that it affects all targeted creatures."
  { rx: /(?:^|[.:)]\s+)As ([a-z][a-z’' /-]{2,40}?)\s*,? except\b/gm, always: true, spell: true },
  { rx: /\bas (?:the |an? )?([a-z][a-z’' /-]{2,40}?) spell\b/gi, always: false, spell: true },
  { rx: /\(?\bsee (?:the )?([A-Z][A-Za-z’' -]{2,40}?)(?:,? (?:on )?(?:page|p\.) ?\d+)?(?=[).,;])/g, always: false },
];

/**
 * Sections the chosen sources refer to, as extra sources for the model. A "functions like X"
 * reference is always followed (the source is only the differences); a "see X" one only when X
 * shares two key words with the question.
 */
export async function crossReferences(q: string, sources: Passage[], max: number): Promise<{ ref: Passage; from: Passage }[]> {
  if (max <= 0) return [];
  const out: { ref: Passage; from: Passage }[] = [];
  const have = new Set(sources.map((p) => norm(p.title)));
  const terms = keyTerms(q);
  for (const from of sources) {
    const text = textOf(from.html);
    for (const { rx, always, spell } of REF_PATTERNS) {
      rx.lastIndex = 0;
      for (let m = rx.exec(text); m && out.length < max; m = rx.exec(text)) {
        const phrase = m[1].trim();
        // "functions like invisibility" in a spell means the spell, not the Invisibility rules section
        const sp = spell ? (await catalog('spell').catch(() => [])).find((it) => nameKey(it.title) === nameKey(phrase)) : undefined;
        const hit = sp
          ? { title: sp.title, href: sp.sources[0].href }
          : (await namedIn(phrase)).find((n) => norm(n.title) === norm(phrase) || norm(n.title).replace(/^(.+) (greater|lesser|mass)$/, '$2 $1') === norm(phrase));
        if (!hit || have.has(norm(hit.title)) || norm(hit.title) === norm(from.title)) continue;
        const key = hit.href.startsWith('#/srd/') ? `srdh:${hit.href}` : `bkh:${hit.href}`;
        const ref = await passageAt(hit.href, key).catch(() => null);
        if (!ref) continue;
        // a "see X" aside is followed only when X is about the question (two of its key words)
        if (!always && termsIn(textOf(ref.html) + ' ' + ref.title, terms).length < Math.min(2, terms.length)) continue;
        have.add(norm(hit.title));
        out.push({ ref, from });
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Build the prompt from results already found (no second search). */
export async function promptFrom(q: string, direct: Direct | null, passages: Passage[], nSources = 3, excerpt = 900, searchMs = 0): Promise<BuiltPrompt> {
  const sources = selectSources(q, passages, nSources, direct?.title);
  const lines: string[] = [];
  if (direct) {
    let text = textOf(direct.html);
    // a wiki direct answer is one sentence; give the model the article's whole summary
    if (direct.href.startsWith('#/wiki/')) {
      const rows = await query<{ summary: string }>('wiki', 'SELECT summary FROM articles WHERE title = ?', [direct.title]).catch(() => []);
      if (rows[0]?.summary) text = rows[0].summary.slice(0, excerpt);
    }
    lines.push(`[${direct.source}] ${direct.title}: ${text}`);
  }
  sources.forEach((p, i) => {
    // the best match gets the most room: it usually holds the deciding sentence
    const ex = textOf(highlight(p.html, q, i === 0 ? excerpt : Math.round(excerpt / 2), p.title, true).excerpt.replace(/<\/?mark>/g, ''));
    lines.push(`[${p.label}] ${p.title}: ${ex}`);
  });
  // sections the sources refer to (Apple's model: up to 2; the small open models: 1)
  const refs = await crossReferences(q, sources, nSources >= 3 ? 2 : 1).catch(() => []);
  for (const { ref, from } of refs) {
    const ex = textOf(highlight(ref.html, q, Math.round(excerpt / 2), ref.title, true).excerpt.replace(/<\/?mark>/g, ''));
    lines.push(`[${ref.label}] ${ref.title} (referred to by ${from.title}): ${ex}`);
  }
  return { instructions: INSTRUCTIONS, prompt: `Sources:\n${lines.join('\n\n')}\n\nQuestion: ${q}`, sources: [...sources, ...refs.map((r) => r.ref)], searchMs };
}

export async function buildPrompt(q: string, nSources = 3, excerpt = 900): Promise<BuiltPrompt> {
  const t0 = performance.now();
  const [direct, found] = await Promise.all([directAnswer(q).catch(() => null), ask(q, nSources + 2)]);
  return promptFrom(q, direct, found.passages, nSources, excerpt, Math.round(performance.now() - t0));
}

// For checking prompts in a browser console (no effect on the app).
if (typeof window !== 'undefined') (window as any).__buildPrompt = buildPrompt;
