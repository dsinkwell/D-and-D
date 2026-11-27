# FR Reference 2.0 — brainstorm (27 Nov 2026)

Status: **plan agreed (27 Nov 2026); work started on branch `v2`.** Version 1.0 is described in
`CLAUDE.md` and marked by the `release-1.0` branch. Still ask the user before merging into `main`
(that deploys the website and builds a TestFlight app) and before any other build or deploy.
The original brainstorm is kept below the decisions.

## Decisions (27 Nov 2026)

**The user's answers**
1. Used by both DM and players, mainly **at the table**.
2. Devices: **Mac, iPad and iPhones**.
3. **Everyone in the group has their own copy** (own TestFlight install, own data, own iCloud).
4. No pain points with 1.0 yet.

**Picked for 2.0, in this order**
1. Tap-to-link rules text; tap-to-roll dice (the dice tray includes **Advantage**: 2d20, keep the higher).
2. Ask quality test set, then cross-reference following.
   - **2b. MUST COME BACK TO (user asked, 27 Nov): table extraction for the 10 books whose tables are
     flattened into text** (FRCS, F&P, MoF, RoF, LEoF, PoF, GHotR, MotP, MIC, MM2u). Needs the PDFs from the
     user's Drive (ask them to share the folder by link), table detection in `scripts/books/extract.py`, and a
     re-pack with the passphrase. Then re-run the Ask quality test and add table questions from those books.
     Do this before 2.0 is called finished.
3. Character spellbooks / lists (**per character, with spells-per-day tracking**) and homebrew
   entries, on one shared saved-data format. Sharing by **file** (option A below).
4. iCloud sync across each person's own devices (native app only; the web app keeps data per device).
5. Follow-up questions, then "Explain this" on any entry.
6. iPad/Mac layout (stays sixth).
7. Forgotten Realms tools (Calendar of Harptos, travel distances).
8. TestFlight invite for the group (as **internal testers**, no Beta App Review) + first-run guide.

**Progress (branch `v2`, not yet merged to `main`)**
- Done: tap-to-link (`src/lib/autolink.ts`; audited on all 27 books), tap-to-roll dice
  (`src/lib/rollers.ts`, `src/lib/dice.ts`, `src/DiceTray.tsx`; compact result bar, Adv./Dis. for the next d20).
- Done: Ask quality test set (`src/lib/ask/quality-questions.ts`, runner `src/lib/ask/quality.ts`; About →
  Ask quality test in the app, which can also check written answers; `scripts/ask/quality.cjs` from the
  command line). 59 questions, 17 of them held out (written after tuning). Search levels: 52/66 at the
  start → 93/96. Held-out set before fixes: 21/30. Known gap: weapon/armor table lookups (cost of full
  plate, longbow range increment) need a table-aware direct answer.
- Done: cross-reference following (`crossReferences` in `src/lib/ask/prompt.ts`): "functions like X" /
  "As X, except" (always, looked up as a spell) and "see X" (only when X shares two key words with the
  question) add X as an extra source (Apple: up to 2, open models: 1). 4 cross-reference questions added;
  whole set 101/104 on search levels.
