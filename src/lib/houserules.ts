// The group's skill house rules (decided 27 Nov 2026, docs/ROADMAP-2.0.md): five combined or
// renamed skills, drafted as homebrew entries from the SRD text of the skills they replace plus
// the group's decisions. The DM reviews and edits them, then shares them with the players.
import { loadDoc, loadEntries } from './srd';
import { createRecord, loadUserData } from './userdata';
import { allHomebrew, type HomebrewData } from './homebrew';

interface SkillRule {
  name: string;
  ability: string;
  replaces: string[];
  rules: string[]; // the group's decisions for this skill
  advantage: string[]; // feats and racial bonuses that now give advantage
}

export const SKILL_RULES: SkillRule[] = [
  {
    name: 'Acrobatics',
    ability: 'Dex',
    replaces: ['Balance', 'Escape Artist', 'Tumble'],
    rules: [
      'Anyone can use Acrobatics untrained, but tumbling past or through enemies still needs at least 1 rank (Tumble was trained only).',
      'The armor check penalty applies.',
    ],
    advantage: [
      'Agile (was +2 Balance and Escape Artist): advantage on Acrobatics.',
      'Acrobatic (was +2 Jump and Tumble): advantage when tumbling (and on Athletics when jumping).',
    ],
  },
  {
    name: 'Athletics',
    ability: 'Str',
    replaces: ['Climb', 'Jump', 'Swim'],
    rules: ['The armor check penalty applies; swimming still takes double the penalty, as Swim did.'],
    advantage: [
      'Athletic (was +2 Climb and Swim): advantage when climbing or swimming.',
      'Acrobatic (was +2 Jump and Tumble): advantage when jumping (and on Acrobatics when tumbling).',
      'Halflings (were +2 Climb and Jump): advantage when climbing or jumping.',
    ],
  },
  {
    name: 'Perception',
    ability: 'Wis',
    replaces: ['Spot', 'Listen'],
    rules: ['Perception is noticing things. Careful searching (traps, secret doors, clues) is Investigate.'],
    advantage: [
      'Alertness (was +2 Listen and Spot): advantage on Perception.',
      'Elves (were +2 Listen, Search and Spot) and half-elves (were +1): advantage on Perception (and on Investigate).',
      'Gnomes and halflings (were +2 Listen): advantage when listening.',
    ],
  },
  {
    name: 'Stealth',
    ability: 'Dex',
    replaces: ['Hide', 'Move Silently'],
    rules: ['The armor check penalty applies. Size modifiers to hiding (such as +4 for Small) stay as numbers.'],
    advantage: ['Stealthy (was +2 Hide and Move Silently): advantage on Stealth.', 'Halflings (were +2 Move Silently): advantage when moving silently, not when hiding.'],
  },
  {
    name: 'Investigate',
    ability: 'Int',
    replaces: ['Search'],
    rules: ['Search, renamed. Finding traps, secret doors and clues by careful searching; a rogue’s trapfinding uses Investigate.'],
    advantage: [
      'Investigator (was +2 Gather Information and Search): advantage when searching (Gather Information is unchanged).',
      'Elves and half-elves (were +2 / +1 Search): advantage on Investigate.',
      'Dwarves’ stonecunning (+2 Search for unusual stonework): advantage on those checks.',
    ],
  },
];

const GENERAL = [
  '**Class skills.** A combined skill is a class skill for a class if any of the skills it replaces was.',
  '**Advantage.** Roll 2d20 and use the higher. The feats and racial bonuses that gave a bonus on the old skills now give advantage instead of their bonus. A bonus that covered only part of a new skill gives advantage on that use only. Racial bonuses to a single old skill also become advantage; bonuses from items and spells stay numbers. Advantage doesn’t stack: two sources still mean one extra d20.',
  '**Monster stat blocks** keep their printed numbers. The new skill uses the higher of the old values (Stealth +8 for Hide +8, Move Silently +6). A monster’s racial bonus is already in its number; the house rule doesn’t recalculate it.',
  '**Synergies** between skills that are now one skill disappear (Tumble → Balance, Jump). Synergies to other skills carry over to the new name (Investigate → Survival when following tracks).',
  '**Printed text** keeps the old skill names. They mean the new skill: Hide or Move Silently → Stealth, Spot or Listen → Perception, Balance, Escape Artist or Tumble → Acrobatics, Climb, Jump or Swim → Athletics, Search → Investigate.',
];

