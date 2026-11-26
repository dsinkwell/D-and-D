# Realms Codex

A private D&D 3.5 + Forgotten Realms reference for Mac, iPad and iPhone. It's an installable web app that works fully offline.

- **Rules:** the complete 3.5 SRD. Browse spells by class, level and school, feats by type, monsters by type and CR, and magic items by price, plus classes, races, skills and conditions.
- **Books:** the group's own core rulebooks, Forgotten Realms sourcebooks and supplements, built in and **encrypted**. Each device unlocks them once with the group passphrase. They're split into searchable entries (spells, feats, monsters, deities, prestige classes, items…) with page references.
- **Realms:** the entire [Forgotten Realms Wiki](https://forgottenrealms.fandom.com) (about 62,000 articles), downloaded once per device and searchable offline. A GitHub Action refreshes it every week.
- **One search box** covers all three, with cross-links (SRD Fireball → PHB p. 232 → the wiki's Fireball article).

## Install on a device

1. Open the site in Safari.
2. On iPhone/iPad tap **Share → Add to Home Screen**. On a Mac choose **File → Add to Dock**.
3. In **Books**, enter the group passphrase. On the **Realms** tab, tap **Download** for the offline wiki (about 260 MB).

## How it's built

| Part | Source | Script |
|---|---|---|
| SRD | `vendor/srd-md/` (OGL 1.0a) | `scripts/build-srd.mjs`, runs on every build |
| Offline wiki | MediaWiki API, CC BY-SA 3.0 | `scripts/build-wiki.mjs`, run by CI with a cache, so only changed articles are re-fetched |
| Books | the group's PDFs (never committed) | `scripts/books/build_books.py` (+ `ocr_pages.py` for scanned books), run by whoever has the PDFs |

The app stores the wiki and books databases in the browser's private storage (SQLite WASM + OPFS) and reads them in a worker (`src/workers/sqlite.worker.ts`).

To rebuild the books after adding or replacing PDFs:

```bash
pip install pymupdf            # and: apt-get install tesseract-ocr  (for scanned books)
BOOKS_PASSPHRASE='…' python3 scripts/books/build_books.py /path/to/pdfs
git add public/data/books && git commit -m "Update books" && git push
```

Only the encrypted parts in `public/data/books/` are committed. The PDFs and the unencrypted database stay in `data-build/` (git-ignored).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/
```

## Licenses

- SRD: Open Game License v1.0a (full text in the app under Rules → Legal Information).
- Wiki text: CC BY-SA 3.0. Each article credits and links its source and history.
- Books: the group's own copies, encrypted, for private use. Dungeons & Dragons and Forgotten Realms are trademarks of Wizards of the Coast; this is an unofficial personal tool.
