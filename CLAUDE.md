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
- **Two engines in the lab:** ONNX Runtime (transformers.js v4) and **WebLLM** (`@mlc-ai/web-llm` 0.2.88, bundled lazily into the worker as `assets/lab-webllm-*.js`, excluded from the precache). WebLLM loads weights in ~30 MB shards straight to the GPU (weights from huggingface.co/mlc-ai, compiled model libs from raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs, cached in `webllm/*` caches). On the iPhone 18 Pro, ONNX Runtime ran out of memory *preparing* 760 MB models (it briefly holds 2–3 copies); WebLLM is the route to 1B+ models there. WebLLM models offered: Gemma 3 1B (q4f16 only), Llama 3.2 1B, Qwen2.5 1.5B, SmolLM2 1.7B, Qwen3 1.7B (thinking off). The container's SwiftShader GPU cannot run WebLLM generation (device lost); downloading/loading was verified there, generation only on real devices.
- **iPhone 18 Pro verdict (Safari 27):** Gemma 3 1B via WebLLM downloads and loads all 537 MB of weights to the GPU, then Safari kills the page at the first run (GPU setup), even with a 2,048-token context. ONNX Runtime dies preparing any 760 MB model. Only ~250 MB models (LFM2 350M) run, fast (100–160 tok/s) but with poor answers. So written answers are not viable on iPhone in Safari; Ask stays search + direct answers + highlighting there.
- Next: user tests Gemma 3 1B / Llama 3.2 1B (WebLLM) on Mac/iPad; if a 1B-class model answers well, add an optional "Write an answer" button to Ask (only on capable devices), with tighter instructions (short answers, cite sources).

## Native app (branch `native-app`)

- User has an Apple Developer account and wants a native app for iPhone/iPad/Mac, mainly so written answers can use **Apple's on-device model** (Foundation Models, iOS/iPadOS/macOS 26+, Apple Intelligence devices), which Safari can't offer.
- **Capacitor 8.6.2** wraps the web app: `capacitor.config.ts` (appId `io.github.dsinkwell.frreference`, name "FR Reference", webDir `dist-native`), `ios/` (SPM template). `scripts/native-web.mjs` copies `dist/` → `dist-native/` without `data/`, `lab/` and the WebLLM chunk; `npx cap sync ios` copies it into `ios/App/App/public` (git-ignored). In the app, `src/lib/platform.ts` → `isNative()`; `dataBase()` downloads the data packs from `WEB_HOME` (GitHub Pages, CORS *).
- **Write an answer:** `ios/App/App/WriterPlugin.swift` (Capacitor plugin "Writer": availability / prewarm / write with streamed `writer` events; `LanguageModelSession.streamResponse`), registered in `MainViewController.swift` (storyboard custom class). FoundationModels is weak-linked (`OTHER_LDFLAGS -weak_framework`), deployment target iOS 15. Web side: `src/lib/ask/writer.ts`, `src/lib/ask/prompt.ts` (shared with the lab), `WriteCard` in `AskView.tsx` (shown only when the plugin reports available).
- **Gotcha:** never resolve a promise (or return from an async function) with a Capacitor plugin proxy: it answers every property as a native method, so promise resolution calls a native `then` that never replies (this hung the Writer availability check in builds 6–9). Capacitor also silently ignores calls to unknown plugins/methods, so plugin calls need timeouts.
- New Swift files must be added to `project.pbxproj` by hand (objectVersion 60, no synchronized folders): PBXBuildFile, PBXFileReference, App group child, Sources phase.
- **CI:** `.github/workflows/ios.yml` on `macos-26` (free: public repo). Without secrets it compiles unsigned; with `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` it archives with automatic cloud signing (`-allowProvisioningUpdates` + API key) and uploads to TestFlight (build number = run number). Runs on push to `native-app`, by hand, and monthly (TestFlight builds expire after 90 days). The user must create the bundle ID + app record in App Store Connect and the API key (Admin role, for cloud-managed distribution signing).
- **Status (build 11):** works on the user's iPhone 18 Pro: books download, meaning search uses the bundled model, and Write an answer (Apple Intelligence) works. Signing: archive unsigned (`CODE_SIGNING_ALLOWED=NO`), cloud distribution signing at export (no registered devices needed). Workflow picks the newest non-beta Xcode on the runner (Apple wants the iOS 27 SDK from April 2027; runners had only Xcode 26.x in Nov 2026).
- **Open-model writer (devices without Apple Intelligence):** `ios/App/LlamaSPM` (local Swift package: llama.cpp **b12340** prebuilt `llama.xcframework` as a checksum-pinned binaryTarget + `LlamaRunner.swift`), `ios/App/App/LocalWriterPlugin.swift` (plugin "LocalWriter": status/download/cancelDownload/remove/write; events `localDownload`, `localWriter`). Models (GGUF Q4_K_M, pinned HF revisions, SHA-256 checked after download, stored in Application Support/WritingModels, excluded from backup): Gemma 3 1B (806 MB, ≥3.6 GB RAM) and Qwen 2.5 1.5B (1.1 GB, ≥5.5 GB RAM). Minimum iOS is now **16.4** (xcframework requirement). JS: `chooseEngine()` in `writer.ts` (Apple → downloaded open model → none), `WritingSettings.tsx` on About (auto-write switch, downloads, "Testing: use the open model instead of Apple Intelligence"). To update llama.cpp: pick a release ≥2 weeks old (git ls-remote tags; GitHub API is not open to this session), download `llama-bNNNN-xcframework.zip`, put its sha256 in `LlamaSPM/Package.swift`, re-check `llama.h` signatures.
- Distribution: TestFlight only (never the public App Store: the rulebooks are the user's private copies).

## App updates

- `registerType: 'prompt'`; `src/main.tsx` applies a new version (skip-waiting, then reload) only when `src/lib/busy.ts` reports nothing busy. Long operations wrap themselves in `whileBusy(name, fn)`: DB installs (OfflineData), the Ask model download, lab load/write. Test for this: publish a build mid-download, call `registration.update()`, check the page survives (note: a comment-only change produces identical bundles, so no update).
- Lab downloads stream the model files into OPFS (folder `lab-models`, written chunk by chunk with a sync access handle in the worker; `<file>.ok` marks a complete file) and transformers.js reads them through `env.customCache`. Safari's Cache API buffers a whole file in memory while storing it, which killed the page at the end of the 760 MB LFM2 1.2B download on an iPhone 18 Pro. File list from `config.json` → `transformers.js_config.use_external_data_format`; an index file records each model's big files. Older downloads in `transformers-cache` are still read.
- iPhone 18 Pro results (LFM2 350M, q4f16, WebGPU): load 3 s, first words 0.5–1.0 s with 570–1150 prompt tokens, 100–163 tokens/s. Speed is no problem; the 350M model's answers were poor (padding, one invented answer), so the test is now about 1B-class models.

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