- Done: table answers (`src/lib/tables.ts`, used by `directAnswer` as a fallback): every table in the SRD and
  the books (2,983 tables, 24,868 rows) indexed by row name × column heading, built once per device and kept
  in IndexedDB (rebuilt when the books change). Handles name columns that aren't first (d% tables), merged
  headings, "Horse, heavy/light", "composite longbow", masterwork (+300 gp weapon / +150 gp armor), Medium
  columns, roll-range misalignment; random-roll tables rank last. Quality test 113/114 (the failure: "What
  is a longsword?" — weapon descriptions are not separate entries).
- Done (step 3a): characters with spellbooks (`src/lib/characters.ts`, `src/views/CharacterViews.tsx`, Saved →
  Characters, `#/characters`, `#/character/<id>`): spells per day from the SRD class tables
  (`scripts/build-spellcasting.mjs` → `public/srd/spellcasting.json`, checked against the PHB) + bonus spells
  from the key ability, cleric domain slots, "Other" classes with typed-in slots, several classes per character;
  wizard spellbook, prepared slots with "cast" ticks, spontaneous casters' slot dots and spells known;
  "New day"; "Add to a character…" on every spell page. Stored in the new user-data store (`src/lib/userdata.ts`,
  IndexedDB `rc-user`: id, type, updated, tombstones, origin — ready for sharing files and iCloud sync).
- Done (step 3b–d): lists (`src/views/ListViews.tsx`, "Add to a list…" on every page, quantities and notes);
  homebrew entries (`src/lib/homebrew.ts`, `src/views/HomebrewViews.tsx`: any kind, stat lines + text, aliases,
  "Replaces"), merged into the catalog, search, tap-to-link, spellbooks and Ask (house rules marked as overriding
  the printed rules); house-rules switch ("Show rules as written"); "House rule: replaced by X" banner on the
  printed entries; the five skills drafted from the SRD + the decisions (`src/lib/houserules.ts`, class-skill
  lists computed from the SRD classes), marked Draft until the DM saves them.
- Done (step 3e): sharing by file (`src/lib/share.ts`): "Share" on characters, lists and homebrew, "Share all
  homebrew & house rules"; `.frref.json` through the share sheet (or a download); Saved → Import adds new
  records and asks Replace / Keep both / Skip for ones already there (matched by id or origin). Records from
  someone else are marked imported (homebrew read-only, "from Dana"). Tested DM → player → updated rules.
  Not yet: opening a .frref.json straight from AirDrop/Files into the native app (needs a document type in
  Info.plist + handling the open-URL event); the share sheet inside the native app is untested.
- **Open (needs the PDFs again):** 10 books have their tables flattened into text by the extraction
  (FRCS, F&P, MoF, RoF, LEoF, PoF, GHotR, MotP, MIC, MM2u), so they have no readable tables yet.
- Also fixed: the SRD skill list missed Appraise–Handle Animal (`scripts/build-srd.mjs`).
- Testing books locally: unlock them in a Playwright profile with the passphrase from the user (never commit it).

**Sharing homebrew with the group: option A, files.** Share → AirDrop/Messages/Mail; opening the file
imports it (web app: share sheet or download, then "Import file…"). Re-importing an entry offers
replace / keep both / skip. Lists and spellbooks share the same way. A live shared iCloud collection
(option C) stays a later option. The **house rules file is owned by the user (DM)**: players import
it but don't edit it. House rules are one set, switchable off ("Show rules as written").

**House rules: skills**

| New skill | Replaces | Key ability |
|---|---|---|
| Acrobatics | Balance, Escape Artist, Tumble | Dex |
| Athletics | Climb, Jump, Swim | Str |
| Perception | Spot, Listen | Wis |
| Stealth | Hide, Move Silently | Dex |
| Investigate | Search (renamed) | Int |

- Class skills: a combined skill is a class skill if any skill it replaces was (all classes and prestige classes).
- Feats and racial bonuses on the old skills (Alertness, Stealthy, Athletic, Agile, Acrobatic, racial
  bonuses such as the elf's Listen/Search/Spot) **grant advantage** instead of their bonus.
  - A bonus covering only part of a new skill gives advantage on that use only (halfling Move
    Silently → advantage when moving silently, not when hiding).
  - Racial bonuses to a single old skill also become advantage; item and spell bonuses stay numbers.
  - Monster stat blocks keep their printed numbers, with a note "House rule: racial bonus → advantage".
- Monster stat blocks: the new skill shows the higher old value, originals in small print
  ("Stealth +8 (Hide +8, Move Silently +6)").
- Acrobatics is usable untrained; tumbling past enemies needs at least 1 rank.
- All combined skills keep the armor check penalty; swimming still takes double.
- Synergies inside one new skill disappear; synergies to other skills carry over (Investigate → Survival for tracking).
- Perception notices; Investigate is careful searching (traps, secret doors, clues; trapfinding uses Investigate).
- **Not doing:** rewriting every mention of the old skills in the book text. Search aliases
  ("Hide" finds Stealth) and the five new skill entries (drafted from the SRD, reviewed by the user) are in.

---

# Original brainstorm

Sizes are rough: small (hours), medium (a day or two), large (several days).

## 1. At the table (likely the biggest gains in daily use)
- **Tap-to-link rules text** — spell, feat, condition and skill names inside any entry become links ("…as the *dispel magic* spell", "…is **flat-footed**"), so the books become a web you can follow. *Medium.*
- **Tap-to-roll dice** — tap "1d6+2", "+12 melee" or "3d8+9 hp" in a stat block to roll it; a small dice tray with history. *Small–medium.*
- **Encounter + initiative tracker** — add monsters from the catalog, roll initiative, track HP and conditions, show the encounter level (EL) from their CRs; conditions link to their rules. *Medium–large.*
- **Character spellbooks / lists** — named lists ("Elandra's prepared spells", "Party loot") beyond bookmarks, with quick filters and spells-per-day counters. *Medium.*
- **Quick-reference cards** — actions in combat, attacks of opportunity, grapple flowchart, turning undead: one-screen cheat sheets. *Small.*
- **Forgotten Realms tools** — Calendar of Harptos date converter and holidays; travel distances between places in Faerûn. *Small–medium.*

## 2. Ask and written answers
- **Follow-up questions** — "what about with a mithral chain shirt?" after the armor answer; Apple's model handles short conversations well. *Medium.*
- **Follow cross-references** — when a source says "see Arcane Spell Failure, page 122", fetch that section too (fixes the armor-style gaps at the root). *Medium.*
- **A quality test set** — 30–50 rules questions with known-correct answers, run automatically, so every prompt change is measured rather than judged by eye. *Small–medium; makes everything else in this section safer.*
- **"Explain this"** on any entry — a plain-English summary of a dense stat block or rule. *Small once follow-ups exist.*
- **DM helpers** — generate an NPC, tavern or rumour grounded in wiki lore, clearly labelled as invented. *Small–medium.*
- **Voice questions** — speak a question at the table. *Small in the app.*

## 3. Your group and your devices
- **Sync across your devices** — saved items, Jump to, lists and settings follow you between iPhone, iPad and Mac (the app can use iCloud: free, no server). *Medium.*
- **Sharing with the group** — send a list, encounter or note as a link/file that opens in their copy. *Medium.*
- **Homebrew entries** — add your own spells, items or house rules, searchable alongside the books. *Medium.*
- **TestFlight rollout** — invite the group, plus a short first-run guide (passphrase, downloads, writing model). *Small.*

## 4. Platform polish
- **iPad/Mac layout** — list on the left, entry on the right; keyboard shortcuts (⌘K to search); Mac-friendly menus. *Medium.*
- **iPhone integrations** — Spotlight search for spells, a home-screen widget (spell of the day, or your pinned list), Siri Shortcuts ("Ask FR Reference…"). *Medium.*
- **Optional built-in data** — ship the books and wiki inside the app (no first-run downloads, ~300 MB larger app). *Small–medium; a trade-off to decide.*
- **Accessibility** — larger text sizes and VoiceOver labels throughout. *Small–medium.*

## 5. Content quality
- **Fix the three scanned books** (Races of Faerûn, Faiths & Pantheons, Manual of the Planes) so their feats/spells become their own entries. *Medium; needs the PDFs again.*
- **More books** — if the user has more supplements, they drop into the same pipeline. *Small per book.*
- **Wiki images** — optional offline maps and portraits (selected, not all). *Medium; adds storage.*
- **Random tables you can roll on** — treasure, encounters, wild magic, etc. *Medium.*

## Questions for the user (to sharpen the plan)
1. Who mainly uses it, and when? DM, player, or both — at the table or during prep?
2. Which devices come out at the table, for the user and for the group?
3. Should the group have their own copies (affects sharing/sync), or is it mainly the user's tool?
4. Any pain points from using 1.0 so far?

## Suggested starting set
Tap-to-link rules text, tap-to-roll dice, the Ask quality test set + cross-reference following,
and iCloud sync across the user's devices: noticeably better at the table and more trustworthy
written answers, without anything large or risky.
