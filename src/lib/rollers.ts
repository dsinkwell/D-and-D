// Tap-to-roll: marks numbers in rules text that can be rolled, as
//   <span class="roll" role="button" tabindex="0" data-roll="1d20+9" data-label="Claw attack">+9</span>
// The dice tray (src/DiceTray.tsx) listens for taps on any .roll element.
//
// What counts:
//   dice            "1d6+5", "3d8+9 (22 hp)", "d20", "2d6 – 1", "d%"
//   attack bonuses  "Claw +9 melee", "+14/+9/+4 melee", "+7 ranged touch"  → d20 + bonus
//   saves           "Fort +9, Ref +5, Will +2"
//   initiative      "Init +1", the Initiative stat line
//   grapple         "Grp +14", "Base Attack/Grapple +5/+14" (the grapple number)
//   skills          "Spot +8", "Knowledge (arcana) +10" (a known skill name before the number)

const SKILLS = [
  'Appraise', 'Balance', 'Bluff', 'Climb', 'Concentration', 'Craft', 'Decipher Script', 'Diplomacy', 'Disable Device', 'Disguise',
  'Escape Artist', 'Forgery', 'Gather Information', 'Handle Animal', 'Heal', 'Hide', 'Intimidate', 'Jump', 'Knowledge', 'Listen',
  'Move Silently', 'Open Lock', 'Perform', 'Profession', 'Ride', 'Search', 'Sense Motive', 'Sleight of Hand', 'Spellcraft', 'Spot',
  'Survival', 'Swim', 'Tumble', 'Use Magic Device', 'Use Rope', 'Autohypnosis', 'Psicraft', 'Control Shape',
  // 3.0 skills still printed in older Forgotten Realms books
  'Intuit Direction', 'Wilderness Lore', 'Animal Empathy', 'Innuendo', 'Read Lips', 'Pick Pocket', 'Alchemy', 'Scry',
  // the group's house-rule skills
  'Acrobatics', 'Athletics', 'Perception', 'Stealth', 'Investigate',
];
const SKILL_RX = SKILLS.map((s) => s.replace(/ /g, '\\s+')).sort((a, b) => b.length - a.length).join('|');

const N = '[+−–-]\\s?\\d{1,2}'; // a signed modifier
const num = (s: string) => Number(s.replace(/[−–]/g, '-').replace(/\s/g, ''));
const ORD = ['', '2nd', '3rd', '4th', '5th', '6th'];
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

interface Hit {
  start: number;
  end: number;
  roll: string;
  label: string;
}

