// Follow-up questions: "what about lightning bolt?" after "What is the range of fireball?".
// The follow-up alone has no subject, so the search uses a question rebuilt from the previous
// one: its subject swapped ("What is the range of lightning bolt?") or added ("how long does it
// last" → "how long does fireball last"). The written answer also gets the earlier question
// and answer (prompt.ts). A follow-up that names its own subject is searched as written.
import { namedIn } from './engine';

export interface Turn {
  q: string;
  a?: string; // the written answer, when one was written on this device
}

const ABOUT = /^\s*(?:and\s+|ok(?:ay)?,?\s+|so\s+)?(?:what|how)\s+about\s+(?:a\s+|an\s+|the\s+)?(.+?)\s*\??\s*$/i;
const PRONOUN = /\b(it|its|it's|they|them|their|this|that|these|those|he|she|him|her|his)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plain = (t: string) => t.replace(/\s*\[[^\]]*\]\s*$/, '').replace(/^(.+?),\s*(greater|lesser|mass|improved)$/i, '$2 $1');

// a spell, feat, item or creature is what a question is about; "Range" or "Saving Throw" is what it asks
const SUBJECT_RANK: Record<string, number> = { spell: 0, feat: 0, item: 0, monster: 0, class: 1, prestige: 1, deity: 1, power: 1, trap: 1, skill: 2, condition: 2, rule: 3 };

/** The thing the previous question asked about: an entry it names, else its last proper name. */
async function subjectOf(q: string): Promise<string | null> {
  const names = (await namedIn(q).catch(() => [])).sort((a, b) => (SUBJECT_RANK[a.kind] ?? 2) - (SUBJECT_RANK[b.kind] ?? 2));
  for (const n of names) {
    const t = plain(n.title);
    if (new RegExp(`\\b${esc(t)}\\b`, 'i').test(q)) return t;
  }
  if (names[0]) return plain(names[0].title);
  // a proper name not at the start: "Who rules Cormyr?", "What is Mystra's portfolio?"
  const words = q.replace(/[’']s\b/g, '').match(/[A-Z][\w’'-]*(?:\s+(?:of\s+the\s+|of\s+|the\s+)?[A-Z][\w’'-]*)*/g) || [];
  const proper = words.filter((w, i) => !(i === 0 && q.trim().startsWith(w) && !/\s/.test(w)) && !/^(What|Who|How|Can|Does|Is|Are|Where|When|Why|Which|Do|I|A|An|The)$/.test(w));
  return proper.length ? proper[proper.length - 1] : null;
}

/** Does the follow-up name a subject of its own? Then it stands alone. */
async function hasOwnSubject(q: string): Promise<boolean> {
  if (ABOUT.test(q) || PRONOUN.test(q) || LEAD.test(q)) return false;
  const names = await namedIn(q).catch(() => []);
  // only general rules named ("saving throw", "range") in a short question: it asks about the earlier subject
  if (names.length && names.every((n) => (SUBJECT_RANK[n.kind] ?? 2) >= 2) && q.split(/\s+/).length <= 5) return false;
  return names.length > 0;
}

const LEAD = /^\s*(and|also|or|but|plus|then)\b/i;

/** The question to search for: the follow-up rebuilt with the previous question's subject. */
export async function followUpQuery(prev: string, q: string): Promise<string> {
  const text = q.trim();
  if (await hasOwnSubject(text)) return text;
  const subject = await subjectOf(prev);
  const about = text.match(ABOUT);
  if (about) {
    const x = about[1];
    // swap the previous question's subject for the new one
    if (subject) {
      const re = new RegExp(`\\b${esc(subject)}(?:[’']s)?\\b`, 'i');
      if (re.test(prev)) return prev.replace(re, (m) => (/[’']s$/.test(m) ? `${x}'s` : x));
    }
    return `${prev.replace(/\?\s*$/, '')} ${x}`;
  }
  if (subject) {
    // "how long does it last" → "how long does fireball last"
    if (PRONOUN.test(text)) return text.replace(PRONOUN, (p) => (/^(its|their|his|her)$/i.test(p) ? `${subject}'s` : subject));
    // "and the saving throw?" → "saving throw of fireball"
    const core = text.replace(LEAD, '').replace(/^\s*(the|a|an|its)\s+/i, '').replace(/\?\s*$/, '').trim();
    if (core.split(/\s+/).length <= 4) return `${core} of ${subject}`;
    return `${text.replace(/\?\s*$/, '')} (${subject})`;
  }
  return `${prev.replace(/\?\s*$/, '')} ${text}`;
}

/** Earlier turns for the written answer's prompt: the questions, with answers when known. */
export function historyText(turns: Turn[]): string {
  if (!turns.length) return '';
  const lines = turns.slice(-2).map((t) => `Q: ${t.q}${t.a ? `\nA: ${t.a.slice(0, 600)}` : ''}`);
  return `Earlier in this conversation:\n${lines.join('\n')}\n\n`;
}

// Written answers of this session, so a follow-up's prompt can include them.
const written = new Map<string, string>();
export const rememberWritten = (q: string, a: string) => written.set(q.trim(), a);
export const writtenFor = (q: string) => written.get(q.trim());