/** Text of an SRD skill entry as paragraphs ("**Check:** …"), with tables as lines. */
async function srdSkillText(title: string): Promise<string> {
  const e = (await loadEntries()).find((x) => x.c === 'skill' && x.t === title);
  if (!e) return '';
  const doc = await loadDoc(e.d);
  const out: string[] = [];
  for (const b of doc.blocks.slice(e.s + 1, e.e)) {
    if (b.startsWith('<table')) {
      const rows = [...b.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => plain(c[1])).filter(Boolean).join(' — '));
      out.push(rows.filter(Boolean).map((r) => `- ${r}`).join('\n'));
    } else {
      const t = b.replace(/<(b|strong)>([\s\S]*?)<\/\1>/g, '**$2**');
      const p = plain(t);
      if (p) out.push(p);
    }
  }
  return out.join('\n\n');
}
const plain = (h: string) =>
  h
    .replace(/<sup>[\s\S]*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();

/** Which SRD classes have any of these skills as class skills. */
async function classesWith(skills: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const e of (await loadEntries()).filter((x) => x.c === 'class' || x.c === 'prestige')) {
    const doc = await loadDoc(e.d);
    const text = doc.blocks.slice(e.s, e.e).map(plain).join(' ');
    // the list ends at the first "(Ability)." — what follows (domains, skill points) is not part of it
    const m = text.match(/class skills \(and the key ability for each skill\) are (.+?\((?:Str|Dex|Con|Int|Wis|Cha|None)\))\./i);
    if (!m) continue;
    if (skills.some((s) => new RegExp(`\\b${s}\\b`, 'i').test(m[1]))) out.push(e.t);
  }
  return out;
}

/** Create the five skills and the summary as homebrew drafts (once). Returns how many were made. */
export async function createSkillHouseRules(): Promise<number> {
  await loadUserData();
  const have = new Set((await allHomebrew()).map((r) => r.name.toLowerCase()));
  let made = 0;
  for (const s of SKILL_RULES) {
    if (have.has(s.name.toLowerCase())) continue;
    const parts: string[] = [`House rule: ${s.name} replaces ${s.replaces.join(', ').replace(/, ([^,]+)$/, ' and $1')}.`, ...s.rules];
    parts.push(`### Advantage instead of bonuses\n\n${s.advantage.map((a) => `- ${a}`).join('\n')}`);
    for (const old of s.replaces) {
      const t = await srdSkillText(old);
      if (t) parts.push(`### From ${old} (SRD)\n\n${t}`);
    }
    const classes = await classesWith(s.replaces);
    const data: HomebrewData = {
      kind: 'skill',
      fields: [
        ['Key Ability', s.ability],
        ['Armor Check Penalty', 'Yes'],
        ['Replaces', s.replaces.join(', ')],
        ['Class Skill For', classes.join(', ')],
      ],
      text: parts.join('\n\n'),
      replaces: s.replaces,
      draft: true,
    };
    await createRecord('homebrew', s.name, data);
    made++;
  }
  if (!have.has('house rules: skills')) {
    const table = SKILL_RULES.map((s) => `- **${s.name}** (${s.ability}) replaces ${s.replaces.join(', ')}`).join('\n');
    await createRecord<HomebrewData>('homebrew', 'House rules: skills', { kind: 'rule', fields: [], text: `${table}\n\n${GENERAL.join('\n\n')}`, aliases: ['house rules', 'skill house rules'], draft: true });
    made++;
  }
  return made;
}

