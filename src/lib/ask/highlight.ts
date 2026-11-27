// Sentence highlighting: find the sentences in a passage that best answer the question
// (by the question's distinctive words), and build a short excerpt with them marked.

const STOP = new Set(
  'a an the of to in on at for by with from and or but is are was were be been being do does did can could should would will shall may might must have has had what which who whom whose where when why how that this these those it its i me my we you your they them their there here about into over under than then so if as not no yes any some all each every more most much many such only very also just rule rules work works happen happens mean means'.split(
    ' ',
  ),
);

export const textOf = (html: string) =>
  html
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();

/** The question without filler words, for keyword search ("can wizards cast in armor" → "wizards cast armor"). */
export const keywords = (q: string) =>
  (q.replace(/['’]s\b/g, '').replace(/['’]/g, '').match(/[\p{L}\p{N}+-]+/gu) || []).filter((w) => !STOP.has(w.toLowerCase()) && w.length > 1).join(' ');

const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9+]/g, '').replace(/(ing|ed|es|s)$/, '').slice(0, 6);

export function questionTerms(q: string) {
  return [...new Set(q.toLowerCase().match(/[a-z0-9+']+/g) || [])].filter((w) => !STOP.has(w) && w.length > 1).map(stem).filter(Boolean);
}

/** Split into sentences, keeping stat lines ("Range: …") as their own units. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/);
    for (const p of parts) if (p.trim()) out.push(p.trim());
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Highlight {
  excerpt: string; // HTML with <mark>
  score: number;
}

/** Excerpt of about `size` characters around the best-matching sentence(s), with them marked. */
export function highlight(html: string, q: string, size = 360, title = ''): Highlight {
  const text = textOf(html);
  const sents = sentences(text);
  const terms = questionTerms(q);
  // words of the entry's own name appear all through it, so they say little about which
  // sentence answers the question; a sentence that is only the name (a heading) never does
  const named = new Set(questionTerms(title));
  if (!sents.length) return { excerpt: '', score: 0 };
  const scoreOf = (s: string) => {
    const words = (s.toLowerCase().match(/[a-z0-9+']+/g) || []).map(stem);
    if (words.length < 3 || words.every((w) => named.has(w) || STOP.has(w))) return 0;
    const set = new Set(words);
    let sc = 0;
    for (const t of terms) if (set.has(t)) sc += (named.has(t) ? 0.35 : 1) * (1 + Math.min(t.length, 6) / 6);
    return sc / Math.sqrt(Math.max(6, words.length)); // prefer focused sentences over long ones
  };
  let best = 0;
  let bestScore = -1;
  sents.forEach((s, i) => {
    const sc = scoreOf(s);
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  });
  // mark the best sentence, and the next one if it scores nearly as well
  const marked = new Set([best]);
  if (best + 1 < sents.length && scoreOf(sents[best + 1]) >= bestScore * 0.8 && bestScore > 0) marked.add(best + 1);
  // grow the excerpt around the marked sentence(s)
  let lo = best;
  let hi = Math.max(...marked);
  let len = sents.slice(lo, hi + 1).join(' ').length;
  while (len < size && (lo > 0 || hi < sents.length - 1)) {
    if (hi < sents.length - 1 && (hi - best <= best - lo || lo === 0)) len += sents[++hi].length + 1;
    else if (lo > 0) len += sents[--lo].length + 1;
  }
  // marking the only sentence there is adds nothing
  const mark = bestScore > 0 && sents.length > 1;
  const parts = sents.slice(lo, hi + 1).map((s, k) => (marked.has(lo + k) && mark ? `<mark>${esc(s)}</mark>` : esc(s)));
  return { excerpt: (lo > 0 ? '… ' : '') + parts.join(' ') + (hi < sents.length - 1 ? ' …' : ''), score: bestScore };
}

/** Key words of a question, as 5-letter prefixes ("Becoming" and "become" both → "becom"). */
export const keyTerms = (q: string) =>
  [...new Set((q.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5)))];

/** Which of `terms` appear in a text (same 5-letter prefixes). */
export function termsIn(text: string, terms: string[]) {
  const have = new Set((text.toLowerCase().match(/[a-z0-9]+/g) || []).map((w) => w.slice(0, 5)));
  return terms.filter((t) => have.has(t));
}
