"""Build the encrypted built-in books database from the group's own rulebook PDFs.

    BOOKS_PASSPHRASE='…' python3 scripts/books/build_books.py BOOKS_DIR [--only phb,frcs] [--no-pack]

BOOKS_DIR holds the PDFs (named as in BOOKS below) and an ocr/ folder with OCR caches
for scanned books (made by ocr_pages.py). The PDFs and the unencrypted database never
leave data-build/ — only the encrypted parts in public/data/books/ are published.
"""
import json, os, re, sqlite3, subprocess, sys, time, zlib, html as htmllib, collections

sys.path.insert(0, os.path.dirname(__file__))
from extract import extract, set_vocabulary  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUILD = os.path.join(ROOT, 'data-build')
OUT_DB = os.path.join(BUILD, 'books.db')

C, FR, SUP = 'Core Rules', 'Forgotten Realms', 'Supplements'
BOOKS = [
    # id, file, title, short, shelf, edition
    ('phb', 'Players-Handbook.pdf', "Player's Handbook", 'PHB', C, '3.5'),
    ('dmg', 'DMG-Special-Edition.pdf', "Dungeon Master's Guide", 'DMG', C, '3.5'),
    ('mm', 'Monster-Manual.pdf', 'Monster Manual', 'MM', C, '3.5'),
    ('mm2', 'Monster-Manual-II.pdf', 'Monster Manual II', 'MM2', C, '3.0'),
    ('mm2u', 'MM2-35-Update.pdf', 'Monster Manual II — 3.5 Update', 'MM2u', C, '3.5'),
    ('mm3', 'Monster-Manual-III.pdf', 'Monster Manual III', 'MM3', C, '3.5'),
    ('mm4', 'Monster-Manual-IV.pdf', 'Monster Manual IV', 'MM4', C, '3.5'),
    ('mm5', 'Monster-Manual-V.pdf', 'Monster Manual V', 'MM5', C, '3.5'),
    ('frcs', 'Forgotten-Realms-Campaign-Setting.pdf', 'Forgotten Realms Campaign Setting', 'FRCS', FR, '3.0'),
    ('fp', 'Faiths-and-Pantheons.pdf', 'Faiths and Pantheons', 'F&P', FR, '3.0'),
    ('mof', 'Magic-of-Faerun.pdf', 'Magic of Faerûn', 'MoF', FR, '3.0'),
    ('rof', 'Races-of-Faerun.pdf', 'Races of Faerûn', 'RoF', FR, '3.0'),
    ('pgf', 'Players-Guide-to-Faerun.pdf', "Player's Guide to Faerûn", 'PGtF', FR, '3.5'),
    ('lef', 'Lost-Empires-of-Faerun.pdf', 'Lost Empires of Faerûn', 'LEoF', FR, '3.5'),
    ('pof', 'Power-of-Faerun.pdf', 'Power of Faerûn', 'PoF', FR, '3.5'),
    ('ss', 'Shining-South.pdf', 'Shining South', 'SS', FR, '3.5'),
    ('ue', 'Unapproachable-East.pdf', 'Unapproachable East', 'UE', FR, '3.0'),
    ('ghr', 'Grand-History-of-the-Realms.pdf', 'Grand History of the Realms', 'GHotR', FR, '3.5'),
    ('cw', 'Complete-Warrior.pdf', 'Complete Warrior', 'CW', SUP, '3.5'),
    ('ca', 'Complete-Arcane.pdf', 'Complete Arcane', 'CArc', SUP, '3.5'),
    ('cd', 'Complete-Divine.pdf', 'Complete Divine', 'CDiv', SUP, '3.5'),
    ('cad', 'Complete-Adventurer.pdf', 'Complete Adventurer', 'CAdv', SUP, '3.5'),
    ('cs', 'Complete-Scoundrel.pdf', 'Complete Scoundrel', 'CSc', SUP, '3.5'),
    ('mic', 'Magic-Item-Compendium.pdf', 'Magic Item Compendium', 'MIC', SUP, '3.5'),
    ('drac', 'Draconomicon.pdf', 'Draconomicon', 'Drac', SUP, '3.5'),
    ('mop', 'Manual-of-the-Planes.pdf', 'Manual of the Planes', 'MotP', SUP, '3.0'),
    ('elh', 'Epic-Level-Handbook.pdf', 'Epic Level Handbook', 'ELH', SUP, '3.0'),
]

