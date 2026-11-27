# Realms Codex — handoff notes for Claude

Read this first. It records what the user wants, what was decided, and exactly where work stopped.

## What the user wants (in their words, distilled)

A D&D 3.5 + Forgotten Realms reference usable on **Mac, iPad and iPhone**, containing:
1. **All the core books and the Forgotten Realms setting books, built into the app.** Not "import your own PDF on every device".
2. **The full Forgotten Realms Wiki (https://forgottenrealms.fandom.com) offline**, text only.
3. Easy to use, with minimal setup burden on them.

Decisions already made by the user (do not re-ask):
- **Web app (installable PWA) is fine** as long as the problems below are solved. (On 27 Nov the user chose to add a native app as well, for on-device written answers; both exist and share one codebase.)
- **PDFs come from their Google Drive.** They will provide them there. If the Drive connector fails, ask them to attach PDFs to a message.
- **Wiki offline: text only** (images load only when online).
- Audience: just them and their group (private use).

The user was frustrated by the first version (SRD only + per-device PDF import + live-only wiki). Be direct, don't over-ask, and show progress on what they actually asked for. Don't substitute synthetic or mock data for the real thing without saying so.

## ★ Version 1.0 — locked in on 27 Nov 2026 (branch `release-1.0`)

The user declared this the 1.0 version. If you are resuming, start here. The branch `release-1.0` marks the exact 1.0 commit (this session could not create git tags or GitHub releases: 403); to restore 1.0, check out that branch. Keep developing on `main`.

**What is live**
- **Web app (PWA):** https://dsinkwell.github.io/D-and-D/ — repo `dsinkwell/D-and-D` (public), branch `main`, deployed by `.github/workflows/deploy.yml` on every push to `main` and weekly (Mondays) with a wiki refresh. Home-screen name "FR Reference", page title "3.5 Forgotten Realms Reference".
- **Native app "FR Reference"** (iPhone/iPad; Apple-silicon Macs as an iPad app), TestFlight only: bundle ID `io.github.dsinkwell.frreference`, App Store Connect app ID 6839901379, version 1.0, **build 20** = v1.0. Built and uploaded by `.github/workflows/ios.yml` (pushes to `main` touching the app, monthly, or by hand). Secrets in the GitHub repo: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (Admin-role App Store Connect API key). Minimum iOS 16.4.
- Web and app share one codebase on `main` (the `ask-box`, `lab` and `native-app` branches are merged/obsolete).

**What 1.0 contains**
- **Rules:** the 3.5 SRD plus the user's 29 rulebooks (core + Forgotten Realms), extracted from their PDFs, encrypted (AES-GCM, group passphrase held by the user, never in the repo), merged into one catalog (spells, feats, monsters, items, prestige classes, deities, traps…) with filters, book contents at every outline depth, stat blocks formatted like the reference apps.
- **Offline Forgotten Realms Wiki:** all 62,443 articles, text only (~225 MB download), refreshed weekly by CI from a cached crawl (`wiki-seed` branch seeds the cache).
- **Ask box:** natural-language questions answered on the device: direct one-line answers (stat lines, wiki info boxes), list answers, meaning search (bge-small, bundled in the app / 47 MB opt-in on the web) fused with keyword search, highlighted sentences.
- **Written answers (native app only):** Apple Intelligence (Foundation Models) where available; otherwise an optional downloaded open model run with llama.cpp (Gemma 3 1B, 806 MB; Qwen 2.5 1.5B, 1.1 GB on 6 GB+ devices); otherwise the normal Ask. Written automatically when Ask is tapped (setting on About), with sources and "What the model was given".
- **Other:** offline after one download each (books, wiki), customizable "Jump to" buttons with pin buttons on pages, Saved/bookmarks, sharing, About → Diagnostics, gear button on phones, updates that never interrupt downloads, dark/light themes.

**Verified on the user's iPhone 18 Pro (iOS/Safari 27)**: web app and native app; books + wiki download in the app; meaning search; Write an answer with Apple Intelligence and with Gemma 3 1B / Qwen 2.5 1.5B.

**Known limits / open items (not done in 1.0)**
- Written answers by the small open models are weaker than Apple's (sources were tightened in build 17: duplicates merged, off-topic passages dropped, max 2 sources for open models); the user had not re-tested the armor question after build 17.
- Safari can't run written answers on iPhone (per-page memory limit) — by design they are app-only.
- Scanned books (Races of Faerûn, Faiths & Pantheons, Manual of the Planes): OCR'd headings are weak, so some feats/spells sit inside larger sections.
- Apple will require the iOS 27 SDK (Xcode 27) for uploads from April 2027; the workflow picks the newest non-beta Xcode on GitHub's runners automatically (only 26.x existed on 27 Nov 2026). Apple's ITMS-90725 warning emails until then are expected.
- TestFlight builds expire after 90 days; the monthly scheduled iOS build keeps a fresh one.
- Not yet done: inviting the user's group to TestFlight; checking the app on a Mac/iPad.
- Rebuilding the books needs the PDFs again (user's Google Drive folder; the session scratchpad copy is temporary) and the passphrase from the user.

## Architecture (current)

- `src/`: React + Vite + vite-plugin-pwa app. Hash routes: `#/` search, `#/ask?q=`, `#/rules`, `#/srd/e/<doc>/<anchor>`, `#/wiki/<Title>`, `#/library`, `#/saved`, `#/about`.
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

## Books pipeline and build history

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
- **Wiki:** complete (62,443 articles, 14,069 redirects; 225.5 MB download in 22 parts). The cache is `data-build/wiki-cache.db` (not in git). CI (`.github/workflows/deploy.yml`) refreshes the wiki weekly with a cached DB and rebuilds its meaning index (embedding cache kept between runs).
- **CI wiki seed:** Fandom throttles GitHub runners (~250 articles, then ~15 min blocked), so CI cannot do a full crawl. The orphan branch `wiki-seed` holds a complete `wiki-cache.db` (split into parts); the workflow restores it when the Actions cache has fewer than 60,000 pages. Weekly runs then fetch only changed articles.
- **Hosting:** GitHub Pages from Actions (repo `dsinkwell/D-and-D`). `github.io` is not reachable from the cloud container, so verify builds locally (`npm run build && npm run preview`) and by the Actions result.

## Ask box (natural-language questions)

- **No server, no cost.** Everything runs on the device. `#/ask?q=` (`src/views/AskView.tsx`); a separate Ask box sits above the search box on the home screen.
- **Direct answers** (`src/lib/ask/direct.ts`): single-fact questions ("range of fireball", "who rules Cormyr", "Mystra's portfolio", "god of thieves") are parsed with patterns and answered from book/SRD stat lines or wiki info boxes (`pi-data-label`/`pi-data-value`; a country's head of state is the row after "Type"). List questions ("level 3 cleric spells", "undead CR 4 to 6") filter the catalog and link to the category view.
- **Passages** (`src/lib/ask/engine.ts` + `src/workers/ask.worker.ts`): meaning search with bge-small-en-v1.5 (int8 ONNX, 34 MB, transformers.js + onnxruntime-web WASM, single thread) over int8 vectors (1-bit signature prefilter, exact rerank), fused with keyword search (RRF). Without the model downloaded, Ask falls back to keyword search only.
- **Highlighting** (`src/lib/ask/highlight.ts`): best sentence(s) by question terms, entry-name words down-weighted.
- **Indexes:** SRD → `public/ask/srd-*.{json,i8}` (committed; `python3 scripts/ask/embed_srd.py`); books → `ask_passages`/`ask_vectors` tables inside the encrypted books.db (`build_books.py` → `add_ask_index`); wiki → same tables in wiki.db (`build-wiki.mjs` runs `scripts/ask/embed_wiki.py`; CI caches `data-build/ask-cache.db`). Python embedding: `scripts/lib/embed.py` (onnxruntime + tokenizers, CLS pooling, query prefix in the worker).
- **Model files:** `node scripts/fetch-models.mjs` (pinned commit + SHA-256 in `scripts/models.lock.json`) → `public/models/` (git-ignored); `scripts/copy-ort.mjs` → `public/ort/`. Both run in `prebuild`. The app hosts its own copies; the model is an opt-in 47 MB download into the `ask-models` cache (not precached). Vite aliases `onnxruntime-web` → `onnxruntime-web/wasm` (11 MB build, not the 23 MB WebGPU one).
- Measured (Chromium, laptop): model load ~1 s on first question; meaning search 25–60 ms; whole answer 50–170 ms; ~110k passages.
- **Lab test page removed (Nov 27):** the hidden `#/lab` page (written answers in Safari with transformers.js v4 / WebLLM) proved Safari's per-page memory can't hold a 1B model on iPhone (Gemma 3 1B loaded its weights, then the page was killed at the first run; only ~250 MB models ran, with poor answers). Written answers moved to the native app. `src/lib/cleanup.ts` deletes the lab's leftovers once per device (OPFS `lab-models`, `transformers-cache`, `webllm*` caches).

## Native app (Capacitor; on `main` since 27 Nov)

- User has an Apple Developer account and wants a native app for iPhone/iPad/Mac, mainly so written answers can use **Apple's on-device model** (Foundation Models, iOS/iPadOS/macOS 26+, Apple Intelligence devices), which Safari can't offer.
- **Capacitor 8.6.2** wraps the web app: `capacitor.config.ts` (appId `io.github.dsinkwell.frreference`, name "FR Reference", webDir `dist-native`), `ios/` (SPM template). `scripts/native-web.mjs` copies `dist/` → `dist-native/` without `data/`; `npx cap sync ios` copies it into `ios/App/App/public` (git-ignored). In the app, `src/lib/platform.ts` → `isNative()`; `dataBase()` downloads the data packs from `WEB_HOME` (GitHub Pages, CORS *).
- **Write an answer:** `ios/App/App/WriterPlugin.swift` (Capacitor plugin "Writer": availability / prewarm / write with streamed `writer` events; `LanguageModelSession.streamResponse`), registered in `MainViewController.swift` (storyboard custom class). FoundationModels is weak-linked (`OTHER_LDFLAGS -weak_framework`), deployment target iOS 16.4. Web side: `src/lib/ask/writer.ts`, `src/lib/ask/prompt.ts`, `WriteCard` in `AskView.tsx` (shown only when the plugin reports available).
- **Gotcha:** never resolve a promise (or return from an async function) with a Capacitor plugin proxy: it answers every property as a native method, so promise resolution calls a native `then` that never replies (this hung the Writer availability check in builds 6–9). Capacitor also silently ignores calls to unknown plugins/methods, so plugin calls need timeouts.
- New Swift files must be added to `project.pbxproj` by hand (objectVersion 60, no synchronized folders): PBXBuildFile, PBXFileReference, App group child, Sources phase.
- **CI:** `.github/workflows/ios.yml` on `macos-26` (free: public repo). Without secrets it compiles unsigned; with `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` it archives with automatic cloud signing (`-allowProvisioningUpdates` + API key) and uploads to TestFlight (build number = run number). Runs on pushes to `main` that touch the app (src/, ios/, public/…), by hand, and monthly (TestFlight builds expire after 90 days). The user must create the bundle ID + app record in App Store Connect and the API key (Admin role, for cloud-managed distribution signing).
- **Status (build 11):** works on the user's iPhone 18 Pro: books download, meaning search uses the bundled model, and Write an answer (Apple Intelligence) works. Signing: archive unsigned (`CODE_SIGNING_ALLOWED=NO`), cloud distribution signing at export (no registered devices needed). Workflow picks the newest non-beta Xcode on the runner (Apple wants the iOS 27 SDK from April 2027; runners had only Xcode 26.x in Nov 2026).
- **Open-model writer (devices without Apple Intelligence):** `ios/App/LlamaSPM` (local Swift package: llama.cpp **b12340** prebuilt `llama.xcframework` as a checksum-pinned binaryTarget + `LlamaRunner.swift`), `ios/App/App/LocalWriterPlugin.swift` (plugin "LocalWriter": status/download/cancelDownload/remove/write; events `localDownload`, `localWriter`). Models (GGUF Q4_K_M, pinned HF revisions, SHA-256 checked after download, stored in Application Support/WritingModels, excluded from backup): Gemma 3 1B (806 MB, ≥3.6 GB RAM) and Qwen 2.5 1.5B (1.1 GB, ≥5.5 GB RAM). Minimum iOS is now **16.4** (xcframework requirement). JS: `chooseEngine()` in `writer.ts` (Apple → downloaded open model → none), `WritingSettings.tsx` on About (auto-write switch, downloads, "Testing: use the open model instead of Apple Intelligence"). To update llama.cpp: pick a release ≥2 weeks old (git ls-remote tags; GitHub API is not open to this session), download `llama-bNNNN-xcframework.zip`, put its sha256 in `LlamaSPM/Package.swift`, re-check `llama.h` signatures.
- **Status (build 15):** user confirmed on iPhone 18 Pro: Gemma 3 1B downloads (checksum OK) and writes answers through llama.cpp (tested via the 'use the open model instead' switch).
- Distribution: TestFlight only (never the public App Store: the rulebooks are the user's private copies).

## App updates

- `registerType: 'prompt'`; `src/main.tsx` applies a new version (skip-waiting, then reload) only when `src/lib/busy.ts` reports nothing busy. Long operations wrap themselves in `whileBusy(name, fn)`: DB installs (OfflineData), the Ask model download, open-model downloads and written answers. Test for this: publish a build mid-download, call `registration.update()`, check the page survives (note: a comment-only change produces identical bundles, so no update).

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
