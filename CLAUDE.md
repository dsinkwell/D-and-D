# Realms Codex — handoff notes for Claude

Read this first. It records what the user wants, what was decided, and exactly where work stopped.

## What the user wants (in their words, distilled)

A D&D 3.5 + Forgotten Realms reference usable on **Mac, iPad and iPhone**, containing:
1. **All the core books and the Forgotten Realms setting books, built into the app.** Not "import your own PDF on every device".
2. **The full Forgotten Realms Wiki (https://forgottenrealms.fandom.com) offline**, text only.
3. Easy to use, with minimal setup burden on them.

Decisions already made by the user (do not re-ask):
- **Web app (installable PWA) is fine** as long as the problems below are solved. Native app is not required.
- **PDFs come from their Google Drive.** They will provide them there. If the Drive connector fails, ask them to attach PDFs to a message.
- **Wiki offline: text only** (images load only when online).
- Audience: just them and their group (private use).

The user was frustrated by the first version (SRD only + per-device PDF import + live-only wiki). Be direct, don't over-ask, and show progress on what they actually asked for. Don't substitute synthetic or mock data for the real thing without saying so.

## Architecture (current)

- `src/`: React + Vite + vite-plugin-pwa app. Hash routes: `#/` search, `#/rules`, `#/srd/e/<doc>/<anchor>`, `#/wiki/<Title>`, `#/library`, `#/saved`, `#/about`.
- **SRD (built in, done):** `vendor/srd-md/` (OGL Markdown) → `scripts/build-srd.mjs` → `public/srd/*.json` (about 4,470 entries with spell/feat/monster/item metadata, MiniSearch index). Runs automatically on `npm run dev` / `npm run build`.
- **Offline database engine (done, tested in Chromium):** `src/workers/sqlite.worker.ts` (official `@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS) plus `src/lib/db.ts`. It installs packed DBs from `public/data/<name>/manifest.json` + `part-NNN.bin` (gzip parts, optional AES-GCM encryption with a PBKDF2 passphrase) produced by `scripts/lib/pack.mjs`. DB files are versioned in OPFS as `/<name>@<version>.db`.
- **Offline wiki:**
  - `scripts/build-wiki.mjs`: resumable and incremental. It lists all ns0 articles (62,442) and redirects (14,306), fetches `action=parse` HTML into `data-build/wiki-cache.db` (stores **raw** HTML, so cleaner changes apply without re-crawling), then exports `data-build/wiki.db` (articles + FTS5 contentless index + redirects + categories) and packs it into `public/data/wiki/`.
  - Run locally: `NODE_USE_ENV_PROXY=1 node scripts/build-wiki.mjs` (the proxy flag is only needed inside the Claude cloud container). Options: `--max-minutes N`, `--limit N`, `--concurrency 3`, `--export-only`. About 15 articles/s, so a full crawl takes about 70 minutes.
  - `scripts/lib/wikihtml.mjs` cleans Fandom HTML (drops images/galleries/navboxes, keeps infoboxes, tables, quotes and references, shortens footnote ids) and builds summaries.
  - Measured on 60 random articles: about 1.8 KB compressed HTML per article, so the full DB is about 240 MB and the download roughly 200 MB.
  - Client: `src/lib/wikiOffline.ts` (article/redirect lookup, FTS search, categories). `src/lib/wiki.ts` prefers the offline DB, then IndexedDB-saved pages, then the live API. The live API sends `access-control-allow-origin: *`, confirmed against the real wiki. `src/OfflineData.tsx` is the download/update card shown on the Realms page, the Search home and About.
  - Cross-links: wiki pages show matching "3.5 rules" SRD entries; SRD entries show "In the Realms" wiki links (`findWikiTitle`).
- **Books (done, encrypted, committed in `public/data/books/`):** see below.
- Personal per-device PDF import (`src/views/LibraryViews.tsx`, pdf.js) still exists. Keep it as a secondary option.

## Where work stopped (updated)

- **Books: PDFs downloaded** from the user's Drive folder (29 files) into the session scratchpad (`…/scratchpad/books/`). They are NOT in the repo. A new session must re-download them: Drive connector for files under 10 MB, direct `drive.usercontent.google.com` download for larger ones (the user must temporarily share the folder by link; ask them).
- **Extraction pipeline:** `scripts/books/extract.py` (layout-aware: 1–3 column ordering, learned heading styles, small caps, running headers/side tabs/watermarks removed, tables), `scripts/books/build_books.py` (entries + kinds spell/feat/monster/prestige/class/deity/item, FTS, encrypted pack), and `scripts/books/ocr_pages.py` (Tesseract via PyMuPDF; needs `apt-get install tesseract-ocr`).
  - Scanned books are Faiths & Pantheons, Races of Faerûn and Manual of the Planes. They use OCR, with headings taken from PDF bookmarks. Manual of the Planes has no bookmarks, so it still needs a heading strategy.
- **App:** `src/lib/books.ts` and `src/views/BookViews.tsx` (unlock card, shelves, TOC, entry view with prev/next). Books are integrated into Search ("Rulebooks"), the Rules category lists ("From your rulebooks"), the new Deities tile, and SRD entries ("In your books").
- **Passphrase:** the group passphrase was given to the user in chat; it is never committed. Re-pack: `BOOKS_PASSPHRASE=… python3 scripts/books/build_books.py <books dir>`.
- **Coverage audit:** `python3 scripts/books/audit.py [--only mic] [--show item]` compares stat-block markers in each book's text with the entries made. Extraction streams are cached in `data-build/streams/` (keyed by extract.py + PDF mtime), so changes to build_books.py re-run in about a minute.
- **Extraction fixes (Nov 26):** reading order no longer drops blocks under overlapping wide elements; column edges use the median; whitespace-only spans become spaces (MM2); spaces are rebuilt from glyph gaps (Shining South); per-book "lead fonts" act as bold; chapter level comes from PDF bookmarks; bold run-in names ("Amulet of Health:") and "Name [Tag]" paragraphs become their own entries (items, feats, traps, spells); prestige classes found via "To qualify to become…".
- **Structure from PDF outlines (Nov 26, round 2):** `full_outline` (extract.py) turns each PDF's bookmark outline into headings: wrappers dropped, only the longest forward-moving run of bookmarks kept (drops trailing table lists / stray bookmarks), stray chapter-level bookmarks demoted. `place_bookmarks` matches each bookmark to the line that prints it (heading-styled lines strongly preferred; unmatched ones tried on the next page). Font-size headings nest below the outline's deepest level. Books without a usable outline (MM4/5, MoP…) fall back to chapter bookmarks / page sections. `flatten_leaf_entries` stops a feat/spell/item from swallowing the next one.
- **Outline, round 3:** every bookmark is kept (out-of-order ones nest under the section they physically fall in; second copies in lists of tables/sidebars dropped via `_same_entry`); chapter bookmarks pointing past their first child are pulled back; a bookmark whose title is artwork stays at the top of its own page. Books with thin bookmarks use the printed contents (`printed_outline`: dot-leader lines, indent → level, 2–3 column pages, group headings, back-matter, printed→PDF page offset by voting); scanned books read only “Chapter N” lines from a 400-dpi re-OCR of the contents page (`printed_outline_scanned`, MoP), with page sections under each chapter. Entries carry `outline=1`; the app's contents view shows the full outline at every depth by default ("Book's contents" / "Chapters only" / "Every heading").
- **Text cleanup:** ligature splits rejoined with the vocabulary (`fix_ligatures`; vocab is built with ligature chars expanded); table-cell fragments on one row joined (`coalesce_rows`) so class tables render as tables; consecutive stat-line paragraphs merged; plain-text stat labels bolded one per line; column edge = 20th percentile of block x0s (3-column MIC pages).
- **Magic Item Compendium:** its PDF text layer is garbage. `ocr/Magic-Item-Compendium.words.json` (tesseract CLI, `ocr_pages.py … NAME.words.json`) supplies the words; the PDF supplies layout and fonts (`overlay_words` in extract.py).
- **Known weak spots:** the three scanned books (Races of Faerûn, Faiths & Pantheons, Manual of the Planes): OCR'd headings in decorative fonts are garbled, so their feats/spells stay inside larger sections.
- **App catalog:** `src/lib/catalog.ts` merges SRD + book entries per kind by name (`nameKey`), best source first (3.5 books, SRD, 3.0 books). Category lists, Rules tile counts, unified search (`searchRules`) and the "Also in" links on book entries use it.
- **Wiki:** the full crawl was running (about 25k / 62k). The cache is `data-build/wiki-cache.db` (not in git). CI (`.github/workflows/deploy.yml`) rebuilds and refreshes the wiki weekly with a cached DB.
- **CI wiki seed:** Fandom throttles GitHub runners (~250 articles, then ~15 min blocked), so CI cannot do a full crawl. The orphan branch `wiki-seed` holds a complete `wiki-cache.db` (split into parts); the workflow restores it when the Actions cache has fewer than 60,000 pages. Weekly runs then fetch only changed articles.
- **Hosting:** needs a GitHub repo (the user is connecting GitHub via https://claude.ai/connect-github) and Pages source set to "GitHub Actions".

## Ask box (natural-language questions, branch `ask-box`)

- **No server, no cost.** Everything runs on the device. `#/ask?q=` (`src/views/AskView.tsx`); a separate Ask box sits above the search box on the home screen.
- **Direct answers** (`src/lib/ask/direct.ts`): single-fact questions ("range of fireball", "who rules Cormyr", "Mystra's portfolio", "god of thieves") are parsed with patterns and answered from book/SRD stat lines or wiki info boxes (`pi-data-label`/`pi-data-value`; a country's head of state is the row after "Type"). List questions ("level 3 cleric spells", "undead CR 4 to 6") filter the catalog and link to the category view.
- **Passages** (`src/lib/ask/engine.ts` + `src/workers/ask.worker.ts`): meaning search with bge-small-en-v1.5 (int8 ONNX, 34 MB, transformers.js + onnxruntime-web WASM, single thread) over int8 vectors (1-bit signature prefilter, exact rerank), fused with keyword search (RRF). Without the model downloaded, Ask falls back to keyword search only.
- **Highlighting** (`src/lib/ask/highlight.ts`): best sentence(s) by question terms, entry-name words down-weighted.
- **Indexes:** SRD → `public/ask/srd-*.{json,i8}` (committed; `python3 scripts/ask/embed_srd.py`); books → `ask_passages`/`ask_vectors` tables inside the encrypted books.db (`build_books.py` → `add_ask_index`); wiki → same tables in wiki.db (`build-wiki.mjs` runs `scripts/ask/embed_wiki.py`; CI caches `data-build/ask-cache.db`). Python embedding: `scripts/lib/embed.py` (onnxruntime + tokenizers, CLS pooling, query prefix in the worker).
- **Model files:** `node scripts/fetch-models.mjs` (pinned commit + SHA-256 in `scripts/models.lock.json`) → `public/models/` (git-ignored); `scripts/copy-ort.mjs` → `public/ort/`. Both run in `prebuild`. The app hosts its own copies; the model is an opt-in 47 MB download into the `ask-models` cache (not precached). Vite aliases `onnxruntime-web` → `onnxruntime-web/wasm` (11 MB build, not the 23 MB WebGPU one).
- Measured (Chromium, laptop): model load ~1 s on first question; meaning search 25–60 ms; whole answer 50–170 ms; ~110k passages.
- **Lab (hidden test page, `#/lab`, not linked):** written answers by a small open LLM on the device's GPU. `src/views/LabView.tsx` + `src/workers/write.worker.ts`. Uses transformers.js **v4** (npm alias `tjs4`, self-contained browser build with WebGPU) copied with its ONNX Runtime files into `public/lab/` by `scripts/copy-lab.mjs` (git-ignored; prebuild). Model files come from Hugging Face at runtime (cached in `transformers-cache`). Models offered: Qwen2.5 0.5B, LFM2 700M, Qwen3 0.6B, LFM2 1.2B, Gemma 3 1B, Llama 3.2 1B (q4f16 when the GPU has shader-f16, else q4). The prompt = Ask's direct answer + top 4 passages (highlight excerpts) + instructions. "Run the 5-question speed test" and "Copy results" produce a report the user pastes back. `#/lab?device=wasm` forces the processor.
- Next: user runs #/lab on iPhone/iPad/Mac and sends results; if fast enough, add an optional "Write an answer" button to Ask (only on capable devices).

## Commands

```bash
npm install
npm run dev                  # http://localhost:5173
npm run build && npm run preview   # http://localhost:4173
npx tsc --noEmit -p .        # type-check
```

Playwright with Chromium is preinstalled in the cloud container: `NODE_PATH=$(npm root -g) node test.cjs`.

## Licensing constraints

- SRD: OGL 1.0a, so keep the legal-information chapter reachable (About links to it).
- Wiki text: CC BY-SA 3.0. Every article footer credits and links its source and history; keep that.
- Books: the user's own copies, for private group use only. Ship them encrypted and never in plain text.
