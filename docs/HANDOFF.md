# Handoff — 27 Nov 2026, 23:00 UTC

The owner (Dana) is handing work over temporarily to a team member. Read `CLAUDE.md` first (what the
app is, rules, architecture), then `docs/ROADMAP-2.0.md` (the 2.0 plan and decisions). This file says
exactly where work stopped and how to finish the step in progress.

## Ground rules (unchanged)

- Work on branch **`v2`**. No workflow builds it.
- **Ask the person you are working with before merging into `main`**: a push to `main` deploys the
  website and builds a TestFlight app. Doc-only commits to `main` use `[skip ci]`.
- The **books passphrase** and the **Google Drive folder link** come from the owner (in chat). Never
  write either into the repository (it is public), a commit message or a file that gets committed.
- Book PDFs, OCR output and the unencrypted `data-build/books.db` stay in `data-build/` (git-ignored).
  Only the encrypted `public/data/books/` is committed.

## What is live

- `main` = website run 25 + **TestFlight build 22** (2.0 steps 1–4: tap-to-link, dice, Ask quality test,
  cross-references, table answers, characters/spellbooks, lists, homebrew + skill house rules, file
  sharing, iCloud sync — confirmed working on the owner's iPhone and iPad).
- `v2` is ahead of `main` by: Ask fixes from the on-device quality report (yes/no answers, SRD fallback
  for misaligned book text, house rules off during the test), the iOS workflow's entitlement logging,
  and the step 2b extraction fixes below. None of it is deployed yet.

## ✔ Update, 28 Nov (later): pack 20261128T0013 replaces 20261127T2310

The team member's session compared every book's entries, kinds and tables with the pre-2b pack and found
regressions in 20261127T2310 that the totals hid: 21 Monster Manual II monsters (the first under each letter:
Abeil, Banshee… Yak Folk) filed as rules, class tables merged into one cell (CAdv Ninja levels 1–9, PHB Table
1–1), 4 CS prestige classes + CW Exotic Weapon Master + LEoF Glorious Servitor + PHB Permanent Image losing their
kinds, ELH Divine Emissary's headings and LEoF's staff descriptions swallowed into tables. Fixed in
`extract.py` (commits bd7f8a4, b7f9473) and re-packed. Against the pre-2b pack: entries 20,851 → 20,872, tables
2,305 → 2,424, no kind lost anything (class 62, prestige 268, spell 1,497, deity 148, trap 83; feat +5, item +10,
monster +2); the 7 entries no longer marked as feats/items/monsters were mis-filed or had another entry's text.
Ask quality (command line, search levels): **116/119** (20261127T2310: 115/119 on the same questions).


The owner's session completed the rebuild and committed it to `v2` ("Books: rebuilt pack…", version
20261127T2310). Verified: entry counts steady (20,851 → 20,855), the 6 PHB feats correct, FRCS/PoF/F&P tables
read as tables, Ask quality 115/116 (the one miss: "What is a longsword?" picks MM3's Thorn, whose heading
sits after its stat block). Two Ask excerpt fixes came with it (`highlight.ts`: a long run-in rule such as
"Concealment Miss Chance: …" counts as a lead sentence; the sentence right before the excerpt is kept when
it answers the question). **Nothing below needs doing.** `v2` was merged into `main` on 28 Nov with the user's OK (pack 20261128T0013,
book names in the book filter menus, responsive type scale). Next: step 5 of the plan.

## (Done) step 2b — tables in 10 books + 6 misaligned PHB feats

Goal (owed to the owner before 2.0 is finished): tables in FRCS, F&P, MoF, RoF, LEoF, PoF, GHotR, MotP,
MIC and MM2u were flattened into text by the first extraction, so Ask's table answers can't read them; and
6 PHB feats carried the wrong text.

**Done and committed on `v2` (commit 519b5a6):** `scripts/books/extract.py`
- `caption_table` / `is_caption_title`: tables under printed or bookmarked captions are rebuilt from word
  positions. Measured before → after (captioned tables read as tables): MoF 6 → 24 of 29, LEoF 16 → 23
  of 35, FRCS 28 → 34 of 53, PoF 6 → 10 of 12. GHotR and MM2u have no captioned tables.
- Reading order: a column needs ≥ 3 blocks (PHB p. 93's margin illustration caption made a fake third
  column). Bookmark placement: a heading line that starts with a short title matches it.
- Checked on the PHB: Combat Casting, Craft Rod, Craft Staff, Dodge, Run and Track now carry their own text.

**Also on `v2`:** a fix in `line_words` (extract.py) for OCR'd books, whose words have no box of their own
(the first full build crashed at Faiths & Pantheons with `KeyError: 'bbox'`). With it, the build runs
through the OCR'd books.

