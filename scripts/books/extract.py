"""Layout-aware text extraction for D&D rulebook PDFs.

Turns a PDF (or an OCR cache from ocr_pages.py) into a flat stream of elements:
    {"t": "h", "level": 1..4, "text", "page"}       heading
    {"t": "p", "html", "text", "page"}             paragraph (inline <b>/<i> kept)
    {"t": "table", "rows": [[cell, ...]], "page"}  table-like block
Heading styles are learned per book: the body style is the most common (font, size);
headings are short standalone lines in a larger or display font.
"""
import collections
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


LIGATURE_CHARS = str.maketrans({'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st'})
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


def page_lines_ocr(p):
    """OCR lines → blocks (Tesseract's own text blocks when recorded), then reading order."""
    W, H = p['w'], p['h']
    groups = {}
    for i, l in enumerate(p['lines']):
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
    xs = sorted(b['bbox'][0] for b in narrow)
    cols = []
    for x in xs:
        if cols and x - cols[-1][-1] < 30:
            cols[-1].append(x)
        else:
            cols.append([x])
    # Keep only real columns: enough blocks/lines start there, and columns are well apart.
    min_count = max(2, int(len(narrow) * 0.08))
    # A column's edge is where its blocks start (a low percentile), not its leftmost member:
    # a page number or running header just left of a column must not drag the edge over.
    starts = []
    for c in sorted(cols, key=lambda c: sorted(c)[len(c) // 5]):
        if len(c) < min_count:
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


def split_cells(line):
    cells, cur, last_x1 = [], [], None
    for s in line['spans']:
        if last_x1 is not None and s['bbox'][0] - last_x1 > 9:
            cells.append(''.join(x['text'] for x in cur).strip())
            cur = []
        cur.append(s)
        last_x1 = s['bbox'][2]
    if cur:
        cells.append(''.join(x['text'] for x in cur).strip())
    out = []
    for c in cells:
        out.extend(x for x in re.split(r'\s{2,}', c) if x)  # “Fort  Ref  Will” set in one run
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
        for li, l in enumerate(lines):
            if li <= skip_until:
                continue
            if li in pending:
                flush(); flush_table()
                used = 1
                for lvl_t, title, n in pending[li]:
                    stream.append({'t': 'h', 'level': lvl_t, 'text': title, 'page': pno, 'bm': True})
                    used = max(used, n)
                skip_until = li + used - 1
                prev_bottom = lines[skip_until]['bbox'][3]
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
    stream[:] = merged
    for e in stream:
        e.pop('_y', None)
        e.pop('bm', None)
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


JUNK_BOOKMARK = re.compile(r'(?i)^(my bookmarks|front cover|back cover|cover|table of contents|contents|credits|index|web enhancement\b.*)$')


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


def full_outline(raw):
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
    # Bookmarks that point backwards in the book are filing mistakes (PHB's “Enlarge” among
    # the “F” spells): drop them.
    # Keep the longest run of bookmarks that moves forward through the book. Bookmarks that
    # point backwards (PHB's trailing list of tables, MM's "Alphabetical listing" spike,
    # stray "Enlarge") are cross-references, not structure.
    import bisect
    tails, tails_idx, prev_idx = [], [], [-1] * len(rows)
    for i, r in enumerate(rows):
        k = bisect.bisect_right(tails, r[2])
        if k == len(tails):
            tails.append(r[2]); tails_idx.append(i)
        else:
            tails[k] = r[2]; tails_idx[k] = i
        prev_idx[i] = tails_idx[k - 1] if k > 0 else -1
    keep, i = [], tails_idx[-1] if tails_idx else -1
    while i >= 0:
        keep.append(i)
        i = prev_idx[i]
    rows = [rows[i] for i in sorted(keep)]
    if not rows:
        return []
    base = min(r[0] for r in rows)
    top = [r for r in rows if r[0] == base]
    chapterish = re.compile(r'(?i)^(chapter|part|appendix|introduction|glossary|general guidelines|preface|foreword|epilogue|afterword)\b')
    demote = sum(1 for r in top if re.match(r'(?i)^chapter\b', r[1])) >= 4
    out = []
    for lvl, title, page in rows:
        level = lvl - base + 1
        if demote and level == 1 and not chapterish.match(title):
            level = 2
        out.append((level, title, page))
    return out


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
        for lvl, title in own:
            li, n = match(lines, texts, styles, used, title, last, False)
            if li is not None:
                place.setdefault(li, []).append((lvl, title, n))
                used.update(range(li, li + n))
                last = li
            elif pi + 1 < len(pages):
                carry.setdefault(pno + 1, []).append((lvl, title))
            else:
                place.setdefault(-1, []).append((lvl, title, 0))
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
