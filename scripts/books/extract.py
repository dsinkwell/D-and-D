"""Layout-aware text extraction for D&D rulebook PDFs.

Turns a PDF (or an OCR cache from ocr_pages.py) into a flat stream of elements:
    {"t": "h", "level": 1..4, "text", "page"}       heading
    {"t": "p", "html", "text", "page"}             paragraph (inline <b>/<i> kept)
    {"t": "table", "rows": [[cell, ...]], "page"}  table-like block
Heading styles are learned per book: the body style is the most common (font, size);
headings are short standalone lines in a larger or display font.
"""
import collections
import os
import sys
import html as htmllib
import json
import re

import pymupdf

WATERMARK = re.compile(r'\(Order #\d+\)|Order #\d{5,}')
CAPTION = re.compile(r'^(Table|Map)\s+[\dA-Z]+\s*[–\-—.]\s*\d+\s*:|^Table\s+\d+\s*:', re.I)
CREDIT = re.compile(r'^(Illus(tration|\.)? by|Art by|Cartography by|Map by)\b', re.I)
PAGE_NUM = re.compile(r'^\s*\d{1,3}\s*$')
DISPLAY_FONT = re.compile(r'Pterra|Democratica|Caps|SC-|Historical|Mason|Trajan|Copperplate|Albertus|Lithos', re.I)
BOLD = re.compile(r'Bold|Semibo|Semibold|Black|Heavy|Demi', re.I)
ITALIC = re.compile(r'Ital|Oblique|-It\b|MediumIt|Kursiv', re.I)
TABLE_FONT = re.compile(r'ScalaSans|Arial|Helvetica|Frutiger|Futura|Optima', re.I)


def esc(s):
    return htmllib.escape(s, quote=False)


# ---------------------------------------------------------------------------- page reading

def page_lines_pdf(page):
    """Lines with spans, in two-column reading order."""
    W, H = page.rect.width, page.rect.height
    d = page.get_text('rawdict', flags=pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP)
    blocks = []
    for b in d['blocks']:
        if b.get('type') != 0:
            continue
        lines = []
        for l in b['lines']:
            dx, dy = l.get('dir', (1, 0))
            if abs(dy) > 0.2 or dx < 0.8:
                continue  # rotated side tabs ("CHAPTER 3: CLASSES") and other vertical text
            respace_line(l)
            spans = []
            pending_space = False
            for sp in l['spans']:
                if not sp['text'].strip() or sp['size'] < 4:
                    pending_space = pending_space or (sp['text'] != '' and spans != [])
                    continue  # whitespace-only spans carry the word spaces in some PDFs (MM2)
                if pending_space and not sp['text'][:1].isspace() and not spans[-1]['text'][-1:].isspace():
                    sp['text'] = ' ' + sp['text']
                pending_space = False
                spans.append(sp)
            if not spans:
                continue
            text = ''.join(s['text'] for s in spans).strip()
            if WATERMARK.search(text):
                continue
            lines.append({'spans': spans, 'bbox': l['bbox'], 'text': text})
        if lines:
            x0 = min(l['bbox'][0] for l in lines); x1 = max(l['bbox'][2] for l in lines)
            y0 = min(l['bbox'][1] for l in lines); y1 = max(l['bbox'][3] for l in lines)
            blocks.append({'lines': lines, 'bbox': (x0, y0, x1, y1)})
    return coalesce_rows(order_blocks(blocks, W, H), W), W, H


def coalesce_rows(lines, W):
    """Table cells often come out as separate lines at the same height (“1st”, “+1”, “+2”…).
    Join side-by-side fragments of a table row into one line, so the gaps between them mark
    the cells. Only table-font or short fragments are joined, never two text columns."""
    out = []
    for l in lines:
        if out:
            p = out[-1]
            same_row = abs(l['bbox'][1] - p['bbox'][1]) < 2.0 and abs(l['bbox'][3] - p['bbox'][3]) < 3.0
            to_right = l['bbox'][0] >= p['bbox'][2] - 1 and l['bbox'][0] - p['bbox'][2] < W * 0.3
            tabley = all(TABLE_FONT.search(s['font']) for s in l['spans'] + p['spans']) or (
                (l['bbox'][2] - l['bbox'][0]) < W * 0.22 and (p['spans'][-1]['bbox'][2] - p['spans'][-1]['bbox'][0]) < W * 0.22)
            if same_row and to_right and tabley:
                if not p['spans'][-1]['text'].endswith(' ') and not l['spans'][0]['text'].startswith(' '):
                    l['spans'][0] = {**l['spans'][0], 'text': ' ' + l['spans'][0]['text']}
                p['spans'] = p['spans'] + l['spans']
                p['bbox'] = (p['bbox'][0], min(p['bbox'][1], l['bbox'][1]), l['bbox'][2], max(p['bbox'][3], l['bbox'][3]))
                p['text'] = ''.join(s['text'] for s in p['spans']).strip()
                continue
        out.append(l)
    return out