const PATTERNS: { rx: RegExp; hits: (m: RegExpExecArray, text: string, tail: string) => Hit[] }[] = [
  // attacks: "Claw +9 melee", "+14/+9 melee", "+7 ranged touch"
  {
    rx: new RegExp(`(${N})((?:\\s?\\/\\s?${N})*)\\s+(melee|ranged)\\b(\\s+touch)?`, 'g'),
    hits: (m, text, tail) => {
      const name = attackLabel(text.slice(0, m.index), text.slice(m.index + m[0].length) + tail);
      const kind = `${m[3]}${m[4] ? ' touch' : ''}`;
      const out: Hit[] = [];
      const group = m[1] + m[2];
      const rx = new RegExp(N, 'g');
      let k = 0;
      for (const b of group.matchAll(rx)) {
        const start = m.index + b.index!;
        out.push({ start, end: start + b[0].length, roll: `1d20${signed(num(b[0]))}`, label: `${name || kind} attack${k++ ? ` (${ORD[k] || `${k + 1}th`})` : ''}` });
      }
      return out;
    },
  },
  // attacks written "claw +12 (1d8+4)" / "2 claws +12 each (1d6+4)" (newer stat blocks)
  {
    rx: new RegExp(`(${N})((?:\\s?\\/\\s?${N})*)(\\s+each)?\\s+(?=\\(\\s*\\d{0,3}d\\d)`, 'g'),
    hits: (m, text, tail) => {
      const name = attackLabel(text.slice(0, m.index), text.slice(m.index + m[0].length) + tail);
      if (!name) return [];
      const out: Hit[] = [];
      let k = 0;
      for (const b of (m[1] + m[2]).matchAll(new RegExp(N, 'g'))) {
        const start = m.index + b.index!;
        out.push({ start, end: start + b[0].length, roll: `1d20${signed(num(b[0]))}`, label: `${name} attack${k++ ? ` (${ORD[k] || `${k + 1}th`})` : ''}` });
      }
      return out;
    },
  },
  // saves
  {
    rx: new RegExp(`\\b(Fort(?:itude)?|Ref(?:lex)?|Will)\\s+(${N})\\b`, 'g'),
    hits: (m) => {
      const start = m.index + m[0].length - m[2].length;
      const save = m[1].startsWith('Fort') ? 'Fortitude' : m[1].startsWith('Ref') ? 'Reflex' : 'Will';
      return [{ start, end: start + m[2].length, roll: `1d20${signed(num(m[2]))}`, label: `${save} save` }];
    },
  },
  // initiative and grapple written inline
  {
    rx: new RegExp(`\\b(Init(?:iative)?|Grp|Grapple)\\s+(${N})\\b`, 'g'),
    hits: (m) => {
      const start = m.index + m[0].length - m[2].length;
      return [{ start, end: start + m[2].length, roll: `1d20${signed(num(m[2]))}`, label: /^Init/.test(m[1]) ? 'Initiative' : 'Grapple' }];
    },
  },
  // skills
  {
    rx: new RegExp(`\\b(${SKILL_RX})(\\s*\\([^)]{1,30}\\))?\\s+(${N})\\b(?!\\s*(?:bonus|penalty|to|on|ft))`, 'g'),
    hits: (m) => {
      const start = m.index + m[0].length - m[3].length;
      return [{ start, end: start + m[3].length, roll: `1d20${signed(num(m[3]))}`, label: `${m[1].replace(/\s+/g, ' ')}${m[2] ? ` ${m[2].trim()}` : ''} check` }];
    },
  },
  // dice
  {
    rx: /(?<![\w/])(\d{0,3})d(\d{1,3}|%)(?:\s?([+−–-])\s?(\d{1,3})(?![\dd]))?(?![\w])/g,
    hits: (m, text, tail) => {
      const count = m[1] || '1';
      const expr = `${count}d${m[2] === '%' ? 100 : m[2]}${m[3] ? `${m[3] === '+' ? '+' : '-'}${m[4]}` : ''}`;
      if (Number(count) < 1 || Number(m[2]) < 2) return [];
      // damage right after an attack: "Claw +9 melee (1d6+5)"
      const before = text.slice(Math.max(0, m.index - 60), m.index);
      const atk = before.match(/[+−–-]\s?\d{1,2}(?:\s?\/\s?[+−–-]\s?\d{1,2})*(?:\s+(?:melee|ranged)(?:\s+touch)?)?(?:\s+each)?\s*\(\s*$/);
      let label = '';
      if (atk) {
        const after = text.slice(m.index + m[0].length) + tail;
        const name = attackLabel(before.slice(0, atk.index), `(${after}`);
        label = `${name || 'Attack'} damage`;
      }
      else if (/^\s*\(\s*\d+\s*hp\)/.test(text.slice(m.index + m[0].length))) label = 'Hit points';
      return [{ start: m.index, end: m.index + m[0].length, roll: expr, label }];
    },
  },
];

const GENERIC_ATTACK = /^(atk|full atk|attack|full attack|melee|ranged|base attack|or|and)$/i;

/** Name for an attack: the words before the bonus ("Claw"), or else the weapon named after the
 * damage in parentheses ("Atk +6 melee (1d6+4, hoof)" → "Hoof"). */
function attackLabel(before: string, after: string): string {
  const name = attackName(before.replace(/\b(?:Full\s+)?(?:Atk|Attack)\s*$/i, ''));
  if (name && !GENERIC_ATTACK.test(name)) return name.replace(/^(?:Melee|Ranged)\s+/i, '').replace(/^./, (c) => c.toUpperCase());
  const paren = after.match(/^\s*(?:touch\s*)?(?:each\s*)?\(([^)]{1,80})\)/);
  if (paren) {
    const last = paren[1].split(/,\s*/).pop()!.trim();
    if (/[a-z]{3}/i.test(last) && !/\d*d\d/.test(last) && last.length < 32) return last.charAt(0).toUpperCase() + last.slice(1);
  }
  return '';
}