**Note:** at 23:00 UTC the owner's own session had finished the downloads and OCR and started the build
(step 4 below) in its container. If that session survives, it commits the rebuilt pack to `v2` itself
(commit message starting "Books: rebuilt pack"). **Check `git log origin/v2` first**; if that commit is
there, skip to step 5 (verify) — otherwise start from step 1.

**Not done — the remaining steps, in order:**

1. **Tools** (cloud container): `npm ci --onnxruntime-node-install-cuda=skip`,
   `apt-get install -y tesseract-ocr`,
   `pip install pymupdf onnxruntime==1.29.0 tokenizers==0.22.2 numpy==2.5.3`,
   `NODE_USE_ENV_PROXY=1 node scripts/fetch-models.mjs && node scripts/copy-ort.mjs`.
2. **PDFs:** ask the owner for the Drive folder link (shared "anyone with the link"). List it with the
   Google Drive connector (`parentId = '<folder id>'`), download each file with
   `curl -sSL --fail -o FILE "https://drive.usercontent.google.com/download?id=<file id>&export=download&confirm=t"`
   into the session scratchpad (30 files, ~730 MB). Link them into `data-build/pdfs/` under the names in
   `BOOKS` (`scripts/books/build_books.py`). Drive title → build name, where it isn't obvious:
   - `D&D3.5e - d20 - WOTC - Players Handbook.pdf` → `Players-Handbook.pdf` (not the "copy")
   - `DD3_DMG_Special_(29214005).pdf` → `DMG-Special-Edition.pdf` (322 pages; not "Dungeon Master's Guide I")
   - `D20 - WotC - D&D3.5 - Complete Warrior - v2.pdf` → `Complete-Warrior.pdf` (171 pages; not the 58 MB one)
   - `371539615-Power-of-Faerun.pdf` → `Power-of-Faerun.pdf`; `11850 - Manual of the Planes.pdf` →
     `Manual-of-the-Planes.pdf`; `D&D3e - Forgotten Realms - Race of Faerun.pdf` → `Races-of-Faerun.pdf`;
     `DnD 3.5-Magic-Item-Compendium.pdf` → `Magic-Item-Compendium.pdf`;
     `...Monster Manual II - 3.5 Update.pdf` → `MM2-35-Update.pdf`; the rest map by title.
   Check: all 27 names in `BOOKS` exist (a one-liner in the 27 Nov session did this).
3. **OCR** (about 5 minutes per book on 4 cores):
   `python3 scripts/books/ocr_pages.py data-build/pdfs/NAME.pdf data-build/pdfs/ocr/NAME.json --workers 4`
   for `Faiths-and-Pantheons`, `Races-of-Faerun`, `Manual-of-the-Planes`, and
   `... Magic-Item-Compendium.pdf data-build/pdfs/ocr/Magic-Item-Compendium.words.json` (words only).
4. **Build:** `BOOKS_PASSPHRASE='<from the owner>' python3 scripts/books/build_books.py data-build/pdfs`
   (re-extracts every book because `extract.py` changed, builds the Ask meaning index, packs and encrypts
   into `public/data/books/`). Expect most of an hour.
5. **Verify before committing:**
   - entry counts per book and kind vs the old pack: no book should lose many entries (the old pack is in
     git history: `git show HEAD~:public/data/books/manifest.json` gives its version; install both in two
     browser profiles, or query the old one before replacing it);
   - the PHB feats above; spot-check captioned tables in FRCS, MoF, LEoF, PoF in the app (`npm run dev`);
   - the Ask quality test: `BOOKS_PASS='<passphrase>' NODE_PATH=$(npm root -g) node scripts/ask/quality.cjs`
     with a fresh profile (delete `data-build/quality-profile` so it unlocks the new pack). Expect ≥ 113/114
     on the search levels. Add table questions from the FR books to `src/lib/ask/quality-questions.ts`
     (e.g. FRCS Table 1–1 Deity Conversion: Boccob → Azuth/Mystra/Savras/Velsharoon; PoF Table 3–1:
     Arachne → Lolth). The table index rebuilds itself (its key includes the books version).
6. **Commit** `public/data/books/` (encrypted) + notes to `v2`, then tell the person you're working with.
   When `v2` is next merged (with their OK), every device re-downloads the books once (~30 MB).

Known leftovers to note, not blockers: some captions still aren't read as tables (LEoF Table 1–1 Feats,
MoF prestige-class tables without numbers in the first column, PoF "Giving Orders" with dot leaders).

## After step 2b (the plan's next steps)

5. Ask follow-up questions, then "Explain this" on any entry. 6. iPad/Mac layout. 7. Forgotten Realms
tools (Calendar of Harptos, travel distances). 8. TestFlight invites for the group (as internal testers) +
first-run guide. Details in `docs/ROADMAP-2.0.md`.
