"""Compare two unencrypted books databases book by book, before committing a re-pack.

    python3 scripts/books/compare.py OLD.db NEW.db [--book phb] [--all]

The totals can hide losses (a re-pack once went 20,851 -> 20,855 entries while 21 Monster
Manual II monsters had silently become plain rules), so this reports, per book: entries and
tables before -> after, tables whose cells hold a whole stacked column ("1st +0 2nd +1 ..."),
kind totals, and every spell/feat/monster/item/... entry that lost its kind or vanished.

Exit status 1 when a kind's total drops, a book loses more than 3 entries, or stacked tables
increase: look at the listed entries before committing. (Some "lost" entries are old mistakes
fixed, e.g. a heading that carried another entry's text; say so in the commit message.)

Get the old database from the committed pack:
    node --input-type=module -e "import fs from 'fs'; import {unpackDatabase} from './scripts/lib/pack.mjs';
      fs.writeFileSync('data-build/books-old.db', unpackDatabase('public/data/books', process.env.BOOKS_PASS))"
(run that before re-packing; the new one is data-build/books.db after build_books.py).
"""
import collections
import json
import re
import sqlite3
import sys
import zlib

ORD = re.compile(r'\b\d{1,2}(?:st|nd|rd|th)\b')
NUM = re.compile(r'(?<![\w/])[+–-]\d+\b')
CELL = re.compile(r'<t[hd][^>]*>(.*?)</t[hd]>', re.S)


def stacked(table_html):
    """A cell holding a whole column of a class table: several levels or many bonuses."""
    for c in CELL.findall(table_html):
        c = re.sub('<[^>]+>', '', c)
        if len(ORD.findall(c)) >= 3 or len(NUM.findall(c)) >= 5:
            return True
    return False


def load(path):
    db = sqlite3.connect(path)
    books = {r[0]: r[1] for r in db.execute('SELECT id, short FROM books')}
    entries = collections.Counter()
    kinds = collections.defaultdict(collections.Counter)
    named = collections.defaultdict(set)
    for book, kind, title in db.execute('SELECT book, kind, title FROM entries'):
        entries[book] += 1
        kinds[book][kind] += 1
        if kind != 'rule':
            named[book].add((kind, title))
    tables, bad = collections.Counter(), collections.Counter()
    for book, data in db.execute('SELECT book, data FROM chunks'):
        for block in json.loads(zlib.decompress(data, -15)):
            if block.startswith('<table'):
                tables[book] += 1
                bad[book] += stacked(block)
    return {'books': books, 'entries': entries, 'kinds': kinds, 'named': named, 'tables': tables, 'stacked': bad}


def main():
    argv = sys.argv[1:]
    only = None
    if '--book' in argv:
        i = argv.index('--book')
        only = argv[i + 1] if i + 1 < len(argv) else None
        del argv[i:i + 2]
    args = [a for a in argv if not a.startswith('--')]
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    show_all = '--all' in sys.argv
    old, new = load(args[0]), load(args[1])
    ids = [b for b in sorted(set(old['books']) | set(new['books'])) if not only or b == only]
    problems = []

    print(f"{'book':6} {'short':6} {'entries':>17} {'tables':>14} {'stacked':>9}")
    for b in ids:
        eo, en = old['entries'][b], new['entries'][b]
        to, tn = old['tables'][b], new['tables'][b]
        so, sn = old['stacked'][b], new['stacked'][b]
        flag = ''
        if eo - en > 3:
            flag += '  <- entries lost'
            problems.append(f'{b}: {eo - en} entries lost')
        if sn > so:
            flag += '  <- more stacked tables'
            problems.append(f'{b}: stacked tables {so} -> {sn}')
        print(f"{b:6} {new['books'].get(b, old['books'].get(b, '')):6} {eo:6} -> {en:6} {en - eo:+4} {to:5} -> {tn:5} {so:3} -> {sn:<3}{flag}")
    print(f"{'total':13} {sum(old['entries'][b] for b in ids):6} -> {sum(new['entries'][b] for b in ids):6}      "
          f"{sum(old['tables'][b] for b in ids):5} -> {sum(new['tables'][b] for b in ids):5}")

    all_kinds = sorted({k for b in ids for k in list(old['kinds'][b]) + list(new['kinds'][b])})
    print('\nkinds:')
    for k in all_kinds:
        a = sum(old['kinds'][b][k] for b in ids)
        z = sum(new['kinds'][b][k] for b in ids)
        flag = '  <- fewer' if z < a and k != 'rule' else ''
        if flag:
            problems.append(f'{k}: {a} -> {z}')
        print(f'  {k:9} {a:6} -> {z:6} {z - a:+5}{flag}')

    print('\nentries that lost their kind or vanished (kind, title):')
    any_lost = False
    for b in ids:
        lost = sorted(old['named'][b] - new['named'][b])
        gained = sorted(new['named'][b] - old['named'][b])
        if lost:
            any_lost = True
            print(f'  {b}: ' + '; '.join(f'{k} {t!r}' for k, t in lost))
        if gained and show_all:
            print(f'  {b} gained: ' + '; '.join(f'{k} {t!r}' for k, t in gained))
    if not any_lost:
        print('  none')

    if problems:
        print('\nCHECK BEFORE COMMITTING:\n  ' + '\n  '.join(problems))
        sys.exit(1)
    print('\nno losses found')


if __name__ == '__main__':
    main()
