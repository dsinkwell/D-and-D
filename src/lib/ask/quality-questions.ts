// The Ask quality test set: rules and Realms questions with known-correct answers.
// Run by src/lib/ask/quality.ts — in the app (About → Diagnostics → Ask quality test, which on
// the native app can include written answers) and from the command line
// (scripts/ask/quality.cjs, search levels only).
//
// Each question lists what a correct result must contain, written from the rules themselves:
//   direct   – the one-line exact answer must match
//   list     – the list answer must include (and not include) these names
//   sources  – one of these titles must be among the sources given to the writing model
//   prompt   – these must appear in the text the writing model is given (the deciding sentence)
//   answer   – the written answer must match all of these (only when answers are written)
// `needs` skips a question when that download isn't on the device.
// Patterns are case-insensitive regular expressions.

export interface QualityQuestion {
  id: string;
  q: string;
  topic: 'spell' | 'monster' | 'class' | 'combat' | 'condition' | 'skill' | 'feat' | 'equipment' | 'magic' | 'realms';
  needs?: ('books' | 'wiki')[];
  direct?: string;
  list?: { include: string[]; exclude?: string[] };
  sources?: string[];
  prompt?: string[];
  answer?: string[];
}

export const QUESTIONS: QualityQuestion[] = [
  // ---------------------------------------------------------------- exact one-line answers
  { id: 'fireball-range', q: 'range of fireball', topic: 'spell', direct: 'long \\(400 ft\\.? \\+ 40 ft\\.?/level\\)' },
  { id: 'fireball-school', q: 'what school is fireball', topic: 'spell', direct: 'evocation' },
  { id: 'haste-duration', q: 'duration of haste', topic: 'spell', direct: '1 round/level' },
  { id: 'wish-casting', q: 'casting time of wish', topic: 'spell', direct: '1 standard action' },
  { id: 'hold-person-save', q: 'saving throw for hold person', topic: 'spell', direct: 'will negates' },
  { id: 'magic-missile-components', q: 'components of magic missile', topic: 'spell', direct: '\\bV, S\\b' },
  { id: 'fireball-level', q: 'what level is fireball for wizards', topic: 'spell', direct: '\\b3\\b' },
  { id: 'owlbear-cr', q: 'challenge rating of an owlbear', topic: 'monster', direct: '\\b4\\b' },
  { id: 'barbarian-hd', q: 'hit die of a barbarian', topic: 'class', direct: 'd12' },
  { id: 'beholder-ac', q: 'armor class of a beholder', topic: 'monster', needs: ['books'], direct: '\\b26\\b' },
  { id: 'mystra-portfolio', q: "Mystra's portfolio", topic: 'realms', needs: ['books'], direct: 'magic' },
  { id: 'god-of-thieves', q: 'god of thieves', topic: 'realms', needs: ['books'], direct: '\\bmask\\b' },
  { id: 'cormyr-ruler', q: 'who rules Cormyr', topic: 'realms', needs: ['wiki'], direct: 'obarskyr' },

  // ---------------------------------------------------------------- list answers
  { id: 'cleric-3', q: 'level 3 cleric spells', topic: 'spell', list: { include: ['Prayer', 'Searing Light', 'Dispel Magic'], exclude: ['Fireball'] } },
  { id: 'undead-cr', q: 'undead CR 4 to 6', topic: 'monster', list: { include: ['Mummy', 'Wraith'], exclude: ['Lich', 'Zombie'] } },

  // ---------------------------------------------------------------- rules questions (written answers)
  {
    id: 'wizard-armor',
    q: 'Can a wizard cast spells in armor?',
    topic: 'magic',
    sources: ['Arcane Spell Failure', 'Arcane Spells and Armor'],
    prompt: ['spell failure'],
    answer: ['spell failure'],
  },
  {
    id: 'flat-footed',
    q: 'What does flat-footed mean?',
    topic: 'condition',
    sources: ['Flat-Footed'],
    prompt: ['dexterity bonus to ac'],
    answer: ['dex(terity)?'],
  },
  {
    id: 'grapple',
    q: 'How does grappling work?',
    topic: 'combat',
    sources: ['Grapple', 'Grappling'],
    prompt: ['grapple check'],
    answer: ['grapple check'],
  },
  {
    id: 'aoo-per-round',
    q: 'How many attacks of opportunity can I make per round?',
    topic: 'combat',
    sources: ['Attacks of Opportunity', 'Combat Reflexes'],
    prompt: ['one attack of opportunity per round|additional attacks of opportunity'],
    answer: ['\\b(one|1)\\b', 'combat reflexes'],
  },
  {
    id: 'falling',
    q: 'How much damage does falling do?',
    topic: 'combat',
    sources: ['Falling', 'Falling Damage', 'Falling Objects'],
    prompt: ['1d6 points of damage per 10 feet'],
    answer: ['1d6', '10 (feet|ft)'],
  },
  {
    id: 'zero-hp',
    q: 'What happens to a character at 0 hit points?',
    topic: 'condition',
    sources: ['Disabled', 'Disabled (0 Hit Points)', 'Injury and Death'],
    prompt: ['disabled'],
    answer: ['disabled'],
  },
  {
    id: 'minus-ten',
    q: 'What happens at -10 hit points?',
    topic: 'condition',
    sources: ['Dead', 'Dying', 'Injury and Death', 'Loss of Hit Points'],
    prompt: ['dead|dies'],
    answer: ['dead|die'],
  },
  {
    id: 'flanking',
    q: 'What bonus do you get for flanking?',
    topic: 'combat',
    sources: ['Flanking'],
    prompt: ['\\+2 flanking bonus|\\+2 bonus'],
    answer: ['\\+2'],
  },
  {
    id: 'take-10-combat',
    q: 'Can you take 10 on a skill check in combat?',
    topic: 'skill',
    sources: ['Taking 10', 'Checks without Rolls', 'Skill Checks'],
    prompt: ['threatened or distracted|threatened|distracted'],
    answer: ["\\bno\\b|cannot|can't|not"],
  },
  {
    id: 'stabilize-dc',
    q: 'What is the DC of the Heal check to stabilize a dying character?',
    topic: 'skill',
    sources: ['Heal', 'Dying', 'Injury and Death', 'Stable Characters and Recovery'],
    prompt: ['DC 15'],
    answer: ['\\b15\\b'],
  },
  {
    id: 'turn-undead',
    q: 'How does turning undead work?',
    topic: 'class',
    sources: ['Turn or Rebuke Undead', 'Turn Undead', 'Turning Undead', 'Turning Checks'],
    prompt: ['turning check|turning damage'],
    answer: ['turning'],
  },
  {
    id: 'power-attack',
    q: 'What does the Power Attack feat do?',
    topic: 'feat',
    sources: ['Power Attack'],
    prompt: ['subtract a number from all melee attack rolls'],
    answer: ['attack', 'damage'],
  },
  {
    id: 'cleave-prereq',
    q: 'What are the prerequisites for Cleave?',
    topic: 'feat',
    sources: ['Cleave'],
    prompt: ['str 13'],
    answer: ['str(ength)? 13', 'power attack'],
  },
  {
    id: 'spell-resistance',
    q: 'How does spell resistance work?',
    topic: 'magic',
    sources: ['Spell Resistance'],
    prompt: ['caster level check'],
    answer: ['caster level'],
  },
  {
    id: 'run-speed',
    q: 'How fast can a character run?',
    topic: 'combat',
    sources: ['Run', 'Running', 'Run (Full-Round Action)'],
    prompt: ['four times (your |its )?(normal )?speed|× ?4|\\bx ?4\\b'],
    answer: ['four times|×4|x4|4 times'],
  },
  {
    id: 'concealment',
    q: 'What is the miss chance for concealment?',
    topic: 'combat',
    sources: ['Concealment'],
    prompt: ['20%'],
    answer: ['20%'],
  },
  {
    id: 'stunned',
    q: 'What does the stunned condition do?',
    topic: 'condition',
    sources: ['Stunned'],
    prompt: ['drops everything held'],
    answer: ["can't take actions|cannot take actions|no actions|drops"],
  },
  {
    id: 'natural-20',
    q: 'Does a natural 20 always hit?',
    topic: 'combat',
    sources: ['Automatic Misses and Hits', 'Automatic Hits and Misses', 'Attack Roll', 'Attack'],
    prompt: ['natural 20'],
    answer: ['\\byes\\b|always'],
  },
  {
    id: 'two-weapon',
    q: 'What are the penalties for fighting with two weapons?',
    topic: 'combat',
    sources: ['Two-Weapon Fighting'],
    prompt: ['[–-]6'],
    answer: ['6'],
  },
  {
    id: 'dispel-magic',
    q: 'How does dispel magic work?',
    topic: 'spell',
    sources: ['Dispel Magic'],
    prompt: ['dispel check'],
    answer: ['dispel check|caster level'],
  },
  {
    id: 'sneak-attack-undead',
    q: 'Can a rogue sneak attack undead?',
    topic: 'class',
    sources: ['Sneak Attack', 'Rogue', 'Undead'],
    prompt: ['immune to (critical hits|sneak attacks?)|not subject to critical hits|critical hits'],
    answer: ["\\bno\\b|not|can't|cannot|immune"],
  },
  {
    id: 'longsword-cost',
    q: 'How much does a longsword cost?',
    topic: 'equipment',
    sources: ['Longsword', 'Weapons', 'Martial Weapons'],
    prompt: ['15 gp'],
    answer: ['15 gp'],
  },
  {
    id: 'spot-skill',
    q: 'What is the Spot skill used for?',
    topic: 'skill',
    sources: ['Spot'],
    prompt: ['notice'],
    answer: ['notice|see'],
  },

  // ---------------------------------------------------------------- Forgotten Realms (books)
  {
    id: 'shadow-weave',
    q: 'What does the Shadow Weave Magic feat do?',
    topic: 'realms',
    needs: ['books'],
    sources: ['Shadow Weave Magic'],
    prompt: ['enchantment, illusion'],
    answer: ['shadow weave', 'enchantment|illusion|necromancy'],
  },
  {
    id: 'spellfire',
    q: 'What does the Spellfire Wielder feat do?',
    topic: 'realms',
    needs: ['books'],
    sources: ['Spellfire Wielder'],
    prompt: ['spellfire'],
    answer: ['spellfire'],
  },
  {
    id: 'red-wizard',
    q: 'What are the requirements to become a Red Wizard?',
    topic: 'realms',
    needs: ['books'],
    sources: ['Red Wizard'],
    prompt: ['thay|tattoo|spell focus'],
    answer: ['thay|tattoo|spell focus'],
  },

  // ---------------------------------------------------------------- Forgotten Realms (wiki)
  {
    id: 'waterdeep',
    q: 'Where is Waterdeep?',
    topic: 'realms',
    needs: ['wiki'],
    sources: ['Waterdeep'],
    prompt: ['sword coast|the north'],
    answer: ['sword coast|the north'],
  },
  {
    id: 'elminster',
    q: 'Who is Elminster?',
    topic: 'realms',
    needs: ['wiki'],
    sources: ['Elminster', 'Elminster Aumar'],
    prompt: ['wizard|chosen of mystra|shadowdale'],
    answer: ['wizard|chosen|shadowdale'],
  },

  // ---------------------------------------------------------------- held-out set (27 Nov): written
  // after the engine was tuned on the questions above, and run once before any further change
  { id: 'bless-duration', q: 'duration of bless', topic: 'spell', direct: '1 min\\.?/level' },
  { id: 'beholder-cr', q: 'challenge rating of a beholder', topic: 'monster', needs: ['books'], direct: '\\b13\\b' },
  { id: 'goddess-magic', q: 'Who is the goddess of magic?', topic: 'realms', needs: ['books'], direct: 'mystra' },
  { id: 'wizard-1', q: 'level 1 wizard spells', topic: 'spell', list: { include: ['Magic Missile', 'Sleep', 'Mage Armor'], exclude: ['Fireball', 'Cure Light Wounds'] } },
  { id: 'dodge', q: 'What does the Dodge feat do?', topic: 'feat', sources: ['Dodge'], prompt: ['\\+1 dodge bonus'], answer: ['\\+1'] },
  { id: 'toughness', q: 'What does the Toughness feat give you?', topic: 'feat', sources: ['Toughness'], prompt: ['\\+3 hit points'], answer: ['\\+?3'] },
  { id: 'nauseated', q: 'What happens when a character is nauseated?', topic: 'condition', sources: ['Nauseated'], prompt: ['single move action'], answer: ['move action'] },
  { id: 'charge', q: 'How does charging work?', topic: 'combat', sources: ['Charge'], prompt: ['\\+2 bonus on the attack roll'], answer: ['\\+2', '[–-]2'] },
  { id: 'evasion', q: 'What does evasion do?', topic: 'class', sources: ['Evasion'], prompt: ['no damage'], answer: ['no damage'] },
  { id: 'cast-aoo', q: 'Does casting a spell provoke an attack of opportunity?', topic: 'magic', sources: ['Casting a Spell', 'Casting Spells', 'Attacks of Opportunity', 'Concentration', 'Casting Defensively'], prompt: ['provokes? attacks? of opportunity'], answer: ['\\byes\\b|provoke'] },
  { id: 'save-dc', q: 'How is the saving throw DC of a spell calculated?', topic: 'magic', sources: ['Saving Throw', 'Difficulty Class', 'Saving Throws'], prompt: ['10 \\+ (the )?(level of the spell|spell.s level|spell level)'], answer: ['10'] },
  { id: 'full-plate-cost', q: 'How much does full plate armor cost?', topic: 'equipment', sources: ['Full Plate', 'Armor', 'Armor and Shields'], prompt: ['1,500 gp'], answer: ['1,?500 gp'] },
  { id: 'longbow-range', q: 'What is the range increment of a longbow?', topic: 'equipment', sources: ['Longbow', 'Weapons', 'Bows'], prompt: ['100 ft'], answer: ['100 (ft|feet)'] },
  { id: 'hide-skill', q: 'What is the Hide skill used for?', topic: 'skill', sources: ['Hide'], prompt: ['unseen|unnoticed|sneak up'], answer: ['unseen|unnoticed|sneak|hide'] },
  { id: 'harper-scout', q: 'What are the requirements for the Harper Scout prestige class?', topic: 'realms', needs: ['books'], sources: ['Harper Scout'], prompt: ['harpers'], answer: ['harper'] },
  { id: 'improved-trip', q: 'What does Improved Trip do?', topic: 'feat', sources: ['Improved Trip'], prompt: ['attack of opportunity|free melee attack|immediately make a melee attack'], answer: ['attack'] },
  { id: 'aid-another', q: 'How does aid another work?', topic: 'combat', sources: ['Aid Another'], prompt: ['AC 10|DC 10'], answer: ['\\+2', '10'] },

  // ---------------------------------------------------------------- cross-references: the source
  // says "functions like X" / "see X", and the deciding rule is in X
  { id: 'greater-dispel', q: 'How does greater dispel magic work?', topic: 'spell', sources: ['Greater Dispel Magic', 'Dispel Magic, Greater'], prompt: ['\\+20', 'dispel check'], answer: ['20', 'dispel check|caster level'] },
  { id: 'greater-invisibility', q: 'What does greater invisibility do?', topic: 'spell', sources: ['Greater Invisibility', 'Invisibility, Greater'], prompt: ['attack', 'invisible'], answer: ['attack'] },
  { id: 'mass-bulls-strength', q: "What does mass bull's strength do?", topic: 'spell', sources: ["Mass Bull's Strength", "Bull's Strength, Mass"], prompt: ['\\+4 enhancement bonus to strength|enhancement bonus to strength'], answer: ['\\+4'] },
  { id: 'resist-energy-mass', q: 'How does mass resist energy work?', topic: 'spell', needs: ['books'], sources: ['Mass Resist Energy', 'Resist Energy, Mass'], prompt: ['resist energy', 'resistance (10|to energy)|energy resistance'], answer: ['resist'] },

  // ---------------------------------------------------------------- table lookups (src/lib/tables.ts):
  // written while building it, so they are regression checks, not a held-out measure
  { id: 'tbl-full-plate-asf', q: 'arcane spell failure of chain mail', topic: 'equipment', direct: '30%' },
  { id: 'tbl-longsword-damage', q: 'damage of a longsword', topic: 'equipment', direct: '1d8' },
  { id: 'tbl-greatsword-weight', q: 'how much does a greatsword weigh', topic: 'equipment', direct: '8 lb' },
  { id: 'tbl-composite-longbow', q: 'range increment of a composite longbow', topic: 'equipment', direct: '110 ft' },
  { id: 'tbl-masterwork', q: 'cost of a masterwork longsword', topic: 'equipment', direct: '315 gp' },
  { id: 'tbl-potion-clw', q: 'how much does a potion of cure light wounds cost', topic: 'magic', direct: '\\b50 gp' },
  { id: 'tbl-ring-protection', q: 'cost of a ring of protection +1', topic: 'magic', direct: '2,000 gp' },
  { id: 'tbl-horse', q: 'how much does a horse cost', topic: 'equipment', direct: '200 gp.*75 gp|75 gp.*200 gp' },
  { id: 'tbl-rapier-crit', q: 'critical range of a rapier', topic: 'equipment', direct: '18[–-]20' },
  // Forgotten Realms tables re-read in step 2b (FRCS Table 1–1 Deity Conversion; F&P prestige classes)
  { id: 'fr-deity-conversion', q: 'Which Forgotten Realms deity replaces Boccob?', topic: 'realms', needs: ['books'], prompt: ['Azuth'] },
  { id: 'fr-arachne-church', q: 'Which church does the arachne prestige class serve?', topic: 'realms', needs: ['books'], prompt: ['Lolth'] },
  { id: 'tbl-not-a-table', q: 'What is a longsword?', topic: 'equipment', sources: ['Longsword', 'Weapons', 'Weapon Descriptions', 'Martial Weapons'] },
];