/** The weapon or attack named just before a bonus: "2 claws +9" → "Claws", "Greatsword +12" → "Greatsword". */
function attackName(before: string): string {
  const m = before.match(/([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,2})\s*$/);
  if (!m) return '';
  let s = m[1].replace(/^(and|or|with|a|an|the)\s+/i, '').trim();
  if (/^(and|or|melee|ranged|touch)$/i.test(s)) return '';
  // only the last words that look like a weapon name, not the sentence before it
  s = s.split(/\s+(?:and|or)\s+/).pop()!;
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** Stat-line labels whose value is rolled on a d20 ("Initiative +1", "Base Attack/Grapple +5/+14"). */
function labelHits(label: string, text: string): Hit[] {
  if (/^Init(iative)?$/i.test(label)) {
    const m = text.match(new RegExp(`^\\s*(${N})`));
    if (m) return [{ start: m[0].length - m[1].length, end: m[0].length, roll: `1d20${signed(num(m[1]))}`, label: 'Initiative' }];
  }
  if (/grapple/i.test(label)) {
    const m = text.match(new RegExp(`^\\s*${N}\\s?\\/\\s?(${N})`)) || text.match(new RegExp(`^\\s*(${N})(?!\\s?\\/)`));
    if (m) return [{ start: m[0].length - m[1].length, end: m[0].length, roll: `1d20${signed(num(m[1]))}`, label: 'Grapple' }];
  }
  return [];
}

/** Adds roll markers to `root` (a parsed copy of the page's HTML), in place. */
export function addRollers(root: Element) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    if (!/\d/.test(text)) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('a, h1, h2, h3, h4, h5, h6, .lbl, .roll, button')) continue;
    const hits: Hit[] = [];
    // the value of a labelled stat line ("Initiative" | "+1")
    const stat = parent.closest('.stat');
    const lbl = stat?.querySelector('.lbl')?.textContent?.trim();
    const row = parent.closest('td')?.parentElement as HTMLTableRowElement | undefined;
    const rowLabel = row?.cells[0]?.textContent?.replace(/:\s*$/, '').trim();
    const statLabel = lbl || rowLabel;
    if (statLabel && node === firstText(stat || parent.closest('td')!)) hits.push(...labelHits(statLabel, text));
    // a skill link followed by its modifier: <a>Spot</a> +8
    const prev = node.previousSibling as Element | null;
    if (prev?.nodeType === 1 && prev.classList?.contains('rl-skill')) {
      const m = text.match(new RegExp(`^(\\s*\\([^)]{1,30}\\))?\\s+(${N})\\b`));
      if (m) hits.push({ start: m[0].length - m[2].length, end: m[0].length, roll: `1d20${signed(num(m[2]))}`, label: `${prev.textContent}${m[1] ? ` ${m[1].trim()}` : ''} check` });
    }
    for (const p of PATTERNS) {
      p.rx.lastIndex = 0;
      for (let m = p.rx.exec(text); m; m = p.rx.exec(text)) hits.push(...p.hits(m, text, tailOf(node)));
    }
    if (!hits.length) continue;
    // earliest first; drop overlaps
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const keep: Hit[] = [];
    for (const h of hits) if (!keep.length || h.start >= keep[keep.length - 1].end) keep.push(h);
    const frag = doc.createDocumentFragment();
    let pos = 0;
    for (const h of keep) {
      if (h.start > pos) frag.appendChild(doc.createTextNode(text.slice(pos, h.start)));
      const s = doc.createElement('span');
      s.className = 'roll';
      s.setAttribute('role', 'button');
      s.setAttribute('tabindex', '0');
      s.dataset.roll = h.roll;
      if (h.label) s.dataset.label = h.label;
      s.setAttribute('aria-label', `Roll ${h.roll}${h.label ? `, ${h.label}` : ''}`);
      s.textContent = text.slice(h.start, h.end);
      frag.appendChild(s);
      pos = h.end;
    }
    if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
    node.replaceWith(frag);
  }
}

function firstText(el: Element | null): Text | null {
  if (!el) return null;
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const p = (n as Text).parentElement;
    if (p?.closest('.lbl') || !(n as Text).data.trim()) continue;
    return n as Text;
  }
  return null;
}

/** `html` with roll markers added. */
export function withRollers(html: string): string {
  if (typeof DOMParser === 'undefined' || !html || !/\d/.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root')!;
  addRollers(root);
  return root.innerHTML;
}

/** The next ~120 characters of the paragraph after a text node (weapon names are often in italics). */
function tailOf(node: Text): string {
  const block = node.parentElement?.closest('p, li, td, .stat, div') || node.parentElement;
  if (!block) return '';
  const w = node.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  w.currentNode = node;
  let out = '';
  for (let n = w.nextNode(); n && out.length < 120; n = w.nextNode()) out += (n as Text).data;
  return out;
}
