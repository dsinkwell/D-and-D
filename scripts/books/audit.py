"""Coverage audit for the built-in books.

    python3 scripts/books/audit.py [--only phb,mof] [--show spell] [--book mof]

Uses the cached extraction streams in data-build/streams/ (written by build_books.py).
For each book it counts stat-block markers in the text (a spell's "Casting Time:", a
feat's "Benefit:", an item's price line, a monster's "Hit Dice:"/"hp N (N HD)", a
prestige class's requirements, a deity's "Portfolio:") and checks how many of them
ended up in an entry of the right kind, in an entry of another kind, or crowded
several to one entry (a missed heading).
"""
import collections, json, os, re, sys

sys.path.insert(0, os.path.dirname(__file__))
from build_books import BOOKS, BUILD, process_book  # noqa: E402

MARKERS = {
    'spell': re.compile(r'\bCasting Time:'),
    'power': re.compile(r'\bManifesting Time:'),
    'feat': re.compile(r'(?:^|\s)Benefit:'),
    'item': re.compile(r'\b(?:Market )?Price(?: \(Item Level\))?:?\s*[\d,]+\s*gp'),
    'monster': re.compile(r'\bHit Dice:|\bhp \d+ \(\d+ HD\)'),
    'trap': re.compile(r'\bCR \d+;\s*(?:mechanical|magic device)'),
    'prestige': re.compile(r'To qualify to become'),
    'deity': re.compile(r'\bPortfolio:'),
}


def load(bid):
    d = os.path.join(BUILD, 'streams')
    for f in os.listdir(d):
        if f.startswith(bid + '-') and f.endswith('.json'):
            return json.load(open(os.path.join(d, f)))
    return None


def audit(bid, show=None):
    data = load(bid)
    if not data:
        return None
    stream, info = data
    blocks, entries = process_book(bid, stream)
    owner = {}  # stream index -> entry (each entry owns the stream up to the next entry)
    by_start = {e['start']: e for e in entries}
    starts = sorted(by_start)
    for k, st in enumerate(starts):
        nxt = starts[k + 1] if k + 1 < len(starts) else len(stream)
        for j in range(st, nxt):
            owner[j] = by_start[st]
    res = {}
    for kind, rx in MARKERS.items():
        total = ok = wrong = 0
        crowded = collections.Counter()
        wrong_ex, orphan_ex = [], []
        for i, e in enumerate(stream):
            txt = e.get('text') if e['t'] != 'table' else ' '.join(' '.join(r) for r in e['rows'])
            if not txt:
                continue
            for m in rx.finditer(txt):
                total += 1
                ent = owner.get(i)
                if ent is None:
                    orphan_ex.append((e['page'], txt[max(0, m.start() - 80):m.start()]))
                    continue
                crowded[ent['start']] += 1
                if ent['kind'] == kind:
                    ok += 1
                else:
                    wrong += 1
                    wrong_ex.append((ent['page'], ent['title'], ent['kind'], txt[max(0, m.start() - 60):m.end() + 30]))
        found = sum(1 for e in entries if e['kind'] == kind)
        extra = sum(n - 1 for n in crowded.values() if n > 1)
        res[kind] = dict(markers=total, entries=found, ok=ok, wrong=wrong, crowded=extra)
        if show == kind:
            print(f'--- {bid} {kind}: markers in other-kind entries')
            for x in wrong_ex[:40]:
                print('  ', x)
            print(f'--- {bid} {kind}: crowded entries (several markers in one entry)')
            for st, n in crowded.most_common(15):
                if n > 1:
                    print('  ', n, by_start[st]['title'], by_start[st]['page'], by_start[st]['kind'])
    return res


def main():
    only = None
    show = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    if '--show' in sys.argv:
        show = sys.argv[sys.argv.index('--show') + 1]
    kinds = list(MARKERS)
    print('book  ' + ''.join(f'{k:>22}' for k in kinds))
    print('      ' + ''.join(f'{"mark/ok/wrong/crowd":>22}' for k in kinds))
    for b in BOOKS:
        if only and b[0] not in only:
            continue
        r = audit(b[0], show)
        if not r:
            continue
        cells = []
        for k in kinds:
            x = r[k]
            cells.append(f'{x["markers"]}/{x["ok"]}/{x["wrong"]}/{x["crowded"]}' if x['markers'] or x['entries'] else '-')
        print(f'{b[0]:5} ' + ''.join(f'{c:>22}' for c in cells))


if __name__ == '__main__':
    main()
