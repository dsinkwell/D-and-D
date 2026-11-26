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
  - Note: `src/main.tsx` still exposes `window.__realmsDb` as a TEMP test hook. Remove it before shipping.
- **Offline wiki:**
  - `scripts/build-wiki.mjs`: resumable and incremental. It lists all ns0 articles (62,442) and redirects (14,306), fetches `action=parse` HTML into `data-build/wiki-cache.db` (stores **raw** HTML, so cleaner changes apply without re-crawling), then exports `data-build/wiki.db` (articles + FTS5 contentless index + redirects + categories) and packs it into `public/data/wiki/`.
  - Run locally: `NODE_USE_ENV_PROXY=1 node scripts/build-wiki.mjs` (the proxy flag is only needed inside the Claude cloud container). Options: `--max-minutes N`, `--limit N`, `--concurrency 3`, `--export-only`. About 15 articles/s, so a full crawl takes about 70 minutes.
  - `scripts/lib/wikihtml.mjs` cleans Fandom HTML (drops images/galleries/navboxes, keeps infoboxes, tables, quotes and references, shortens footnote ids) and builds summaries.
  - Measured on 60 random articles: about 1.8 KB compressed HTML per article, so the full DB is about 240 MB and the download roughly 200 MB.
  - Client: `src/lib/wikiOffline.ts` (article/redirect lookup, FTS search, categories). `src/lib/wiki.ts` prefers the offline DB, then IndexedDB-saved pages, then the live API. The live API sends `access-control-allow-origin: *`, confirmed against the real wiki. `src/OfflineData.tsx` is the download/update card shown on the Realms page, the Search home and About.
  - Cross-links: wiki pages show matching "3.5 rules" SRD entries; SRD entries show "In the Realms" wiki links (`findWikiTitle`).
- **Books (NOT DONE: needs the user's PDFs):** plan below.
- Personal per-device PDF import (`src/views/LibraryViews.tsx`, pdf.js) still exists. Keep it as a secondary option.

## Where work stopped (updated)

- **Books: PDFs downloaded** from the user's Drive folder (29 files) into the session scratchpad (`…/scratchpad/books/`). They are NOT in the repo. A new session must re-download them: Drive connector for files under 10 MB, direct `drive.usercontent.google.com` download for larger ones (the user must temporarily share the folder by link; ask them).
- **Extraction pipeline:** `scripts/books/extract.py` (layout-aware: 1–3 column ordering, learned heading styles, small caps, running headers/side tabs/watermarks removed, tables), `scripts/books/build_books.py` (entries + kinds spell/feat/monster/prestige/class/deity/item, FTS, encrypted pack), and `scripts/books/ocr_pages.py` (Tesseract via PyMuPDF; needs `apt-get install tesseract-ocr`).
  - Scanned books are Faiths & Pantheons, Races of Faerûn and Manual of the Planes. They use OCR, with headings taken from PDF bookmarks. Manual of the Planes has no bookmarks, so it still needs a heading strategy.
- **App:** `src/lib/books.ts` and `src/views/BookViews.tsx` (unlock card, shelves, TOC, entry view with prev/next). Books are integrated into Search ("Rulebooks"), the Rules category lists ("From your rulebooks"), the new Deities tile, and SRD entries ("In your books").
- **Passphrase:** test builds used `test-only-passphrase`. The real one must come from the user, followed by a re-pack: `BOOKS_PASSPHRASE=… python3 scripts/books/build_books.py <books dir>`. Commit `public/data/books/` only when it's encrypted with the real passphrase.
- **Wiki:** the full crawl was running (about 25k / 62k). The cache is `data-build/wiki-cache.db` (not in git). CI (`.github/workflows/deploy.yml`) rebuilds and refreshes the wiki weekly with a cached DB.
- **Hosting:** needs a GitHub repo (the user is connecting GitHub via https://claude.ai/connect-github) and Pages source set to "GitHub Actions".

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