SMALL = {'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'vs', 'via'}
STAT_LABELS = ('Level', 'Components', 'Casting Time', 'Range', 'Target', 'Targets', 'Effect', 'Area', 'Duration', 'Saving Throw',
               'Spell Resistance', 'Prerequisite', 'Prerequisites', 'Benefit', 'Normal', 'Special', 'Portfolio', 'Domains', 'Alignment',
               'Symbol', 'Home Plane', 'Worshipers', 'Cleric Alignments', 'Favored Weapon', 'Hit Die', 'Requirements', 'Price',
               'Body Slot', 'Caster Level', 'Aura', 'Activation', 'Weight', 'Hit Dice', 'Initiative', 'Speed', 'Armor Class',
               'Base Attack/Grapple', 'Attack', 'Full Attack', 'Space/Reach', 'Special Attacks', 'Special Qualities', 'Saves',
               'Abilities', 'Skills', 'Feats', 'Environment', 'Organization', 'Challenge Rating', 'Treasure', 'Advancement',
               'Level Adjustment', 'Prerequisite', 'Price (Item Level)', 'Discipline', 'Display', 'Manifesting Time', 'Power Points')
ITEM_LABELS = ('Price (Item Level)', 'Price', 'Body Slot', 'Caster Level', 'Aura', 'Activation', 'Weight', 'Property', 'Prerequisites',
               'Cost to Create', 'Level', 'Components', 'Casting Time', 'Range', 'Target', 'Targets', 'Effect', 'Area', 'Duration',
               'Saving Throw', 'Spell Resistance', 'Hit Dice', 'Initiative', 'Speed', 'Armor Class', 'Base Attack/Grapple', 'Attack',
               'Full Attack', 'Space/Reach', 'Special Attacks', 'Special Qualities', 'Saves', 'Abilities', 'Skills', 'Feats',
               'Environment', 'Organization', 'Challenge Rating', 'Treasure', 'Alignment', 'Advancement', 'Level Adjustment')
_lab = '|'.join(re.escape(x) for x in sorted(ITEM_LABELS, key=len, reverse=True))
PLAIN_LABEL_START = re.compile(r'^(?:' + _lab + r')\s*:')
PLAIN_LABEL_RE = re.compile(r'(?<![\w(])(' + _lab + r')\s*:')
LABEL_RE = re.compile(r'\s(<b>\s*(?:' + '|'.join(re.escape(x) for x in STAT_LABELS) + r')\s*:\s*</b>)')


def esc(s):
    return htmllib.escape(s, quote=False)


def smart_title(t):
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'(\w)\(', r'\1 (', t)
    letters = [c for c in t if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.85:
        words = t.lower().split(' ')
        out = []
        for i, w in enumerate(words):
            if w.startswith('['):
                out.append('[' + w[1:].capitalize())
            elif i > 0 and w in SMALL:
                out.append(w)
            else:
                if '&' in w and len(w) <= 5:
                    out.append(w.upper())  # D&D
                    continue
                out.append(re.sub(r"(^|[-(/])([a-zà-ÿ])", lambda m: m.group(1) + m.group(2).upper(), w))
        t = ' '.join(out)
    return t


def slug(t):
    s = re.sub(r'[^a-z0-9]+', '-', t.lower().replace('’', '').replace("'", '')).strip('-')
    return s or 'section'


def block_html(e, anchor=None):
    if e['t'] == 'h':
        n = min(e['level'] + 1, 6)
        return f'<h{n} id="{anchor}">{esc(e["title"])}</h{n}>'
    if e['t'] == 'cap':
        return f'<p class="caption">{esc(e["text"])}</p>'
    if e['t'] == 'table':
        rows = e['rows']
        width = max(len(r) for r in rows)
        out = ['<table>']
        for i, r in enumerate(rows):
            tag = 'th' if i == 0 and not any(re.search(r'\d', c) for c in r[1:]) else 'td'
            cells = ''.join(f'<{tag}>{esc(c)}</{tag}>' for c in r + [''] * (width - len(r)))
            out.append(f'<tr>{cells}</tr>')
        out.append('</table>')
        return ''.join(out)
    html = e['html']
    if '<b>' not in html and PLAIN_LABEL_START.match(e['text']):
        # stat block whose labels aren't bold (OCR'd or plain-set): bold them, one per line
        html = PLAIN_LABEL_RE.sub(lambda m: ('<br>' if m.start() > 0 else '') + f'<b>{m.group(1)}:</b>', html)
    html = LABEL_RE.sub(r'<br>\1', html)
    return f'<p>{html}</p>'


def element_text(e):
    if e['t'] == 'table':
        return ' '.join(' '.join(r) for r in e['rows'])
    return e.get('title') or e.get('text', '')


# ---------------------------------------------------------------------------- entry kinds

def detect_kind(title, own_text, child_titles):
    ct = ' | '.join(child_titles).lower()
    head = own_text[:1500]
    if re.search(r'\bPrice[^:]{0,16}:\s*\+?[\d,]+\s*(gp|bonus)', head) and re.search(r'\b(Property|Body Slot|Caster Level|Aura):', head):
        return 'item'  # incl. weapon/armor properties (“Acidic Burst [Synergy]”, Price: +1 bonus)
    if re.search(r'\w.*\[[A-Za-z ,]+\]\s*$', title) and not re.search(r'\[(Fire|Cold|Acid|Electricity|Sonic|Evil|Good|Law|Chaos|Force|Light|Darkness|Death|Fear|Mind-Affecting|Language-Dependent|Air|Earth|Water)\]', title):
        return 'feat'
    if re.search(r'\bLevel:\s*[A-Z]', head) and re.search(r'\b(Components|Casting Time):', head):
        return 'spell'
    if re.search(r'\bLevel:\s*[A-Z][A-Za-z/]{1,10} \d', head[:300]) and re.search(r'\b(Range|Duration|Saving Throw|Spell Resistance|Target|Area|Effect):', head):
        return 'spell'  # “Mass”/“Greater” variants list only the lines that differ
    if re.search(r'\bSpellcraft DC:\s*\d', head) and re.search(r'\b(Components|Casting Time):', head):
        return 'spell'  # epic spells
    if re.search(r'\b(Discipline|Power Points):', head) and re.search(r'\bLevel:', head):
        return 'power'
    if re.search(r'\bhp \d+ \(\d+ HD\)', head) and re.search(r'\b(Init [+\-–]\d|AC \d+|Speed \d)', head):
        return 'monster'  # MM4/MM5 style stat block
    if re.search(r'\bHit Dice:\s', head) or (re.search(r'\bhp \d', head) and re.search(r'\bInit [+\-–]', head) and (re.search(r'\bCR \d', head) or re.search(r'\bCR \d', title))):
        return 'monster'
    if re.search(r'(^|\s)Benefit:', head[:1200]) and not re.search(r'\bHit Dice:', head):
        return 'feat'
    if ('requirements' in ct or 'entry requirements' in ct) and ct.count('class features') == 1:
        return 'prestige'
    if 'class features' in ct and ('class skills' in ct or 'hit die' in head.lower()):
        return 'class'
    if re.search(r'\bPortfolio:\s', head) and re.search(r'\b(Domains|Alignment|Symbol):', head):
        return 'deity'
    if re.search(r'\bPrice\b[^.]{0,30}\d[\d,]* gp', head) and re.search(r'\b(Caster Level|Aura|Body Slot|CL \d)', head):
        return 'item'
    return 'rule'


def meta_for(kind, own_text, title):
    m = {}
    def field(name):
        r = re.search(r'\b' + re.escape(name) + r':\s*(.+?)(?=\s(?:' + '|'.join(re.escape(x) for x in STAT_LABELS) + r'):|$)', own_text[:2500])
        return r.group(1).strip()[:200] if r else None
    if kind == 'spell':
        sch = re.match(r'^\s*(Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation|Universal)[^A-Z]{0,60}', own_text)
        if sch:
            m['school'] = sch.group(0).strip()
        lv = field('Level')
        if lv:
            m['Level'] = lv
            m['lv'] = {mm.group(1).strip(): int(mm.group(2)) for mm in re.finditer(r'([A-Za-z/ ]+?)\s+(\d)(?=,|$|\s)', lv)}
    elif kind == 'feat':
        t = re.search(r'\[([^\]]+)\]', title)
        if t:
            m['ftype'] = t.group(1).title()
        pre = field('Prerequisites') or field('Prerequisite')
        if pre:
            m['pre'] = pre
    elif kind == 'monster':
        cr = re.search(r'\b(?:Challenge Rating:|CR)\s*([\d/]+)', own_text)
        if cr:
            m['cr'] = cr.group(1)
        ty = re.search(r'\b(Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)(?:-size)?\s+([a-z ]{3,30}?)(?=\s*\(|\s|$)', own_text[:600], re.I)
        if ty:
            m['size'] = ty.group(1).capitalize()
            m['ctype'] = ty.group(2).strip().title()
    elif kind == 'deity':
        for k in ('Portfolio', 'Domains', 'Alignment', 'Symbol'):
            v = field(k)
            if v:
                m[k.lower()] = v
    elif kind == 'item':
        p = re.search(r'\bPrice[^:]*:\s*([\d,]+ gp(?: \(\d+\w+\))?)', own_text)
        if p:
            m['price'] = p.group(1)
        sl = field('Body Slot')
        if sl:
            m['slot'] = sl
    return m


# ---------------------------------------------------------------------------- per book

def merge_tag_headings(stream):
    """“CLINGING BREATH” … caption … “[METABREATH]”: a heading that is only a feat tag belongs
    to the name heading just before it (an illustration caption may sit in between)."""
    for i, e in enumerate(stream):
        if e['t'] != 'h' or not re.fullmatch(r'\[[A-Za-z ,\-]+\]', e['text'].strip()):
            continue
        for j in range(i - 1, max(-1, i - 4), -1):
            x = stream[j]
            if x['t'] == 'h':
                if x['page'] == e['page'] and '[' not in x['text']:
                    x['text'] = x['text'].rstrip() + ' ' + e['text'].strip()
                    stream[i] = {'t': 'p', 'html': '', 'text': '', 'page': e['page']}
                break
            if x['t'] != 'p' or len(x['text']) > 160:
                break


def process_book(book_id, stream):
    merge_tag_headings(stream)
    for e in stream:
        if e['t'] == 'h':
            e['title'] = re.sub(r'^New (Feat|Spell|Magic Item|Item|Monster|Prestige Class):\s*', '', smart_title(e['text']), flags=re.I)
    used = set()
    anchors = {}
    for i, e in enumerate(stream):
        if e['t'] == 'h':
            a = slug(e['title']); n = 2; base = a
            while a in used:
                a = f'{base}-{n}'; n += 1
            used.add(a); anchors[i] = a
    blocks = [block_html(e, anchors.get(i)) for i, e in enumerate(stream)]

    entries = []
    stack = []
    for i, e in enumerate(stream):
        if e['t'] != 'h':
            continue
        lvl = e['level']
        while stack and stream[stack[-1]]['level'] >= lvl:
            stack.pop()
        parent = stream[stack[-1]]['title'] if stack else None
        path = [stream[j]['title'] for j in stack]
        stack.append(i)
        end = len(stream); own_end = len(stream)
        child_titles = []
        for j in range(i + 1, len(stream)):
            if stream[j]['t'] == 'h':
                if own_end == len(stream):
                    own_end = j
                if stream[j]['level'] <= lvl:
                    end = j
                    break
                child_titles.append(stream[j]['title'])
        own_text = ' '.join(element_text(stream[j]) for j in range(i + 1, own_end))
        if not own_text.strip() and end == i + 1:
            continue  # empty heading
        # chapters are sections (but a scanned book without an outline has one section per page)
        kind = detect_kind(e['title'], own_text, child_titles) if lvl > 1 or re.match(r'^Page \d+$', e['title']) else 'rule'
        summary = ''
        for j in range(i + 1, own_end):
            if stream[j]['t'] == 'p' and len(stream[j]['text']) > 60 and not re.match(r'^[A-Z][A-Za-z ()/]+:', stream[j]['text']) and not re.search(r'\b(Body Slot|Caster Level|Aura|Activation):', stream[j]['text'][:200]):
                summary = stream[j]['text'][:200]
                break
        title = e['title']
        meta = meta_for(kind, own_text, title)
        if kind in ('feat', 'item'):
            title = re.sub(r'\s*\[[^\]]+\]\s*$', '', title)
        crm = re.search(r'\s+CR\s+([\d/]+)\s*$', title)
        if crm:
            title = title[:crm.start()]
            meta.setdefault('cr', crm.group(1))
        entries.append({
            'book': book_id, 'anchor': anchors[i], 'title': title,
            'kind': kind, 'level': lvl, 'parent': parent, 'path': ' › '.join(path[-3:]), 'page': e['page'],
            'start': i, 'end': end, 'summary': summary, 'meta': meta, 'text': own_text,
            'outline': 1 if e.get('o') else 0,
        })
    mark_prestige_classes(stream, entries)
    flatten_leaf_entries(entries)
    entries = add_run_in_entries(stream, blocks, entries, used)
    return blocks, entries


LEAF_KINDS = {'feat', 'spell', 'item', 'trap', 'power'}


def flatten_leaf_entries(entries):
    """A feat, spell or item never contains another one. When a book sets consecutive feats
    in two heading sizes, the smaller ones looked like sub-sections of the previous feat: end
    the entry where the next leaf entry starts, and make that one a sibling."""
    for k, e in enumerate(entries):
        if e['kind'] not in LEAF_KINDS:
            continue
        for f in entries[k + 1:]:
            if f['start'] >= e['end']:
                break
            if f['kind'] in LEAF_KINDS and f['level'] > e['level']:
                e['end'] = f['start']
                f['level'] = e['level']
                f['parent'] = e['parent']
                f['path'] = e['path']
                break


RUN_IN = re.compile(r'^(?:<i>)?<b>\s*([^<]{2,70}?)\s*(?:</b>)?\s*(?:</i>)?\s*[:.]\s*(?:</b>)?|^(?:<i>)?<b>\s*([^<]{2,70}?)[:.]\s*</b>')
NOT_NAMES = {x.lower() for x in STAT_LABELS} | {
    'benefit', 'benefits', 'normal', 'special', 'prerequisite', 'prerequisites', 'requirements', 'cost', 'cost to create',
    'faint', 'moderate', 'strong', 'overwhelming', 'market price', 'note', 'example', 'variant', 'combat', 'tactics',
    'description', 'lore', 'activation', 'effect', 'trigger', 'reset', 'bypass', 'search', 'disable device', 'hp', 'ac',
    'sq', 'sa', 'atk', 'full atk', 'spd', 'init', 'cr', 'possessions', 'languages', 'spells known', 'spells prepared',
    'hook', 'construction', 'materials', 'focus', 'xp cost', 'material component', 'arcane focus', 'divine focus',
    'level', 'school', 'class skills', 'skill points', 'hit die', 'weapon and armor proficiency', 'spells per day',
}
FEAT_LEAD = re.compile(r'^([A-Z][A-Za-z’\'\- ]{2,50}?)\s*\[([A-Z][A-Za-z ,\-]{2,40})\]\s')
TRAP_RE = re.compile(r'\bCR \d+;\s*(mechanical|magic device|magical)', re.I)
ITEM_RE = re.compile(r'\b(?:Market )?Price(?: \(Item Level\))?:?\s*\+?[\d,]+\s*gp|\bCL \d+(?:st|nd|rd|th)\b.{0,200}\bPrice\b', re.S)


def run_in_kind(text):
    head = text[:1500]
    if TRAP_RE.search(head):
        return 'trap'
    if re.search(r'\bLevel:\s*[A-Z]', head) and re.search(r'\b(Components|Casting Time):', head):
        return 'spell'
    if re.search(r'(^|\s)Benefit:', head):
        return 'feat'
    if re.search(r'\bPortfolio:', head) and re.search(r'\b(Domains|Alignment):', head):
        return 'deity'
    if ITEM_RE.search(head):
        return 'item'
    if re.search(r'\bCR \d+;', head[:300]) and re.search(r'\bhp \d+', head) and re.search(r'\bAC \d+', head):
        return 'monster'
    return None


def add_run_in_entries(stream, blocks, entries, used):
    """Entries whose name is a bold lead-in at the start of a paragraph (“Amulet of Health:
    This amulet…”, “Basic Arrow Trap: CR 1; mechanical…”). A run of such paragraphs under a
    heading becomes one entry per name when its text carries a stat marker (price, Benefit,
    spell stats, trap or monster stats).
    """
    heads = [i for i, e in enumerate(stream) if e['t'] == 'h']
    by_start = {e['start']: e for e in entries}
    out = []
    bounds = heads + [len(stream)]
    for k, h in enumerate(heads):
        parent = by_start.get(h)
        region_end = bounds[k + 1]
        leads = []
        for j in range(h + 1, region_end):
            e = stream[j]
            if e['t'] != 'p':
                continue
            m = RUN_IN.match(e['html'])
            fm = None if m else FEAT_LEAD.match(e['text'])
            if not m and not fm:
                continue
            if fm:
                name = fm.group(1).strip()
                if len(name.split()) > 6:
                    continue
                leads.append((j, name + ' [' + fm.group(2) + ']'))
                continue
            name = re.sub(r'\s+', ' ', (m.group(1) or m.group(2) or '')).strip().rstrip(':.').strip()
            words = name.split()
            if not words or len(words) > 9 or not name[:1].isupper() or name.lower() in NOT_NAMES:
                continue
            if re.match(r'^[\d(+–\-]', name) or re.search(r'\b(Ex|Su|Sp)\)?$', name):
                continue  # “+2:”, special abilities “(Ex)”
            leads.append((j, name))
        if len(leads) < 1 or parent is None:
            continue
        made = []
        for n, (j, name) in enumerate(leads):
            end = leads[n + 1][0] if n + 1 < len(leads) else region_end
            text = ' '.join(element_text(stream[x]) for x in range(j, end))
            kind = run_in_kind(text)
            if not kind:
                continue
            made.append((j, end, name, kind, text))
        # A single marker that is already the heading's own entry (e.g. one feat under its own
        # heading) needs no sub-entry.
        if len(made) == 1 and parent['kind'] == made[0][3]:
            continue
        for j, end, name, kind, text in made:
            tagged = name
            name = re.sub(r'\s*\[[^\]]+\]$', '', name)
            title = smart_title(name)
            a = slug(title); base = a; c = 2
            while a in used:
                a = f'{base}-{c}'; c += 1
            used.add(a)
            blocks[j] = blocks[j].replace('<p>', f'<p id="{a}">', 1)
            body = re.sub(r'^\s*' + re.escape(name) + r'\s*(\[[^\]]+\])?\s*[:.]?\s*', '', text)
            meta = meta_for(kind if kind != 'trap' else 'item', text, smart_title(tagged))
            if kind == 'trap':
                cr = re.search(r'\bCR (\d+)', text)
                meta = {'cr': cr.group(1)} if cr else {}
            path = (parent['path'] + ' › ' if parent['path'] else '') + parent['title']
            out.append({
                'book': parent['book'], 'anchor': a, 'title': title, 'kind': kind, 'level': parent['level'] + 1,
                'parent': parent['title'], 'path': ' › '.join(path.split(' › ')[-3:]), 'page': stream[j]['page'],
                'start': j, 'end': end, 'summary': body[:200], 'meta': meta, 'text': text,
            })
        if made and parent['kind'] in ('item', 'feat', 'spell', 'trap', 'monster') and len(made) > 1:
            parent['kind'] = 'rule'  # a container of many entries, not an entry itself
    return sorted(entries + out, key=lambda e: e['start'])


def _norm(t):
    import unicodedata
    t = unicodedata.normalize('NFKD', t.replace('ı', 'i')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z]', '', t.lower())


QUALIFY = re.compile(r'To qualify to become (?:an? |the )?(.{3,70}?),?\s+(?:an? )?(?:character|creature|candidate|dragon)\b')


def mark_prestige_classes(stream, entries):
    """“To qualify to become a dark hunter, a character must…” names the prestige class.

    The class's heading is the nearest earlier entry with that name (or the next one, when
    an OCR bookmark landed a little early). In some books its Requirements / Class Skills /
    Class Features headings are children; in others (DMG) they are siblings at the same
    level, so the class entry is extended to cover them.
    """
    def same(title, name):
        t = _norm(re.sub(r'\s*\(.*\)$', '', title))
        if not t:
            return False
        return t == name or t + 's' == name or t == name + 's' or (len(t) >= 5 and (name.startswith(t) or t.startswith(name)))

    targets = []
    for k, ent in enumerate(entries):
        for m in QUALIFY.finditer(ent['text']):
            raw = re.sub(r'\([^)]*\)', '', m.group(1))
            raw = re.sub(r'\s+of a particular (deity|god|faith)$', '', raw.strip())
            name = _norm(raw)
            if len(name) < 4:
                continue
            order = list(range(k, max(-1, k - 15), -1)) + list(range(k + 1, min(len(entries), k + 3)))
            for j in order:
                if same(entries[j]['title'], name):
                    targets.append(j)
                    break
    targets = sorted(set(targets))
    starts = {entries[j]['start'] for j in targets}
    for j in targets:
        e = entries[j]
        e['kind'] = 'prestige'
        e['meta'] = {}
        lvl = e['level']
        end = len(stream)
        for x in range(e['start'] + 1, len(stream)):
            if stream[x]['t'] == 'h' and (stream[x]['level'] < lvl or x in starts or
                                          (stream[x]['level'] == lvl and re.match(r'(?i)^(chapter|appendix|table of contents|index)\b', stream[x]['title']))):
                end = x
                break
        e['end'] = max(e['end'], end)
        hd = re.search(r'\bHit Die:\s*(d\d+)', ' '.join(element_text(stream[x]) for x in range(e['start'], min(e['end'], e['start'] + 80))))
        if hd:
            e['meta']['hd'] = hd.group(1)


# ---------------------------------------------------------------------------- database

def write_db(results):
    os.makedirs(BUILD, exist_ok=True)
    if os.path.exists(OUT_DB):
        os.remove(OUT_DB)
    db = sqlite3.connect(OUT_DB)
    db.executescript("""
      PRAGMA page_size = 4096; PRAGMA journal_mode = DELETE;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, short TEXT, shelf TEXT, edition TEXT, pages INTEGER, ord INTEGER);
      CREATE TABLE chunks (book TEXT, n INTEGER, data BLOB, PRIMARY KEY (book, n)) WITHOUT ROWID;
      CREATE TABLE entries (id INTEGER PRIMARY KEY, book TEXT, anchor TEXT, title TEXT COLLATE NOCASE, kind TEXT, level INTEGER,
                            parent TEXT, path TEXT, page INTEGER, start INTEGER, "end" INTEGER, summary TEXT, meta TEXT,
                            outline INTEGER DEFAULT 0);
      CREATE VIRTUAL TABLE fts USING fts5(title, body, content='', tokenize='unicode61 remove_diacritics 2');
    """)
    CHUNK = 200
    eid = 0
    for ordn, (b, blocks, entries, pages) in enumerate(results):
        db.execute('INSERT INTO books VALUES (?,?,?,?,?,?,?)', (b[0], b[2], b[3], b[4], b[5], pages, ordn))
        for n in range(0, len(blocks), CHUNK):
            db.execute('INSERT INTO chunks VALUES (?,?,?)', (b[0], n // CHUNK, zlib.compress(json.dumps(blocks[n:n + CHUNK]).encode(), 9)[2:-4]))
        for e in entries:
            eid += 1
            db.execute('INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
                eid, e['book'], e['anchor'], e['title'], e['kind'], e['level'], e['parent'], e['path'], e['page'],
                e['start'], e['end'], e['summary'], json.dumps(e['meta']) if e['meta'] else None, e.get('outline', 0)))
            db.execute('INSERT INTO fts (rowid, title, body) VALUES (?,?,?)', (eid, e['title'], e['text']))
    db.executescript("""
      CREATE INDEX entries_book ON entries(book, start);
      CREATE INDEX entries_kind ON entries(kind, title);
      CREATE INDEX entries_title ON entries(title);
      INSERT INTO fts(fts) VALUES('optimize');
    """)
    version = time.strftime('%Y%m%dT%H%M', time.gmtime())
    db.execute('INSERT INTO meta VALUES (?,?)', ('version', version))
    db.execute('INSERT INTO meta VALUES (?,?)', ('chunk', str(CHUNK)))
    db.commit()
    db.execute('VACUUM')
    db.close()
    return version


def main():
    books_dir = sys.argv[1]
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    # Vocabulary for judging OCR quality, from the books that have a real text layer.
    import pymupdf
    vocab_path = os.path.join(BUILD, 'vocab.txt')
    if not os.path.exists(vocab_path):
        words = collections.Counter()
        for fname in ('Players-Handbook.pdf', 'DMG-Special-Edition.pdf', 'Monster-Manual.pdf', 'Forgotten-Realms-Campaign-Setting.pdf',
                      'Players-Guide-to-Faerun.pdf', 'Lost-Empires-of-Faerun.pdf', 'Magic-of-Faerun.pdf', 'Unapproachable-East.pdf'):
            path = os.path.join(books_dir, fname)
            if os.path.exists(path):
                doc = pymupdf.open(path)
                for pg in doc:
                    text = pg.get_text().translate(str.maketrans({'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl'}))
                    for w in re.findall(r"[A-Za-zÀ-ÿ]+(?:['’][a-z]+)?", text):
                        words[w.lower()] += 1
        os.makedirs(BUILD, exist_ok=True)
        with open(vocab_path, 'w') as f:
            f.write('\n'.join(w for w, n in words.items() if n >= 2 or len(w) > 5))
    set_vocabulary(open(vocab_path).read().split('\n'))
    results = []
    report = []
    for b in BOOKS:
        bid, fname = b[0], b[1]
        if only and bid not in only:
            continue
        pdf = os.path.join(books_dir, fname)
        ocr = os.path.join(books_dir, 'ocr', fname.replace('.pdf', '.json'))
        if not os.path.exists(pdf):
            print(f'  ! missing {fname}, skipped'); continue
        t = time.time()
        cache_dir = os.path.join(BUILD, 'streams')
        os.makedirs(cache_dir, exist_ok=True)
        import hashlib
        words = os.path.join(books_dir, 'ocr', fname.replace('.pdf', '.words.json'))
        key = hashlib.sha1(open(os.path.join(os.path.dirname(__file__), 'extract.py'), 'rb').read() + str(os.path.getmtime(pdf)).encode()
                           + (str(os.path.getmtime(words)).encode() if os.path.exists(words) else b'')).hexdigest()[:12]
        cached = os.path.join(cache_dir, f'{bid}-{key}.json')
        if os.path.exists(cached):
            stream, info = json.load(open(cached))
        elif os.path.exists(ocr):
            stream, info = extract(pdf_path=pdf, ocr_path=ocr)
        else:
            import pymupdf
            doc = pymupdf.open(pdf)
            sample = range(min(20, doc.page_count - 1), min(doc.page_count, 60), 5)
            if sum(len(doc[i].get_text()) for i in sample) < 200 * len(sample):
                print(f'  ! {bid}: scanned book without OCR cache yet ({fname}) — skipped'); continue
            stream, info = extract(pdf_path=pdf, words_path=words if os.path.exists(words) else None)
        if not os.path.exists(cached):
            for old in os.listdir(cache_dir):
                if old.startswith(bid + '-'):
                    os.remove(os.path.join(cache_dir, old))
            json.dump([stream, info], open(cached, 'w'))
        blocks, entries = process_book(bid, stream)
        kinds = collections.Counter(e['kind'] for e in entries)
        chars = sum(len(e['text']) for e in entries)
        report.append((bid, info['pages'], len(entries), chars, dict(kinds)))
        print(f"{bid:5} {info['pages']:4}p {len(entries):5} entries {chars/1e6:5.2f}M chars  {dict(kinds)}  ({time.time()-t:.0f}s)", flush=True)
        results.append((b, blocks, entries, info['pages']))
    version = write_db(results)
    size = os.path.getsize(OUT_DB)
    print(f'books.db {size/1e6:.1f} MB, version {version}')
    if '--no-pack' not in sys.argv:
        pw = os.environ.get('BOOKS_PASSPHRASE')
        if not pw:
            print('BOOKS_PASSPHRASE not set: not packing (the database stays private in data-build/).')
            return
        manifest_extra = json.dumps({'bookCount': len(results)})  # titles stay inside the encrypted database
        subprocess.run(['node', '--input-type=module', '-e', f"""
import {{ packDatabase }} from '{ROOT}/scripts/lib/pack.mjs';
const m = packDatabase('{OUT_DB}', '{ROOT}/public/data/books', {{ name: 'books', version: '{version}', passphrase: process.env.BOOKS_PASSPHRASE, extra: {manifest_extra} }});
console.log('packed', m.parts.length, 'encrypted parts,', (m.downloadBytes/1e6).toFixed(1), 'MB download');
"""], check=True, env={**os.environ, 'NODE_NO_WARNINGS': '1'})


if __name__ == '__main__':
    main()
