"""Add the Ask-box meaning index to the offline wiki database (one passage per article:
title + summary). Run by scripts/build-wiki.mjs before the database is packed.

    python3 scripts/ask/embed_wiki.py data-build/wiki.db
"""
import os, sqlite3, sys, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from embed import embed_cached, write_vector_tables  # noqa: E402


def main(path):
    t = time.time()
    db = sqlite3.connect(path)
    rows = db.execute('SELECT id, title, display, summary FROM articles ORDER BY id').fetchall()
    refs, texts = [], []
    for aid, title, display, summary in rows:
        name = display or title
        texts.append(f'{name}. {(summary or "")[:700]}')
        refs.append((aid, None, None))
    vecs = embed_cached(texts)
    write_vector_tables(db, refs, vecs)
    db.close()
    print(f'  wiki meaning index: {len(refs)} articles, {vecs.nbytes / 1e6:.1f} MB, {time.time() - t:.0f}s')


if __name__ == '__main__':
    main(sys.argv[1])
