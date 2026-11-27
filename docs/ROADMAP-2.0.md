# FR Reference 2.0 — brainstorm (27 Nov 2026)

Status: **ideas only.** The user wants to brainstorm first. Make no changes, commits or builds
for 2.0 until the user approves each action. Version 1.0 is described in `CLAUDE.md` and marked
by the `release-1.0` branch.

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