def respace_line(line):
    """Rebuild span text from character positions, putting back word spaces that some PDFs
    (Monster Manual II, Shining South) encode only as gaps: “dealingit1d6pointsof”."""
    prev = None  # last character of the line so far
    for s in line['spans']:
        chars = s.get('chars')
        if chars is None:
            continue
        out = []
        # Letter gaps cluster around a (often negative) typical value; a word gap is clearly wider.
        gaps = sorted(b['bbox'][0] - a['bbox'][2] for a, b in zip(chars, chars[1:]) if a['c'] != ' ' and b['c'] != ' ')
        typical = gaps[len(gaps) // 2] if gaps else 0
        gap_min = max(typical, -s['size'] * 0.1) + s['size'] * 0.1
        for ch in chars:
            c = ch['c']
            if prev is not None and c != ' ' and prev['c'] != ' ' and ch['bbox'][0] - prev['bbox'][2] > gap_min:
                out.append(' ')
            out.append(c)
            prev = ch
        s['text'] = ''.join(out)


WORD = re.compile(r"^[(\"“‘']?([A-Za-z][a-z'’\-]*[a-z]|[A-Z][A-Z'’\-]+|[A-Za-z]|\d+(st|nd|rd|th|d\d+|%|gp|ft\.?)?|\d+[–\-/]\d+)[)\"”’'.,;:!?]*$")


VOCAB = set()


def set_vocabulary(words):
    """Known-good words (built from the text-based rulebooks) used to judge OCR lines."""
    VOCAB.clear()
    VOCAB.update(words)


LIGATURE_CHARS = str.maketrans({'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
                                '￼': '', '�': '', '­': ''})  # object placeholders, soft hyphens
LIG_SPLIT = re.compile(r"\b([A-Za-z]*(?:fi|fl|ff|ffi|ffl)) ([a-z]+)\b")


def fix_ligatures(text):
    """Some PDFs set “fi”/“fl” as one glyph followed by a gap, so words come out as
    “Benefi t”, “Refl ex”, “spellfi re”. Rejoin when the result is a known word."""
    if not text:
        return text
    text = text.translate(LIGATURE_CHARS)
    if not VOCAB:
        return text
    def join(m):
        a, b = m.group(1), m.group(2)
        w = (a + b).lower()
        # The left part always ends in the ligature letters; only a small connecting word on the
        # right (“staff of”, “cliff and”) is left alone.
        if a.lower() not in ('fi', 'fl', 'ff', 'ffi', 'ffl') and b in ('of', 'and', 'or', 'to', 'in', 'on', 'at', 'as', 'is', 'it', 'the', 'a', 'an', 'by', 'for', 'with'):
            return m.group(0)
        if w in VOCAB or (w.endswith('s') and w[:-1] in VOCAB):
            return a + b
        for i in range(3, len(a) - 1):  # compounds: “Bloodfi re” = blood + fire
            if a[:i].lower() in VOCAB and len(w) - i >= 4 and w[i:] in VOCAB:
                return a + b
        return m.group(0)
    return LIG_SPLIT.sub(join, text.replace('ı', 'i'))


def word_quality(text):
    toks = text.split()
    if not toks:
        return 0.0
    good = 0
    for t in toks:
        core = re.sub(r"[^A-Za-z'’\-]", '', t).strip("'’-").lower()
        if not core:
            good += 1 if re.fullmatch(r'[\d+\-–/%.,;:()]+[a-z]{0,2}', t) else 0
            continue
        if VOCAB:
            if core in VOCAB or all(part in VOCAB for part in re.split(r"[-’']", core) if part):
                good += 1
        elif WORD.match(t) and (len(core) <= 3 or re.search(r'[aeiouy]', core)):
            good += 1
    return good / len(toks)


# Base attack bonus and save progressions of 3.0/3.5 classes and prestige classes, by class level
PROGRESSIONS = {
    'full': lambda n: n, 'three-quarters': lambda n: 3 * n // 4, 'half': lambda n: n // 2,
    'good save': lambda n: 2 + n // 2, 'poor save': lambda n: n // 3,
}


def fix_progressions(grid):
    """OCR misreads old-style digits in scanned class tables (F&P prints a 5 that reads as 3). A
    base attack or save column that follows a standard progression in 70%+ of its rows has its
    one or two outliers set to that progression's value; columns that fit no progression are left
    as read. grid: [(row index, cells, boxes)], level ordinals ("1st") in the first column."""
    lv = []
    for _, row, _ in grid:
        m = re.match(r'^(\d{1,2})(st|nd|rd|th)$', row[0] or '')
        lv.append(int(m.group(1)) if m else None)
    # a garbled level between two good ones ("6th" read as nothing, "7th" as "Thal"): levels count up by one
    suffix = lambda n: 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    for k in range(1, len(grid) - 1):
        if lv[k] is None and lv[k - 1] and (lv[k + 1] == lv[k - 1] + 2 or (k + 2 < len(grid) and lv[k + 1] is None and lv[k + 2] == lv[k - 1] + 3)):
            if sum(1 for c in grid[k][1][1:] if re.match(r'^[+\-–]\d', c or '')) >= 2:
                lv[k] = lv[k - 1] + 1
                grid[k][1][0] = f'{lv[k]}{suffix(lv[k])}'
    data = [k for k, n in enumerate(lv) if n]
    if len(data) < 5:
        return
    for c in range(1, len(grid[0][1])):
        vals = {}
        for k in data:
            m = re.match(r'^\+?(\d{1,2})\b', grid[k][1][c] or '')
            vals[k] = int(m.group(1)) if m else None
        parsed = [k for k in data if vals[k] is not None]
        if len(parsed) < len(data) * 0.6:
            continue  # not a bonus column
        for name, f in PROGRESSIONS.items():
            fit = [k for k in data if vals[k] == f(lv[k])]
            bad = [k for k in data if vals[k] != f(lv[k])]
            if len(fit) >= max(4, len(data) * 0.7) and 0 < len(bad) <= 2:
                for k in bad:
                    old = grid[k][1][c] or ''
                    rest = re.sub(r'^\+?\S*?(?=/|$)', '', old) if '/' in old else ''
                    grid[k][1][c] = f'+{f(lv[k])}{rest}'
                break


# Values a real table row is made of: bonuses, levels, dice, prices and weights, percentages, d%
# ranges, alignment codes, deity power ranks. Prose with artwork noise between its columns has few.
TYPED_CELL = re.compile(
    r'^[+\-–]?\d[\d,/+\-–]*\.?$|^\d{1,2}(st|nd|rd|th)$|^\d*d\d+([+\-–]\d+)?\*?$|^\d[\d,]*\s?(gp|sp|cp|lb\.?|ft\.?)$'
    r'|\d+%|^\d{2}[–-]\d{2}$|^(L|N|C)(G|N|E)$|^N$|\((I|L|D|G|Int|Les|Dem)\)')


def ocr_grid_tables(p):
    """Tables on an OCR'd page, found by position: Tesseract reads each cell of a scanned table as
    its own short line ("1st", "+0", "+2", "Familiar, spider affinity"), and the noise filter would
    drop the numbers. Rows where 4+ cells line up in the same columns for 3+ rows in a row (plus up
    to two heading rows just above) become one line per row with a span per cell, which the
    ordinary table path reads. Returns (table lines, indices of the OCR lines used)."""
    W, H = p['w'], p['h']
    raw = [(i, l) for i, l in enumerate(p['lines'])
           if W * 0.03 < l['bbox'][0] and l['bbox'][2] < W * 0.97 and l['text'].strip() and (l['bbox'][2] - l['bbox'][0]) >= 6
           and H * 0.045 < l['bbox'][1] < H * 0.955]
    raw.sort(key=lambda x: ((x[1]['bbox'][1] + x[1]['bbox'][3]) / 2, x[1]['bbox'][0]))
    rows = []
    for i, l in raw:
        mid = (l['bbox'][1] + l['bbox'][3]) / 2
        if rows and abs(mid - rows[-1]['mid']) < 4:
            rows[-1]['cells'].append((i, l))
        else:
            rows.append({'mid': mid, 'cells': [(i, l)]})
    for r in rows:
        r['cells'].sort(key=lambda c: c[1]['bbox'][0])
    good = lambda t: sum(ch.isalnum() for ch in t) >= max(1, len(t.strip().strip(':;,.')) * 0.5)

    def short_clean(t):
        t = re.sub(r'\s{2,}', ' ', t).strip()
        if not t or len(t.split()) > 4 or t.endswith(':'):
            return False
        if re.match(r'^[+\-–]?\d[\d/+\-–]*[:;,.]?$|^\d{1,2}(st|nd|rd|th)$|^[ISl]st$|^Sth$|^\d+[–-]\d+$', t):
            return True
        return word_quality(t) >= 0.7 and sum(ch.isalpha() for ch in t) >= 2

    def row_ok(r):
        texts = [c[1]['text'] for c in r['cells']]
        if sum(1 for t in texts if len(t.split()) > 6) >= 2 or sum(1 for t in texts if t.strip().endswith(':')) >= 2:
            return False  # two columns of prose, or a stat block's "Label: value" pairs
        return sum(1 for t in texts if short_clean(t)) >= 3
    out_lines, used = [], set()
    k = 0
    while k < len(rows):
        # a run of rows with 4+ readable cells, each close below the last
        run = [k]
        while run[-1] + 1 < len(rows):
            r0, r1 = rows[run[-1]], rows[run[-1] + 1]
            if r1['mid'] - r0['mid'] > 22:
                break
            if not row_ok(r1):
                # a wrapped line of a long cell ("Tyche's curse 1/day-" / "luck infusion") between two rows
                r2 = rows[run[-1] + 2] if run[-1] + 2 < len(rows) else None
                if r2 is not None and r2['mid'] - r1['mid'] <= 22 and row_ok(r2) and len(r1['cells']) <= 3:
                    run.extend([run[-1] + 1, run[-1] + 2])
                    continue
                break
            run.append(run[-1] + 1)
        if not row_ok(rows[k]) or len(run) < 3:
            k += 1
            continue
        # column starts shared by at least half the rows
        starts = collections.Counter()
        for ri in run:
            for _, l in rows[ri]['cells']:
                starts[round(l['bbox'][0] / 8)] += 1
        cols = sorted(x * 8 for x, n in starts.items() if n >= len(run) * 0.5)
        aligned = lambda r: sum(1 for _, l in r['cells'] if any(abs(l['bbox'][0] - c) <= 8 for c in cols))
        if len(cols) < 3 or sum(1 for ri in run if aligned(rows[ri]) >= 3) < len(run) * 0.7:
            k += 1
            continue
        # heading rows just above (column names centred over the columns)
        first = run[0]
        for _ in range(2):
            if first > 0 and rows[first]['mid'] - rows[first - 1]['mid'] <= 14 and len(rows[first - 1]['cells']) >= 3 \
                    and all(min(cols) - 8 <= l['bbox'][0] for _, l in rows[first - 1]['cells']):
                first -= 1
        grid = []
        for ri in range(first, run[-1] + 1):
            cells = [(i, l) for i, l in rows[ri]['cells'] if l['bbox'][0] >= min(cols) - 8 and good(l['text'])]
            if len(cells) < 2:
                continue
            # each cell in its column (by position), so a blank cell doesn't shift the rest left
            row = [''] * len(cols)
            boxes = [None] * len(cols)
            for _, l in cells:
                c = max([n for n, x in enumerate(cols) if x <= l['bbox'][0] + 8] or [0])
                row[c] = (row[c] + ' ' + re.sub(r'\s{2,}', ' ', l['text']).strip()).strip()
                boxes[c] = tuple(l['bbox']) if boxes[c] is None else (boxes[c][0], boxes[c][1], l['bbox'][2], l['bbox'][3])
            if grid and not row[0] and sum(1 for c in row if c) <= 2 and any(grid[-1][1][1:]):
                prev = grid[-1][1]  # a wrapped line of a long cell: add it to the row above
                for n, c in enumerate(row):
                    if c:
                        prev[n] = (prev[n] + ' ' + c).strip()
                continue
            grid.append((ri, row, boxes))
        # common OCR slips in class tables: "Sth" for 5th, "+0:" with a stray mark, "42" for +2 in a bonus column
        for c in range(len(cols)):
            vals = [g[1][c] for g in grid if g[1][c]]
            bonus = sum(1 for v in vals if re.match(r'^[+\-–]\d', v)) >= len(vals) * 0.6
            for _, row, _ in grid:
                v = re.sub(r'^[SA](th)$', r'5\1', re.sub(r'^[lIA](st)$', r'1\1', row[c]))
                v = re.sub(r'^\+[\]lI|](?=\s|$)', '+1', v)  # "+]" for +1
                if re.match(r'^[+\-–]?\d+[:;,.]$', v):
                    v = v[:-1]
                if bonus and re.match(r'^4\d°?$', v):
                    v = '+' + v[1]
                row[c] = v
        # prose with stray marks between its columns is not a table: real cells are short and
        # readable (artwork noise reads as "BE aa pS Wave"); a printed contents page has dot leaders
        filled = [c for _, row, _ in grid for c in row if c]
        readable = sum(1 for c in filled if re.match(r'^[+\-–]?\d[\d,/+\-–%]*\.?$|^\d{1,2}(st|nd|rd|th)$', c) or word_quality(c) >= 0.6)
        if (len(grid) < 3 or sum(1 for _, row, _ in grid if any(len(c.split()) > 8 for c in row)) >= len(grid) * 0.4
                or readable < len(filled) * 0.75 or sum(1 for c in filled if re.search(r'\.\s?\.\s?\.', c)) > len(filled) * 0.1
                or sum(1 for _, row, _ in grid if sum(1 for c in row if TYPED_CELL.search(c)) >= 2) < len(grid) * 0.5):
            k = run[-1] + 1
            continue
        fix_progressions(grid)
        for ri, row, boxes in grid:
            y0 = min(b[1] for b in boxes if b); y1 = max(b[3] for b in boxes if b)
            spans = [{'text': t if t else ' ', 'size': 7.0, 'font': 'OCR-Arial', 'flags': 0, 'color': 0, 'blank': not t,
                      'bbox': b if b else (cols[n], y0, cols[n] + 4, y1)} for n, (t, b) in enumerate(zip(row, boxes))]
            bbox = (min(sp['bbox'][0] for sp in spans), min(sp['bbox'][1] for sp in spans),
                    max(sp['bbox'][2] for sp in spans), max(sp['bbox'][3] for sp in spans))
            out_lines.append({'spans': spans, 'bbox': bbox, 'text': '  '.join(sp['text'] for sp in spans)})
            used.update(i for i, _ in rows[ri]['cells'])
        k = run[-1] + 1
    return out_lines, used


def page_lines_ocr(p):
    """OCR lines → blocks (Tesseract's own text blocks when recorded), then reading order."""
    W, H = p['w'], p['h']
    groups = {}
    table_lines, in_table = ocr_grid_tables(p)
    if table_lines:
        groups['ocr-table'] = table_lines
    for i, l in enumerate(p['lines']):
        if i in in_table:
            continue
        text = re.sub(r'\s{2,}', ' ', l['text']).strip()
        alpha = sum(c.isalpha() for c in text)
        if len(text) < 3 or alpha < max(2, len(text) * 0.5):
            continue  # OCR specks, border art, stray marks
        if re.search(r'\.{4,}|…{2,}|(\. ){3,}', text):
            continue  # table-of-contents dot leaders
        if l['bbox'][1] < H * 0.045 or l['bbox'][1] > H * 0.955:
            continue  # running headers / page numbers (OCR garbles them, so they can't be matched as repeats)
        if WATERMARK.search(text):
            continue
        if word_quality(text) < 0.6:
            continue  # OCR noise from artwork, textured backgrounds and borders
        span = {'text': text, 'size': l['size'] * 0.82, 'font': 'OCR', 'flags': 0, 'color': 0}
        groups.setdefault(l.get('b', f'line{i}'), []).append({'spans': [span], 'bbox': l['bbox'], 'text': text})
    blocks = []
    for lines in list(groups.values()):
        widths = sorted(l['bbox'][2] - l['bbox'][0] for l in lines)
        bx0 = min(l['bbox'][0] for l in lines); bx1 = max(l['bbox'][2] for l in lines)
        if len(lines) > 1 and (bx1 - bx0) > W * 0.55 and widths[len(widths) // 2] < W * 0.5:
            # Tesseract merged two columns into one block: treat each line separately
            for l in lines:
                blocks.append({'lines': [l], 'bbox': tuple(l['bbox'])})
            continue
        lines.sort(key=lambda l: l['bbox'][1])
        x0 = min(l['bbox'][0] for l in lines); x1 = max(l['bbox'][2] for l in lines)
        y0 = min(l['bbox'][1] for l in lines); y1 = max(l['bbox'][3] for l in lines)
        blocks.append({'lines': lines, 'bbox': (x0, y0, x1, y1)})
    return order_blocks(blocks, W, H), W, H


def order_blocks(blocks, W, H):
    """Reading order for 1-, 2- or 3-column pages.

    Columns are found by clustering the left edges of narrow blocks. Blocks wider than a
    column (titles, wide tables, sidebars) split the page into horizontal bands; within a
    band each column is read top to bottom, left to right.
    """
    if not blocks:
        return []
    narrow = [b for b in blocks if (b['bbox'][2] - b['bbox'][0]) < W * 0.55]
    xs = sorted((b['bbox'][0], len(b['lines'])) for b in narrow)
    cols, col_lines = [], []
    for x, nl in xs:
        if cols and x - cols[-1][-1] < 30:
            cols[-1].append(x)
            col_lines[-1] += nl
        else:
            cols.append([x])
            col_lines.append(nl)
    # Keep only real columns: enough blocks/lines start there, and columns are well apart.
    # At least 3 blocks, or 2 blocks holding real text: a two-line illustration caption in the margin
    # is not a column (PHB p. 93's "Lidda dodges…" made the right text column look wide and
    # interleaved the two columns), but a heading plus one long block is (CS p. 49's "Class Features"
    # column was read before the left column's "Malconvoker" heading when 3 blocks were required).
    min_count = max(3, int(len(narrow) * 0.08))
    min_count_long = max(2, int(len(narrow) * 0.08))
    # A column's edge is where its blocks start (a low percentile), not its leftmost member:
    # a page number or running header just left of a column must not drag the edge over.
    starts = []
    for c, nl in sorted(zip(cols, col_lines), key=lambda cl: sorted(cl[0])[len(cl[0]) // 5]):
        if len(c) < min_count and not (len(c) >= min_count_long and nl >= 8):
            continue
        edge = sorted(c)[len(c) // 5]  # 20th percentile: ignores a stray page number, not indented lines
        if starts and edge - starts[-1] < W * 0.2:
            continue
        starts.append(edge)
    starts = starts or [0]

    def col_of(b):
        x0 = b['bbox'][0]
        best = 0
        for i, st in enumerate(starts):
            if x0 >= st - 15:
                best = i
        return best

    def is_wide(b):
        x0, _, x1, _ = b['bbox']
        if (x1 - x0) > W * 0.62:
            return True
        c = col_of(b)
        return c + 1 < len(starts) and x1 > starts[c + 1] + 15

    wide = sorted([b for b in blocks if is_wide(b)], key=lambda b: b['bbox'][1])
    rest = [b for b in blocks if not is_wide(b)]
    out, top = [], -1
    emitted = set()
    for f in wide + [None]:
        bottom = f['bbox'][1] if f else float('inf')
        # Everything above this wide block that hasn't been read yet (a tall wide block can
        # overlap the next one, so a strict [top, bottom) band would drop text).
        band = [b for b in rest if id(b) not in emitted and (b['bbox'][1] + b['bbox'][3]) / 2 < bottom]
        emitted.update(id(b) for b in band)
        for ci in range(len(starts)):
            out += sorted([b for b in band if col_of(b) == ci], key=lambda b: b['bbox'][1])
        if f:
            out.append(f)
            top = f['bbox'][3]
    seen = set()
    lines = []
    for b in out:
        if id(b) in seen:
            continue
        seen.add(id(b))
        lines.extend(b['lines'])
    return lines


# ---------------------------------------------------------------------------- style analysis

def style_key(span):
    return (span['font'], round(span['size'] * 2) / 2)


def line_style(line):
    c = collections.Counter()
    for s in line['spans']:
        c[style_key(s)] += len(s['text'].strip())
    font, size = c.most_common(1)[0][0]
    # Small caps (“CLOAK OF…” set as 14pt capitals + 10.5pt small capitals): use the larger size.
    letters = [ch for ch in line['text'] if ch.isalpha()]
    if len(letters) >= 3 and all(ch.isupper() for ch in letters):
        sizes = [style_key(s)[1] for s in line['spans'] if s['font'] == font and s['text'].strip()]
        if len(set(sizes)) > 1:
            size = max(sizes)
    return (font, size)


def learn_styles(pages):
    """Return body size and a mapping heading-style -> level."""
    chars = collections.Counter()
    for lines, W, H in pages:
        for l in lines:
            for s in l['spans']:
                chars[style_key(s)] += len(s['text'].strip())
    body_font, body_size = chars.most_common(1)[0][0]
    total = sum(chars.values())

    # Candidate heading styles: short standalone lines, larger or display font.
    cand = collections.Counter()
    for lines, W, H in pages:
        for l in lines:
            st = line_style(l)
            text = l['text']
            if len(text) > 70 or len(text) < 2:
                continue
            font, size = st
            bigger = size >= body_size * 1.18
            display = bool(DISPLAY_FONT.search(font)) and size >= body_size * 0.95
            if bigger or display:
                cand[st] += 1
    # Rare styles (decoration, drop caps) are ignored; very common ones aren't headings.
    styles = [s for s, n in cand.items() if 3 <= n and chars[s] < total * 0.08 and not ITALIC.search(s[0])]
    styles.sort(key=lambda s: (-s[1], 0 if DISPLAY_FONT.search(s[0]) else 1))
    levels, lvl, last = {}, 0, None
    for s in styles:
        if last is None or s[1] < last - 0.6:
            lvl += 1
            last = s[1]
        levels[s] = min(lvl, 6)
    return body_size, levels


# ---------------------------------------------------------------------------- stream building

STAT_START = re.compile(r'^(Level|Components|Casting Time|Range|Targets?|Effect|Area|Duration|Saving Throw|Spell Resistance|'
                        r'Hit Dice|Initiative|Speed|Armor Class|Base Attack/Grapple|Attack|Full Attack|Space/Reach|Special Attacks|'
                        r'Special Qualities|Saves|Abilities|Skills|Feats|Environment|Organization|Challenge Rating|Treasure|Alignment|'
                        r'Advancement|Level Adjustment|Price(?: \(Item Level\))?|Body Slot|Caster Level|Aura|Activation|Weight|Property|'
                        r'Discipline|Manifesting Time|Display|Power Points)\s*:')
LEAD_FONTS = set()


def learn_lead_fonts(pages, body_font):
    """Fonts used for run-in names (“Amulet of Proof Against Petrification:”) even when the
    font's name doesn't say Bold: they mostly open a line and end with a colon."""
    lead, total = collections.Counter(), collections.Counter()
    for lines, W, H in pages:
        for l in lines:
            for k, s in enumerate(l['spans']):
                total[s['font']] += 1
                if k == 0 and len(s['text'].strip()) <= 60 and s['text'].strip().endswith(':'):
                    lead[s['font']] += 1
    LEAD_FONTS.clear()
    for f, n in lead.items():
        if f != body_font and n >= 8 and n >= total[f] * 0.4 and not BOLD.search(f) and not ITALIC.search(f):
            LEAD_FONTS.add(f)


def span_html(spans):
    out = []
    for s in spans:
        t = esc(s['text'])
        f = s['font']
        b = bool(BOLD.search(f)) or (s.get('flags', 0) & 16) or f in LEAD_FONTS
        i = bool(ITALIC.search(f)) or (s.get('flags', 0) & 2)
        if b and t.strip():
            t = f'<b>{t}</b>'
        if i and t.strip():
            t = f'<i>{t}</i>'
        out.append(t)
    return ''.join(out).replace('</b><b>', '').replace('</i><i>', '')


def is_table_line(line, body_size):
    spans = line['spans']
    if len(spans) < 2:
        return False
    gaps = 0
    for a, b in zip(spans, spans[1:]):
        if b['bbox'][0] - a['bbox'][2] > 9:
            gaps += 1
    small = all(s['size'] <= body_size * 0.95 for s in spans) or all(TABLE_FONT.search(s['font']) for s in spans)
    return gaps >= 1 and small


def rows_follow(lines, li, body_size, look=4):
    """Whether the lines just under a caption are already read as table rows. The first line is
    often a column-heading line that never looks like a row (PHB class tables, CAdv's Ninja), so
    look a few lines down: rebuilding such a table from word positions merged whole columns into
    one cell, while the ordinary table path reads it correctly."""
    if any(is_table_line(l, body_size) for l in lines[li + 1:li + 1 + look]):
        return True
    # by position too: in reading order the lines after a caption can come from another column
    # (ELH Table 1–25's rows sit under its caption, but the next lines read were the other column's)
    cx0, _, cx1, cy1 = lines[li]['bbox']
    below = sorted((l for l in lines if cy1 - 2 <= l['bbox'][1] <= cy1 + 50 and l['bbox'][0] < cx1 and l['bbox'][2] > cx0),
                   key=lambda l: l['bbox'][1])
    return any(is_table_line(l, body_size) for l in below[:look + 2])


def split_cells(line):
    cells, cur, last_x1 = [], [], None
    for s in line['spans']:
        if last_x1 is not None and s['bbox'][0] - last_x1 > 9:
            cells.append(cur)
            cur = []
        cur.append(s)
        last_x1 = s['bbox'][2]
    if cur:
        cells.append(cur)
    out = []
    for group in cells:
        c = ''.join(x['text'] for x in group).strip()
        if not c and any(x.get('blank') for x in group):
            out.append('')  # a blank cell of an OCR'd table, kept so later cells stay in their columns
            continue
        out.extend(x for x in re.split(r'\s{2,}', c) if x)  # “Fort  Ref  Will” set in one run
    return out


def line_words(line):
    """Words of a line with their positions: from character boxes when the PDF has them, else by
    splitting each span's box in proportion to its text (OCR lines)."""
    out = []
    for s in line['spans']:
        chars = s.get('chars')
        if chars:
            cur = None
            for ch in chars:
                if ch['c'].isspace():
                    if cur:
                        out.append(cur)
                    cur = None
                    continue
                x0, y0, x1, y1 = ch['bbox']
                if cur is None:
                    cur = [x0, y0, x1, y1, ch['c']]
                else:
                    cur[2] = max(cur[2], x1)
                    cur[1] = min(cur[1], y0)
                    cur[3] = max(cur[3], y1)
                    cur[4] += ch['c']
            if cur:
                out.append(cur)
        else:
            text = s['text']
            x0, y0, x1, y1 = s.get('bbox') or line['bbox']  # OCR lines: one box for the whole line
            n = max(1, len(text))
            for m in re.finditer(r'\S+', text):
                out.append([x0 + (x1 - x0) * m.start() / n, y0, x0 + (x1 - x0) * m.end() / n, y1, m.group()])
    return out


def is_caption_title(text):
    """A real caption is a short label ("Table 1–4: Character Regions", "TABLE 3–1: THE GNOME
    ARTIFICER"), not a sentence that mentions one ("Table 1–4: Character Regions describes…")."""
    m = CAPTION.match(text)
    if not m:
        return False
    rest = text[m.end():].strip()
    lower = [w for w in re.findall(r"[A-Za-z’']+", rest) if w[0].islower() and w.lower() not in ('of', 'the', 'and', 'to', 'a', 'an', 'in', 'for', 'by', 'on', 'or', 'with', 'per', 'vs')]
    return len(text) <= 90 and not lower and not rest.endswith(('.', ',', '-', '–'))


def span_cells(line, body_size):
    """The cells of a line whose PDF text spans are separated by clear gaps ("Alchemical sleep gas",
    "30 gp", "1 1/4 lb."), as [x0, y0, x1, y1, text]; None for a line set as one run of text (OCR
    lines, prose). Spans closer than the gap (a word in italics) stay in one cell."""
    spans = [s for s in line['spans'] if s['text'].strip()]
    if len(spans) < 2:
        return None
    gap = body_size * 0.8
    if not any(b['bbox'][0] - a['bbox'][2] > gap for a, b in zip(spans, spans[1:])):
        return None
    cells = []
    for s in spans:
        x0, y0, x1, y1 = s['bbox']
        if cells and x0 - cells[-1][2] <= gap:
            c = cells[-1]
            c[2], c[1], c[3] = max(c[2], x1), min(c[1], y0), max(c[3], y1)
            c[4] = (c[4] + ('' if c[4].endswith(' ') or s['text'].startswith(' ') else ' ') + s['text']).strip()
        else:
            cells.append([x0, y0, x1, y1, s['text'].strip()])
    return cells


def span_table(rows, from_spans, single=None):
    """Columns from PDF span cells: when most rows are span cells with the same number of cells,
    each column is where those rows' cells are centred (centred and right-aligned columns start at
    different x), and every cell goes to the nearest column. Returns table rows, or None to fall
    back to word positions."""
    counts = collections.Counter(len(ws) for ws, sp in zip(rows, from_spans) if sp and len(ws) >= 2)
    if not counts:
        return None
    n, freq = counts.most_common(1)[0]
    if freq < max(2, len(rows) * 0.35):
        return None
    full = [ws for ws, sp in zip(rows, from_spans) if sp and len(ws) == n]
    centre = [sorted((ws[i][0] + ws[i][2]) / 2 for ws in full)[len(full) // 2] for i in range(n)]
    left = min(w[0] for ws in rows for w in ws)
    table = []
    for ws, sp in zip(rows, from_spans):
        cells = [''] * n
        if sp and len(ws) == n:
            for i, w in enumerate(ws):
                cells[i] = w[4]
        elif len(ws) == 1 and ws[0][0] - left < 12:
            cells[0] = ws[0][4]  # a group label, a note or a name alone on its row
        else:
            for w in ws:
                k = min(range(n), key=lambda i: abs((w[0] + w[2]) / 2 - centre[i]))
                cells[k] = (cells[k] + ' ' + w[4]).strip()
        filled = sum(1 for c in cells if c)
        prev_filled = sum(1 for c in table[-1] if c) if table else 0
        # a continuation: every cell starts in lower case or carries on a cell that stopped mid-phrase
        # ("Knowledge (history) 4 ranks," / "Great Fortitude"); "Claw bracer" under "Blade boot" starts a row
        carries_on = table and all(
            c[:1].islower() or re.search(r'(,|[–-]|\b(a|an|the|of|to|and|or|with|in|by|for|on))$', table[-1][k] or '')
            for k, c in enumerate(cells) if c)
        all_lower = filled and all(c[:1].islower() for c in cells if c)
        if table and prev_filled >= 2 and ((not cells[0] and (filled <= max(1, n // 3) or carries_on)) or all_lower):
            table[-1] = [(a + ' ' + b).strip() for a, b in zip(table[-1], cells)]  # a wrapped line
        elif table and filled == 1 and cells[0] and prev_filled == 1 and table[-1][0] and not table[-1][0].endswith(('.', ':', '—')) and cells[0][:1].islower():
            table[-1][0] += ' ' + cells[0]  # a note that wraps onto a second line
        elif filled:
            table.append(cells)
    # heading lines above the first row with a number in it become one heading row
    first = next((k for k, r in enumerate(table) if sum(1 for c in r if re.search(r'\d', c)) >= 2), 0)
    # only short heading-like lines are joined: a feat table has few numbers, and its first rows are feats
    heading_like = 0
    while heading_like < len(table) and all(len(c.split()) <= 3 for c in table[heading_like] if c):
        heading_like += 1
    first = min(first, heading_like)
    if 2 <= first <= 4:
        # a group label among them ("Martial Weapons—Melee" above the column headings) goes after the heading row
        labels = [r for r in table[:first] if r[0] and not any(r[1:]) and len(r[0].split()) >= 2]
        heads = [r for r in table[:first] if not (r[0] and not any(r[1:]) and len(r[0].split()) >= 2)]
        if heads:
            table[:first] = [[' '.join(x for x in col if x).strip() for col in zip(*heads)]] + labels
    if len(table) < 2 or sum(1 for r in table if sum(1 for c in r if c) >= 2) < max(2, len(table) * 0.5):
        return None
    return sizes_as_groups(table)


SIZE_WORD = re.compile(r'^(Fine|Diminutive|Tiny|Small|Medium(-size)?|Large|Huge|Gargantuan|Colossal)$', re.I)


def sizes_as_groups(table):
    """A first column of size categories ("Small | Cutlass | 15 gp…", blank under the first of each
    size) becomes group rows above the weapons, as the Player's Handbook prints them, so the weapon
    names are the first column (Ask's table answers look rows up by it)."""
    if len(table) < 3 or len(table[0]) < 3:
        return table
    body = [r for r in table[1:] if sum(1 for c in r if c) >= 3]
    if not body or not all((not r[0] or SIZE_WORD.match(r[0])) for r in body) or sum(1 for r in body if r[0]) < 2:
        return table
    if not all(r[1] and re.search(r'[a-z]{3}', r[1], re.I) for r in body):
        return table
    out = [[table[0][1] or table[0][0]] + table[0][2:]]
    for r in table[1:]:
        if sum(1 for c in r if c) >= 3:
            if r[0]:
                out.append([r[0]] + [''] * (len(r) - 2))
            out.append(r[1:])
        else:
            out.append([r[0]] + r[2:] if not r[1] else r[1:])
    return out


def caption_table(lines, li, W, body_size, levels):
    """The table printed under a caption, rebuilt from word positions: the lines below the
    caption within its column (found by position, not reading order: some PDFs store each
    column of a table as its own block), rows by height, columns where many rows start a word
    after a clear gap. Used for books whose tables are set in ordinary text fonts.
    Returns (table rows, set of line indices used) or None."""
    cap = lines[li]
    cx0, cy0, cx1, cy1 = cap['bbox']
    # the caption's column: half the page when the other half has text beside it, else the whole width
    left_half = cx1 < W * 0.55
    right_half = cx0 > W * 0.45
    beside = any(l['bbox'][1] < cy1 + 60 and l['bbox'][3] > cy0 and (l['bbox'][0] > W * 0.5 if left_half else l['bbox'][2] < W * 0.5) for l in lines)
    # rows wider than a column right under the caption: a full-width table (FRCS Table 3–5's
    # two-line "Range / Increment" heading put a word in the other half, which looked like a column)
    wide_below = any(cy1 - 2 <= l['bbox'][1] <= cy1 + 45 and (l['bbox'][2] - l['bbox'][0]) > W * 0.6 for l in lines)
    if wide_below:
        band = (0, W)
    elif left_half and beside:
        band = (0, W * 0.52)
    elif right_half and beside:
        band = (W * 0.48, W)
    else:
        band = (0, W)
    cand = [(j, l) for j, l in enumerate(lines) if j != li and l['bbox'][1] >= cy1 - 2 and l['bbox'][0] >= band[0] - 2 and l['bbox'][2] <= band[1] + 4 and l['bbox'][0] >= cx0 - 12]
    cand.sort(key=lambda x: (x[1]['bbox'][1], x[1]['bbox'][0]))
    # group the candidate lines into rows by height, and stop where the table ends
    rows_l = []
    last_y = cy1
    heights = []
    for j, l in cand:
        t = l['text'].strip()
        x0, y0, x1, y1 = l['bbox']
        h = y1 - y0
        if rows_l and abs((y0 + y1) / 2 - rows_l[-1]['mid']) < h * 0.55:
            rows_l[-1]['lines'].append((j, l))
            rows_l[-1]['bottom'] = max(rows_l[-1]['bottom'], y1)
            continue
        med = sorted(heights)[len(heights) // 2] if heights else h
        if CAPTION.match(t) or CREDIT.match(t) or (rows_l and re.match(r'^(Special|Note|Notes)\s*:', t)):
            break
        if y0 - last_y > max(med * 2.2, 12):
            break
        st = line_style(l)
        # a group label inside the table ("Martial Weapons—Melee" over FRCS Table 3–5's rows): a short
        # heading with rows of several cells right below it is a row, not the end of the table
        if levels.get(st) and len(t.split()) <= 5 and st[1] <= body_size * 1.6:
            below = [l2 for _, l2 in cand if l2['bbox'][1] >= y1 - 1][:2]
            if any(len(span_cells(l2, body_size) or line_words(l2)) >= 3 and (span_cells(l2, body_size) or is_table_line(l2, body_size)) for l2 in below):
                rows_l.append({'mid': (y0 + y1) / 2, 'bottom': y1, 'lines': [(j, l)]})
                heights.append(h)
                last_y = max(last_y, y1)
                continue
        if levels.get(st) and st[1] > body_size * 1.1:
            break
        # a short heading standing alone on its row ends the table (ELH Table 1–25 read on into the
        # next column and swallowed Divine Emissary's "Class Skills" / "Class Features" headings);
        # a bold column-heading row has other words beside it
        if levels.get(st) and len(rows_l) >= 2 and len(t.split()) <= 5 and not any(
                j2 != j and abs((l2['bbox'][1] + l2['bbox'][3]) / 2 - (y0 + y1) / 2) < h * 0.55 for j2, l2 in cand):
            break
        rows_l.append({'mid': (y0 + y1) / 2, 'bottom': y1, 'lines': [(j, l)]})
        heights.append(h)
        last_y = max(last_y, y1)
    # running text after the table: a row that is one wide, gapless line ending a sentence
    cut = len(rows_l)
    for k, r in enumerate(rows_l):
        # a paragraph opening with a bold run-in name ("Telepathy (Ex): A juvenile…") at the left of a
        # row ends the table, even with another column's text beside it (LEoF Table 11–4)
        if k >= 3:
            lead = min((l for _, l in r['lines']), key=lambda l: l['bbox'][0])
            s0 = lead['spans'][0]
            if re.match(r'^[A-Z][\w’\' -]{1,40}( \((Ex|Su|Sp)\))?:\s', lead['text'].strip()) and s0['text'].strip() and (BOLD.search(s0['font']) or s0['font'] in LEAD_FONTS):
                cut = k
                break
        if k >= 3 and len(r['lines']) == 1:
            l = r['lines'][0][1]
            ws = line_words(l)
            gaps = [b[0] - a[2] for a, b in zip(ws, ws[1:])]
            # (a wrapped sentence line rarely ends in "." — LEoF Table 10–5 ran on into the staff
            # descriptions — so a long gapless line counts too: real rows have gaps between columns)
            if (l['bbox'][2] - l['bbox'][0]) > (band[1] - band[0]) * 0.75 and (not gaps or max(gaps) < body_size * 0.6) and (
                    l['text'].strip().endswith(('.', ':')) or len(ws) >= 9):
                cut = k
                break
            # a description opening with a bold run-in name ("Lesser Staff of Silverymoon: Alustriel…")
            s0 = l['spans'][0]
            if re.match(r'^[A-Z][^:]{2,60}:\s', l['text'].strip()) and s0['text'].strip() and (BOLD.search(s0['font']) or s0['font'] in LEAD_FONTS):
                cut = k
                break
    rows_l = rows_l[:cut]
    if len(rows_l) < 3:
        return None
    rows = []
    from_spans = []
    single = []
    for r in rows_l:
        # a line set as one run inside a row of several lines is one cell (LEoF Table 1–1's "Benefit")
        cs = [span_cells(l, body_size) or ([[*l['bbox'], l['text'].strip()]] if len(r['lines']) > 1 and len([s for s in l['spans'] if s['text'].strip()]) == 1 else None)
              for _, l in r['lines']]
        ws = sorted((w for (_, l), c in zip(r['lines'], cs) for w in (c or line_words(l))), key=lambda w: w[0])
        if len(r['lines']) == 1 and cs[0] is None and len([s for s in r['lines'][0][1]['spans'] if s['text'].strip()]) == 1:
            ws = [[*r['lines'][0][1]['bbox'], r['lines'][0][1]['text'].strip()]]  # a label or note set as one run
            single.append(True)
        else:
            single.append(False)
        rows.append(ws)
        from_spans.append(all(c is not None for c in cs))
    by_centre = span_table(rows, from_spans, single) if any(from_spans) else None
    if by_centre is None and any(single):
        rows = [ws if not one else line_words(rows_l[k]['lines'][0][1]) for k, (ws, one) in enumerate(zip(rows, single))]
    if by_centre is not None:
        return by_centre, {j for r in rows_l for j, _ in r['lines']}
    # column starts: a word after a gap of at least ~1.5 spaces, seen in many rows
    gap_min = body_size * 0.45
    starts = collections.Counter()
    for ws in rows:
        prev = None
        for w in ws:
            if prev is None or w[0] - prev[2] > gap_min:
                starts[round(w[0] / 3)] += 1
            prev = w
    need = max(2, int(len(rows) * 0.3))
    anchors = sorted(k * 3 for k, n in starts.items() if n >= need)
    merged = []
    for a in anchors:
        if merged and a - merged[-1] < 9:
            continue
        merged.append(a)
    if len(merged) < 2:
        return None
    merged[0] = min(merged[0], min(w[0] for ws in rows for w in ws))
    # heading rows (above the first row with numbers in it) are often centred over their columns:
    # their words go to the column whose middle is nearest, data words to the column they start in
    right = max(w[2] for ws in rows for w in ws)
    mids = [(a + (merged[i + 1] if i + 1 < len(merged) else right)) / 2 for i, a in enumerate(merged)]
    numeric = lambda ws: bool(ws) and (bool(re.match(r'^([+\-–]?\d+(st|nd|rd|th)?|\d+[–-]\d+)$', ws[0][4])) or sum(1 for w in ws if re.search(r'\d', w[4])) >= len(ws) * 0.6)
    first_data = next((k for k, ws in enumerate(rows) if numeric(ws)), 0)
    table = []
    for ri, ws in enumerate(rows):
        cells = [''] * len(merged)
        if ri < first_data and first_data <= 4:
            # heading lines: place each word (a span can hold two headings set close: "Level Attack Bonus")
            ws = sorted((w for _, l in rows_l[ri]['lines'] for w in line_words(l)), key=lambda w: w[0])
        for w in ws:
            if ri < first_data and first_data <= 4:
                k = min(range(len(mids)), key=lambda i: abs((w[0] + w[2]) / 2 - mids[i]))
            else:
                k = max([i for i, a in enumerate(merged) if a <= w[0] + 3] or [0])
            cells[k] = (cells[k] + ' ' + w[4]).strip()
        if table and not cells[0] and 0 < sum(1 for c in cells if c) <= max(1, len(cells) // 3) and not (ri < first_data and first_data <= 4):
            table[-1] = [(a + ' ' + b).strip() for a, b in zip(table[-1], cells)]  # a wrapped line
        elif any(cells):
            table.append(cells)
    # several heading rows above the first data row become one heading row
    heads = min(first_data, len(table) - 1) if first_data <= 4 else 0
    if heads >= 2:
        table[:heads] = [[' '.join(x for x in col if x).strip() for col in zip(*table[:heads])]]
    # column headings set on two or three lines: leading rows with an empty first cell belong
    # to the heading row below them ("El Sadimmin and El Nallojal (Army and Navy" / "of Calimshan)")
    while len(table) > 2 and not table[0][0] and table[1][0]:
        table[1] = [(a + ' ' + b).strip() for a, b in zip(table[0], table[1])]
        table.pop(0)
    multi = sum(1 for r in table if sum(1 for c in r if c) >= 2)
    if len(table) < 2 or multi < max(2, len(table) * 0.5):
        return None
    # prose read as a table (long sentences in most cells) is not a table
    cells = [c for r in table for c in r if c]
    if sum(1 for c in cells if len(c.split()) > 12) > len(cells) * 0.3:
        return None
    used = {j for r in rows_l for j, _ in r['lines']}
    return table, used


ORDINAL = re.compile(r'^(\d{1,2})(st|nd|rd|th)$')
BONUS = re.compile(r'^[+\-–]\d+(/[+\-–]?\d+)*/?$|^[+\-–]?\d+$|^—$')


def _class_rows(rows):
    """The data rows of a class table (a level ordinal first), with the count of bonus cells after the level."""
    data = [r for r in rows if r and ORDINAL.match((r[0] or '').strip())]
    if not data:
        return data, 0
    counts = collections.Counter()
    for r in data:
        k = 0
        for c in r[1:]:
            if BONUS.match(c.replace(' ', '')):
                k += 1
            else:
                break
        counts[k] += 1
    return data, counts.most_common(1)[0][0]


def _row_from_text(text, bonuses, width):
    """"6th +6 /+1 +5 +2 +2 Trap sense +2, Bonus Feat" → ["6th", "+6/+1", "+5", "+2", "+2", "Trap sense +2, Bonus Feat"]."""
    toks = text.split()
    if not toks or not ORDINAL.match(toks[0]):
        return None
    cells, i = [toks[0]], 1
    while len(cells) < 1 + bonuses and i < len(toks):
        t = toks[i]
        i += 1
        # iterative attacks set with spaces: "+6 /+1", "+12/ +7/ +2"
        while i < len(toks) and (t.endswith('/') or toks[i].startswith('/')):
            t += toks[i]
            i += 1
        if not BONUS.match(t):
            return None
        cells.append(t)
    rest = toks[i:]
    # trailing numbers (spells per day…) fill the last columns
    tail = []
    while rest and len(cells) + 1 + len(tail) < width and re.match(r'^(\d+|—|–|-)$', rest[-1]):
        tail.insert(0, rest.pop())
    cells.append(' '.join(rest))
    return cells + tail


def join_split_class_tables(stream):
    """Class tables cut into pieces by a row that wasn't read as a table row (PHB's Barbarian table:
    "6th +6 /+1 +5 +2 +2 Trap sense +2, Bonus Feat" set partly in another font became a paragraph)
    are joined: such a paragraph between two pieces becomes a row, and two pieces in a row whose
    levels carry on are one table."""
    out = []
    for e in stream:
        if e['t'] == 'table' and out:
            # table · paragraph(s) that read as rows · table
            k = len(out) - 1
            between = []
            while k >= 0 and out[k]['t'] == 'p' and len(between) < 2:
                between.insert(0, out[k])
                k -= 1
            prev = out[k] if k >= 0 else None
            if prev is not None and prev['t'] == 'table':
                data_a, bon = _class_rows(prev['rows'])
                data_b, _ = _class_rows(e['rows'])
                if data_a and data_b and bon >= 2:
                    width = max(len(r) for r in prev['rows'])
                    rows = [_row_from_text(p['text'], bon, width) for p in between]
                    levels = [int(ORDINAL.match(r[0]).group(1)) for r in data_a] + [int(ORDINAL.match(r[0]).group(1)) for r in rows if r] + \
                        [int(ORDINAL.match(r[0]).group(1)) for r in data_b]
                    first_b = e['rows'].index(data_b[0])
                    if all(rows) and levels == sorted(levels) and len(set(levels)) == len(levels) and first_b == 0 and \
                            levels[len(data_a) + len(rows)] == levels[len(data_a) + len(rows) - 1] + 1:
                        prev['rows'] = prev['rows'] + rows + e['rows']
                        del out[k + 1:]
                        continue
        out.append(e)
    return out


def build_stream(pages, body_size, levels, page_offset=0, toc=None):
    # Running headers/footers: identical short text in the top/bottom margin on many pages.
    margin_text = collections.Counter()
    for lines, W, H in pages:
        seen = set()
        for l in lines:
            y = l['bbox'][1]
            if y < H * 0.075 or y > H * 0.93:
                key = re.sub(r'\d+', '#', l['text'].strip().lower())
                if key not in seen:
                    margin_text[key] += 1
                    seen.add(key)
    running = {k for k, n in margin_text.items() if n >= 4}

    stream = []
    para = None

    def flush():
        nonlocal para
        if para:
            text = re.sub(r'\s+', ' ', para['text']).strip()
            if text:
                stream.append({'t': 'p', 'html': fix_ligatures(re.sub(r'\s+', ' ', para['html']).strip()), 'text': fix_ligatures(text), 'page': para['page']})
        para = None

    table = None

    def flush_table():
        nonlocal table
        if table and len(table['rows']) >= 2:
            stream.append(table)
        elif table:
            for r in table['rows']:
                stream.append({'t': 'p', 'html': esc(' '.join(r)), 'text': ' '.join(r), 'page': table['page']})
        table = None

    placements = place_bookmarks(pages, toc, levels, page_offset) if toc else {}

    for pi, (lines, W, H) in enumerate(pages):
        pno = pi + 1 + page_offset
        prev_bottom = None
        # Bookmark headings: each at the line that prints it (see place_bookmarks).
        pending = dict(placements.get(pno, {}))
        for lvl_t, title, _ in pending.pop(-1, []):
            flush(); flush_table()
            stream.append({'t': 'h', 'level': lvl_t, 'text': title, 'page': pno, 'bm': True})
        skip_until = -1
        consumed = set()  # lines already read into a table under a caption
        for li, l in enumerate(lines):
            if li <= skip_until or li in consumed:
                continue
            if li in pending:
                flush(); flush_table()
                used = 1
                for lvl_t, title, n in pending[li]:
                    stream.append({'t': 'h', 'level': lvl_t, 'text': title, 'page': pno, 'bm': True})
                    used = max(used, n)
                skip_until = li + used - 1
                prev_bottom = lines[skip_until]['bbox'][3]
                # a bookmarked table caption ("Table 2-1: Sample Ranks of Faerûn"): read the table under it
                if any(is_caption_title(title) for _, title, _ in pending[li]) and skip_until + 1 < len(lines) and not rows_follow(lines, skip_until, body_size):
                    got = caption_table(lines, skip_until, W, body_size, levels)
                    if got:
                        rows, used_lines = got
                        stream.append({'t': 'table', 'rows': rows, 'page': pno})
                        consumed |= used_lines
                continue  # the matched line is the heading itself
            text = l['text'].strip()
            y0, y1 = l['bbox'][1], l['bbox'][3]
            key = re.sub(r'\d+', '#', text.lower())
            if (y0 < H * 0.075 or y0 > H * 0.93) and (key in running or PAGE_NUM.match(text)):
                continue
            if PAGE_NUM.match(text) and (y0 < H * 0.1 or y0 > H * 0.9):
                continue
            if CREDIT.match(text):
                continue
            if CAPTION.match(text):
                flush(); flush_table()
                stream.append({'t': 'cap', 'text': text, 'page': pno})
                prev_bottom = y1
                # books whose tables are set in body fonts: rebuild the table under the caption
                # from word positions, when the lines that follow aren't recognised as table rows
                if is_caption_title(text) and li + 1 < len(lines) and not rows_follow(lines, li, body_size):
                    got = caption_table(lines, li, W, body_size, levels)
                    if got:
                        rows, used_lines = got
                        stream.append({'t': 'table', 'rows': rows, 'page': pno})
                        consumed |= used_lines
                continue
            if re.match(r'^\[[A-Za-z ,\-]+\]$', text) and para is None and table is None and stream and stream[-1]['t'] == 'h' and stream[-1]['page'] == pno:
                if not re.search(r'\[[^\]]+\]\s*$', stream[-1]['text']):
                    stream[-1]['text'] += ' ' + text  # “[General]” set on its own line under a feat name
                prev_bottom = y1
                continue
            st = line_style(l)
            lvl = levels.get(st)
            if lvl and st[0] == 'OCR' and (len(text.split()) > 7 or word_quality(text) < 0.95 or text.endswith(('.', ',', ';')) or not text[:1].isupper()):
                lvl = None  # OCR: only clean, short, capitalised lines can be headings
            if lvl and re.match(r'^(chapter\s+)?\d{1,2}:?$', text, re.I):
                continue  # bare chapter numbers ("11", "CHAPTER 3:") are decoration
            if lvl and (re.fullmatch(r'[pqrs\s]+', text) or not re.search(r'[aeiouyAEIOUY0-9]', text)):
                continue  # ornament glyphs set in a dingbat font (“pqqqqrs”)
            if lvl and para is None and table is None and re.match(r'^\([^)]{3,40}\)$', text) and stream and stream[-1]['t'] == 'h' and stream[-1]['page'] == pno:
                stream[-1]['text'] += ' ' + text
                prev_bottom = y1
                continue
            if lvl and len(text) <= 80:
                flush(); flush_table()
                # merge multi-line headings and "[General]" tags
                if stream and stream[-1]['t'] == 'h' and stream[-1]['page'] == pno and stream[-1]['level'] == lvl and stream[-1].get('_y') and abs(y0 - stream[-1]['_y']) < st[1] * 1.6 and len(stream[-1]['text']) + len(text) < 90:
                    stream[-1]['text'] += ' ' + text
                    stream[-1]['_y'] = y1
                else:
                    stream.append({'t': 'h', 'level': lvl, 'text': text, 'page': pno, '_y': y1})
                prev_bottom = y1
                continue
            # "(Intermediate Goddess)" / "(Greater Deity)" under a name heading: part of that heading
            if para is None and table is None and re.match(r'^\([^)]{3,40}\)$', text) and stream and stream[-1]['t'] == 'h' and stream[-1]['page'] == pno:
                stream[-1]['text'] += ' ' + text
                prev_bottom = y1
                continue
            if re.match(r'^\[[A-Za-z ,]+\]$', text) and stream and stream[-1]['t'] == 'h':
                if not re.search(r'\[[^\]]+\]\s*$', stream[-1]['text']):
                    stream[-1]['text'] += ' ' + text
                continue
            if is_table_line(l, body_size):
                flush()
                if table is None:
                    table = {'t': 'table', 'rows': [], 'page': pno}
                table['rows'].append(split_cells(l))
                prev_bottom = y1
                continue
            flush_table()
            html = span_html(l['spans'])
            gap = (y0 - prev_bottom) if prev_bottom is not None else 0
            starts_bold = l['spans'][0]['text'].strip() and (BOLD.search(l['spans'][0]['font']) or l['spans'][0]['font'] in LEAD_FONTS)
            new_para = para is None or gap > body_size * 0.55 or gap < -body_size * 3 or (starts_bold and para['text'].rstrip().endswith(('.', ':', '!', '?', ')')))
            if para and not para['text'].rstrip().endswith(('.', '!', '?', ':', '”', '"')) and text[:1].islower() and not starts_bold:
                new_para = False  # paragraph continues in the next column or on the next page
            if new_para:
                flush()
                para = {'html': html, 'text': text, 'page': pno}
            else:
                joiner = '' if para['text'].endswith('-') and text[:1].islower() else ' '
                if joiner == '':
                    para['text'] = para['text'][:-1]
                    para['html'] = re.sub(r'-(</[bi]>)*$', r'\1', para['html'])
                para['text'] += joiner + text
                para['html'] += joiner + html
            prev_bottom = y1
        # page boundary: tables never continue across pages
        flush_table()
    flush(); flush_table()
    # Stat lines (“Range: …”, “Target: …”) split into separate paragraphs by column breaks
    # belong to one stat block.
    merged = []
    for e in stream:
        if (e['t'] == 'p' and merged and merged[-1]['t'] == 'p' and STAT_START.match(e['text'])
                and STAT_START.match(merged[-1]['text']) and len(merged[-1]['text']) < 600):
            merged[-1]['text'] += ' ' + e['text']
            merged[-1]['html'] += ' ' + e['html']
            continue
        merged.append(e)
    stream[:] = join_split_class_tables(merged)
    for e in stream:
        e.pop('_y', None)
        if e.pop('bm', None):
            e['o'] = 1  # from the book's outline (bookmarks or printed contents)
        if e['t'] in ('h', 'cap'):
            e['text'] = fix_ligatures(e['text'])
        elif e['t'] == 'table':
            e['rows'] = [[fix_ligatures(c) for c in r] for r in e['rows']]
    return stream


OCR_DIGITS = str.maketrans({'S': '5', 's': '5', 'I': '1', 'l': '1', 'O': '0', 'o': '0', 'G': '6', 'B': '8', 'Z': '2'})


def fix_ocr_word(w):
    """Ordinals and numbers misread with look-alike letters: “Sth” → “5th”, “lst” → “1st”, “1G” → “16”."""
    m = re.fullmatch(r'([(]?)([0-9SsIlOoGBZ]{1,3})(st|nd|rd|th)([).,;:]*)', w)
    if m and not m.group(2).isdigit() and m.group(2) + m.group(3) not in ('st', 'Sst'):
        return m.group(1) + m.group(2).translate(OCR_DIGITS) + m.group(3) + m.group(4)
    m = re.fullmatch(r'([(]?)(\d[0-9SIlOGBZ]|[0-9SIlOGBZ]\d)([).,;:]*)', w)
    if m:
        return m.group(1) + m.group(2).translate(OCR_DIGITS) + m.group(3)
    return w


def overlay_words(lines, words):
    """Replace each line's (garbled) text with the OCR words that sit inside it, keeping the
    PDF's spans, fonts and positions. Each word goes to the line whose middle is nearest;
    lines that get no words keep their text only if it reads as real words."""
    # Tesseract sometimes reads part of a line twice (a squat copy of the same words): drop a
    # word that mostly overlaps a taller one.
    words = sorted(words, key=lambda w: -(w[3] - w[1]))
    kept_words = []
    for w in words:
        dup = False
        for k in kept_words:
            ox = min(w[2], k[2]) - max(w[0], k[0])
            oy = min(w[3], k[3]) - max(w[1], k[1])
            if ox > 0.5 * min(w[2] - w[0], k[2] - k[0]) and oy > 0.3 * (w[3] - w[1]):
                dup = True
                break
        if not dup:
            kept_words.append(w)
    words = kept_words
    buckets_by_line = [[] for _ in lines]
    for w in words:
        cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        best, best_d = None, None
        for i, l in enumerate(lines):
            x0, y0, x1, y1 = l['bbox']
            pad = (y1 - y0) * 0.2
            if x0 - 3 <= cx <= x1 + 3 and y0 - pad <= cy <= y1 + pad:
                d = abs(cy - (y0 + y1) / 2)
                if best_d is None or d < best_d:
                    best, best_d = i, d
        if best is not None:
            buckets_by_line[best].append(((cx), fix_ocr_word(w[4])))
    out = []
    for l, mine in zip(lines, buckets_by_line):
        if not mine:
            if word_quality(l['text']) >= 0.8:
                out.append(l)
            continue
        mine.sort()
        spans = l['spans']
        buckets = [[] for _ in spans]
        for cx, word in mine:
            best = min(range(len(spans)), key=lambda i: 0 if spans[i]['bbox'][0] - 1 <= cx <= spans[i]['bbox'][2] + 1 else min(abs(cx - spans[i]['bbox'][0]), abs(cx - spans[i]['bbox'][2])))
            buckets[best].append(word)
        kept = []
        for sp, ws in zip(spans, buckets):
            if ws:
                sp['text'] = (' ' if kept else '') + ' '.join(ws)
                kept.append(sp)
        l['spans'] = kept
        l['text'] = ''.join(sp['text'] for sp in kept).strip()
        if l['text'] and not WATERMARK.search(l['text']):
            out.append(l)
    return out


JUNK_BOOKMARK = re.compile(r'(?i)^(my bookmarks|front cover|back cover|cover|table of contents|contents|credits|index|web enhancement\b.*|tables|sidebars|maps?|figures|list of (numbered )?tables)\s*:?$')


def chapter_bookmarks(raw):
    """The bookmark level that holds the chapters: the first level with at least four real
    entries (skipping wrappers such as the book's own title, covers and contents)."""
    rows = [(lvl, re.sub(r'\s+', ' ', title).strip(), page) for lvl, title, page in raw if page > 0]
    rows = [r for r in rows if r[1] and not JUNK_BOOKMARK.match(r[1])]
    for lvl in sorted({r[0] for r in rows}):
        at = [r for r in rows if r[0] == lvl]
        if len(at) >= 4:
            if len(at) > 60:
                return []  # entry-level bookmarks, not chapters
            named = [r for r in at if re.match(r'(?i)^chapter\b', r[1])]
            if len(named) >= 4:  # keep real chapters; drop stray bookmarks filed at this level
                at = [r for r in at if r in named or re.match(r'(?i)^(introduction|appendix|glossary|general guidelines|preface|foreword|epilogue|afterword)', r[1])]
            return [(page, title) for _, title, page in at]
    return []


def _same_entry(a, b):
    """Two bookmarks naming the same thing on the same page (“Table 2–4: The Argent Savant” in
    the chapter and again in the list of tables)."""
    import difflib
    if a[2] != b[2]:
        return False
    strip = lambda t: _norm(re.sub(r'(?i)^(table|sidebar|map|figure)\s*:?\s*', '', t))
    return difflib.SequenceMatcher(None, strip(a[1]), strip(b[1])).ratio() > 0.85


def full_outline(raw, keep_all=True):
    """The PDF's bookmark outline as (level, title, page), level 1 = chapters. Wrapper levels
    (the book's own title, covers, contents) are dropped; in books whose chapters are named
    “Chapter …”, stray bookmarks filed at chapter level are moved one level down."""
    rows = [(lvl, re.sub(r'\s+', ' ', title).strip(), page) for lvl, title, page in raw if page > 0]
    rows = [r for r in rows if r[1] and not JUNK_BOOKMARK.match(r[1])]
    while rows:
        top = min(r[0] for r in rows)
        at = [r for r in rows if r[0] == top]
        if len(at) <= 3 and any(r[0] > top for r in rows):
            rows = [r for r in rows if r[0] != top]
            continue
        break
    if not rows:
        return []
    # A heading bookmark that points a page or two past its own first child (chapter title
    # pages are artwork) starts where that child starts.
    rows = list(rows)
    for i in range(len(rows) - 2, -1, -1):
        lvl, title, page = rows[i]
        nl, _, npage = rows[i + 1]
        if nl > lvl and npage < page <= npage + 3:
            rows[i] = (lvl, title, npage)
    # The longest run of bookmarks that moves forward through the book is the structure.
    # Every other bookmark (a sidebar or table filed out of page order, PHB's list of tables,
    # a stray "Enlarge") is kept too, but nested one level under the structural bookmark
    # whose pages it falls in, so it can never cut a chapter or section short.
    import bisect
    tails, tails_idx, prev_idx = [], [], [-1] * len(rows)
    for i, r in enumerate(rows):
        k = bisect.bisect_right(tails, r[2])
        if k == len(tails):
            tails.append(r[2]); tails_idx.append(i)
        else:
            tails[k] = r[2]; tails_idx[k] = i
        prev_idx[i] = tails_idx[k - 1] if k > 0 else -1
    keep, i = set(), tails_idx[-1] if tails_idx else -1
    while i >= 0:
        keep.add(i)
        i = prev_idx[i]
    spine = [rows[i] for i in sorted(keep)]
    if not spine:
        return []
    base = min(r[0] for r in spine)
    chapterish = re.compile(r'(?i)^(chapter|part|appendix|introduction|glossary|general guidelines|preface|foreword|epilogue|afterword)\b')
    demote = sum(1 for r in spine if r[0] == base and re.match(r'(?i)^chapter\b', r[1])) >= 4

    def level_of(r):
        level = max(1, r[0] - base + 1)
        if demote and level == 1 and not chapterish.match(r[1]):
            level = 2
        return level

    spine_pages = [r[2] for r in spine]
    spine_levels = [level_of(r) for r in spine]
    out = []
    for i, r in enumerate(rows):
        if i in keep:
            out.append((level_of(r), r[1], r[2]))
        elif not keep_all:
            continue  # printed contents: lines out of page order are cross-reference lists
        elif any(_same_entry(r, sp) for sp in spine[max(0, bisect.bisect_left(spine_pages, r[2]) - 3):bisect.bisect_right(spine_pages, r[2]) + 3]):
            continue  # a second copy (the book's list of tables/sidebars) of a bookmark already in place
        else:
            k = bisect.bisect_right(spine_pages, r[2]) - 1
            ctx = spine_levels[k] if k >= 0 else 0
            out.append((ctx + 1, r[1], r[2]))
    return out


BACK_MATTER = re.compile(r'(?i)^(glossary|index|appendix|monster feats|monsters (by|ranked)|list of|sample lair|full-page maps|'
                         r'for player characters|power components|feats$|spells$|items$|weapons$|templates|credits|afterword)')
TOC_LINE = re.compile(r'^(?P<t>.*?[A-Za-z].*?)\s*(?:[.·…•]\s*){2,}\s*(?P<p>\d{1,3})\s*$|^(?P<t2>.*?[A-Za-z][^.]*?)\s{2,}(?P<p2>\d{1,3})\s*$')


def printed_outline(pages, find_title, max_scan=14):
    """An outline read from the book's printed table of contents (dot-leader lines with page
    numbers), for books whose PDF has few or no bookmarks. Indentation gives the level; a
    line without a page number (“The Monsters”) is a group heading over the lines after it.
    Printed page numbers are mapped to PDF pages by checking where the titles really print
    (find_title(pdf_index, title) -> bool)."""
    toc_pages = []
    for i in range(min(max_scan, len(pages))):
        n = sum(1 for l in pages[i][0] if TOC_LINE.match(l['text'].strip()))
        if n >= 6:
            toc_pages.append(i)
        elif toc_pages:
            break
    if not toc_pages:
        return []
    raw = []
    for i in toc_pages:
        lines, W, H = pages[i]
        for l in lines:
            t = re.sub(r'\s+', ' ', l['text']).strip()
            m = TOC_LINE.match(l['text'].strip())
            if m:
                title = (m.group('t') or m.group('t2') or '').strip(' .·…')
                pg = int(m.group('p') or m.group('p2'))
            elif (re.match(r'^[A-Z][A-Za-z ,’\'&:\-]{2,50}$', t) and not re.match(r'(?i)^(table of|contents?$)', t)
                  and H * 0.08 < l['bbox'][1] < H * 0.95):
                title, pg = t, None
            else:
                continue
            title = re.sub(r'\s*[.·…]+$', '', title).strip()
            if len(title) < 2 or not re.search(r'[A-Za-z]{2}', title):
                continue
            raw.append({'x': l['bbox'][0], 'page': i, 'title': title, 'pg': pg})
    if sum(1 for r in raw if r['pg']) < 6:
        return []
    # columns: indent positions more than 60pt apart start a new column (2- and 3-column pages)
    for pg_i in {r['page'] for r in raw}:
        xs = sorted({r['x'] for r in raw if r['page'] == pg_i})
        starts = [xs[0]]
        for a, b in zip(xs, xs[1:]):
            if b - a > 60:
                starts.append(b)
        for r in raw:
            if r['page'] == pg_i:
                r['col'] = max(i for i, st in enumerate(starts) if r['x'] >= st - 0.5)
    # indentation rank within each page column
    for key in {(r['page'], r['col']) for r in raw}:
        grp = [r for r in raw if (r['page'], r['col']) == key]
        x0 = min(r['x'] for r in grp)
        for r in grp:
            r['rel'] = r['x'] - x0
    rels = sorted({round(r['rel']) for r in raw})
    ranks, cur, last = {}, 0, None
    for v in rels:
        if last is not None and v - last > 3:
            cur += 1
        ranks[v] = cur
        last = v
    out, groups = [], []  # open group headings (unnumbered lines), by indent rank
    for r in raw:
        rank = ranks[round(r['rel'])]
        if r['pg'] is None:
            groups = [g for g in groups if g < rank]
            r['level'] = rank + 1 + len(groups)
            groups.append(rank)
        else:
            if rank == 0 and BACK_MATTER.match(r['title']):
                groups = []  # “Glossary”, “Monster Feats”… come after the monsters, not in them
            groups = [g for g in groups if g <= rank]
            r['level'] = rank + 1 + len(groups)
        out.append(r)
    # group headings take the page of the next numbered line
    nxt = None
    for r in reversed(out):
        if r['pg'] is None:
            r['pg'] = nxt
        else:
            nxt = r['pg']
    out = [r for r in out if r['pg']]
    # printed page -> PDF page: the offset at which most titles are found
    votes = collections.Counter()
    for r in out[:80]:
        for k in range(-4, 14):
            idx = r['pg'] + k - 1
            if 0 <= idx < len(pages) and idx not in toc_pages and find_title(idx, r['title']):
                votes[k] += 1
    if not votes:
        return []
    k = votes.most_common(1)[0][0]
    rows, stack = [], []
    for r in out:  # depth = number of open entries indented less than this one (no skipped levels)
        while stack and stack[-1] >= r['level']:
            stack.pop()
        rows.append((len(stack) + 1, fix_ligatures(r['title']), r['pg'] + k))
        stack.append(r['level'])
    return full_outline(rows, keep_all=False)


def words_to_segments(words, gap=22):
    """OCR words → line segments: words on the same baseline, split where a horizontal gap
    is wider than a column gutter (Tesseract joins a whole row of a multi-column page)."""
    rows = []
    for w in sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        cy = (w[1] + w[3]) / 2
        if rows and abs(rows[-1]['cy'] - cy) < 4:
            rows[-1]['w'].append(w)
        else:
            rows.append({'cy': cy, 'w': [w]})
    out = []
    for r in rows:
        ws = sorted(r['w'], key=lambda w: w[0])
        seg = [ws[0]]
        for a, b in zip(ws, ws[1:]):
            if b[0] - a[2] > gap and not re.fullmatch(r'[.·…]+', a[4]):
                out.append(seg)
                seg = []
            seg.append(b)
        out.append(seg)
    lines = []
    for seg in out:
        text = ' '.join(w[4] for w in seg)
        lines.append({'text': text, 'bbox': (min(w[0] for w in seg), min(w[1] for w in seg), max(w[2] for w in seg), max(w[3] for w in seg)), 'spans': []})
    return lines


def printed_outline_scanned(pdf_path, pages):
    """Printed contents of a scanned book: find the contents page(s) in the OCR text, OCR them
    again at 400 dpi for clean lines, and read them like a text PDF's contents."""
    import difflib
    sys_path = os.path.dirname(os.path.abspath(__file__))
    if sys_path not in sys.path:
        sys.path.insert(0, sys_path)
    from ocr_pages import ocr_page_direct
    doc = pymupdf.open(pdf_path)
    cands = [i for i in range(min(14, len(pages))) if sum(1 for l in pages[i][0] if re.search(r'[A-Za-z]{3}.*(\.\s*){3,}\s*\d{1,3}\s*$', l['text'])) >= 3]
    if not cands:
        return []
    segs, first = [], []
    for i in cands:
        first += [{'text': re.sub(r'\s+', ' ', l['text']), 'bbox': l['bbox']} for l in pages[i][0]]  # original OCR pass
        p = ocr_page_direct(doc[i], 400)
        segs += words_to_segments(p['words'])
    segs = first + segs  # a complete line from either pass wins (see dedupe below)
    # Scanned contents pages are noisy and often share the page with a sidebar list; trust
    # only the chapter lines (“Chapter 5: The Transitive Planes ....45”, possibly wrapped).
    found = []
    segs = sorted(segs, key=lambda l: 0 if re.search(r'\d{1,3}\s*$', l['text']) else 1)
    for k, l in enumerate(segs):
        m = re.match(r'(?i)^(chapter \d+\s*:|appendix\s*:|introduction)\s*(.*)$', l['text'].strip())
        if not m:
            continue
        rest = m.group(2)
        if not re.search(r'\d{1,3}\s*$', rest):
            below = [x for x in segs if abs(x['bbox'][0] - l['bbox'][0]) < 20 and 0 < x['bbox'][1] - l['bbox'][1] < 25]
            if below:
                rest += ' ' + min(below, key=lambda x: x['bbox'][1])['text']  # title wrapped onto the next line
        pm = re.search(r'(\d{1,3})\s*(?:[A-Z].*)?$', rest)
        title_part = re.split(r'\s*(?:[.·…,;:\-]\s*){2,}|\s+\d', rest)[0].strip(' .,;:-')
        title_part = ' '.join(w for w in title_part.split() if word_quality(w) >= 1 or w[:1].isupper())
        if pm:
            key = m.group(1).rstrip(' :').title()
            if any(f[0].split(':')[0] == key for f in found):
                continue  # already have this chapter from a complete line
            found.append((key + (': ' + title_part if title_part and not m.group(1).lower().startswith('intro') else ''), int(pm.group(1))))
    if len(found) < 3:
        return []
    found.sort(key=lambda x: x[1])

    def find(idx, title):
        nt = _norm(re.sub(r'(?i)^(chapter \d+|appendix):\s*', '', title))[:20]
        return len(nt) >= 5 and any(difflib.SequenceMatcher(None, nt, _norm(l['text'])[:len(nt)]).ratio() > 0.75 for l in pages[idx][0])
    votes = collections.Counter()
    for title, pg in found:
        for k in range(-4, 14):
            idx = pg + k - 1
            if 0 <= idx < len(pages) and find(idx, title):
                votes[k] += 1
    off = votes.most_common(1)[0][0] if votes else 0
    return [(1, title, pg + off) for title, pg in found]


def title_on_page(lines, title):
    nt = _norm(title)[:24]
    return bool(nt) and any(_norm(l['text']).startswith(nt[:max(6, len(nt))]) for l in lines)


def _norm(t):
    return re.sub(r'[^a-z0-9]', '', t.lower())


def place_bookmarks(pages, toc, levels, page_offset=0):
    """Put each bookmark at the line that prints it.

    Candidates are lines whose text matches the title; a line in a heading style scores much
    higher than a mention in body text, and among equals the next unused line after the
    previous bookmark wins (so repeated titles like “Combat” go to successive monsters). A
    bookmark with no match on its page is tried on the next page after that page's own
    bookmarks (some outlines point a page early), else it goes at the top of its page.
    Returns {page: {line_index | -1: [(level, title, n_lines_used)]}}."""
    import difflib
    out = {}
    carry = {}

    def match(lines, texts, styles, used, title, after, strict):
        nt = _norm(title)
        best, best_s, best_n = None, 0.0, 1
        if not nt:
            return None, 1
        for li, t in enumerate(texts):
            if li in used or not t:
                continue
            r1 = difflib.SequenceMatcher(None, nt, t[:len(nt) + 6]).ratio()
            r2 = 0.0
            if len(t) < len(nt) and li + 1 < len(texts):
                r2 = difflib.SequenceMatcher(None, nt, (t + texts[li + 1])[:len(nt) + 6]).ratio()
            r, n = (r2, 2) if r2 > r1 + 0.05 else (r1, 1)
            # a short title starting a heading line ("dodge" → "dodgegeneral" from "DODGE [GENERAL]"):
            # the ratio alone (0.62 for Dodge) misses it, and "track" matched "stack." instead.
            # The title must end at a word boundary in the printed line: MM2's letter bookmark "A"
            # otherwise took the "ABEIL" heading line, pushing every letter's first monster off its stats.
            if t == nt or (len(nt) >= 3 and t.startswith(nt) and styles[li] in levels
                           and re.match(r'\W*' + re.escape(title.strip()) + r'(?![^\W\d_])', lines[li]['text'], re.I)):
                r, n = max(r, 0.95), 1
            if r < 0.66:
                continue
            heading = styles[li] in levels
            if strict and not heading and r < 0.9:
                continue
            score = r + (0.6 if heading else 0) + (0.15 if li > after else 0) + (0.1 if t == nt else 0)
            if score > best_s + 1e-6:
                best, best_s, best_n = li, score, n
        return best, best_n

    for pi, (lines, W, H) in enumerate(pages):
        pno = pi + 1 + page_offset
        own = list(toc.get(pno, []))
        carried = carry.pop(pno, [])
        if not own and not carried:
            continue
        texts = [_norm(l['text']) for l in lines]
        styles = [line_style(l) for l in lines]
        used = set()
        place = out.setdefault(pno, {})
        last = -1
        unmatched = []
        for k, (lvl, title) in enumerate(own):
            li, n = match(lines, texts, styles, used, title, last, False)
            if li is not None:
                place.setdefault(li, []).append((lvl, title, n))
                used.update(range(li, li + n))
                last = li
            else:
                unmatched.append((k, lvl, title))
        matched_after = lambda k: any(i > k for i in range(len(own)) if all(u[0] != i for u in unmatched))
        for k, lvl, title in unmatched:
            if matched_after(k) or pi + 1 >= len(pages):
                # its title isn't text (chapter art) but what follows it is here: top of this page
                place.setdefault(-1, []).append((lvl, title, 0))
            else:
                carry.setdefault(pno + 1, []).append((lvl, title))
        for lvl, title in carried:
            li, n = match(lines, texts, styles, used, title, -1, True)
            if li is not None:
                place.setdefault(li, []).append((lvl, title, n))
                used.update(range(li, li + n))
            else:
                place.setdefault(-1, []).insert(0, (lvl, title, 0))
    return out


def extract(pdf_path=None, ocr_path=None, page_offset=0, words_path=None):
    toc = None
    if ocr_path:
        data = json.load(open(ocr_path))
        pages = [page_lines_ocr(p) for p in data['pages']]
        if pdf_path:
            outline = full_outline(pymupdf.open(pdf_path).get_toc())
            if len(outline) < 15:
                chapters = printed_outline_scanned(pdf_path, pages)
                if chapters:  # chapters from the printed contents, one section per page under them
                    outline = []
                    for k, (lvl, title, page) in enumerate(chapters):
                        end = chapters[k + 1][2] if k + 1 < len(chapters) else len(pages) + 1
                        outline.append((1, title, page))
                        outline += [(2, f'Page {p}', p) for p in range(page, end)]
            if len(outline) >= 15:
                toc = {}
                for lvl, title, page in outline:
                    toc.setdefault(page, []).append((lvl, title))
    else:
        doc = pymupdf.open(pdf_path)
        pages = [page_lines_pdf(doc[i]) for i in range(doc.page_count)]
        if words_path:  # bad text layer: keep its layout, take the words from our own OCR
            wpages = json.load(open(words_path))['pages']
            pages = [(overlay_words(lines, wpages[i].get('words') or []), W, H) for i, (lines, W, H) in enumerate(pages)]
    body_size, levels = learn_styles(pages)
    if not ocr_path and pdf_path:
        outline = full_outline(pymupdf.open(pdf_path).get_toc())
        printed = printed_outline(pages, lambda idx, title: title_on_page(pages[idx][0], title))
        if len(printed) > max(len(outline) * 1.5, 20) and len(outline) < 80:
            outline = printed  # thin bookmarks (MM4/MM5 have only A–Z): use the printed contents
        if len(outline) >= 40:
            # The book's own outline gives chapters, sections and often every entry; headings
            # found from font sizes nest below its deepest level.
            toc = {}
            for lvl, title, page in outline:
                toc.setdefault(page, []).append((lvl, title))
            depth = max(l for l, _, _ in outline)
            levels = {k: depth + v for k, v in levels.items()}
        else:
            chapters = chapter_bookmarks(pymupdf.open(pdf_path).get_toc())
            if chapters:
                toc = {}
                for page, title in chapters:
                    toc.setdefault(page, []).append((1, title))
                levels = {k: v + 1 for k, v in levels.items()}
    body_font = collections.Counter(s['font'] for lines, W, H in pages for l in lines for s in l['spans']).most_common(1)[0][0]
    learn_lead_fonts(pages, body_font)
    if ocr_path:
        levels = {}  # OCR sizes are unreliable: headings come from bookmarks, or one section per page
        if not toc:
            toc = {i + 1: [(1, f'Page {i + 1}')] for i in range(len(pages))}
    stream = build_stream(pages, body_size, levels, page_offset, toc)
    return stream, {'lead_fonts': sorted(LEAD_FONTS), 'body_size': body_size, 'levels': {f'{k[0]}@{k[1]}': v for k, v in levels.items()}, 'pages': len(pages), 'toc_headings': bool(toc)}
