"""OCR a scanned PDF (no text layer) into a JSON cache of text lines with positions and sizes.

    python3 scripts/books/ocr_pages.py BOOK.pdf OUT.json [--workers 4] [--dpi 300]

Output: {"pages": [ {"w": .., "h": .., "lines": [{"text", "bbox": [x0,y0,x1,y1], "size", "bold"}], "words": [[x0,y0,x1,y1,text]]} ]}
Books whose PDF has a bad text layer (Magic Item Compendium) are OCRed to NAME.words.json instead: the
PDF keeps supplying layout and fonts, and only the words are replaced (see extract.py).
The cache is consumed by build_books.py exactly like text extracted from a normal PDF.
"""
import json, os, sys, glob
from concurrent.futures import ProcessPoolExecutor
import pymupdf

TESSDATA = next(iter(glob.glob('/usr/share/tesseract-ocr/*/tessdata')), None)


def ocr_page_direct(page, dpi):
    """Render the page and run the tesseract CLI on the image. Unlike PyMuPDF's OCR text page,
    this never mixes in a PDF's existing (possibly garbled) text layer."""
    import csv, io, subprocess, tempfile
    pix = page.get_pixmap(dpi=dpi)
    with tempfile.NamedTemporaryFile(suffix='.png') as f:
        pix.save(f.name)
        tsv = subprocess.run(['tesseract', f.name, 'stdout', '--psm', '3', 'tsv'], capture_output=True, text=True, check=True,
                             env={**os.environ, 'OMP_THREAD_LIMIT': '1'}).stdout
    sc = 72 / dpi
    words, lines = [], {}
    for r in csv.DictReader(io.StringIO(tsv), delimiter='\t', quoting=csv.QUOTE_NONE):
        if r['level'] != '5' or not (r['text'] or '').strip():
            continue
        x0, y0 = int(r['left']) * sc, int(r['top']) * sc
        x1, y1 = x0 + int(r['width']) * sc, y0 + int(r['height']) * sc
        words.append([round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1), r['text']])
        key = (r['block_num'], r['par_num'], r['line_num'])
        lines.setdefault(key, []).append((x0, y0, x1, y1, r['text'], r['block_num']))
    out_lines = []
    for key, ws in lines.items():
        x0 = min(w[0] for w in ws); y0 = min(w[1] for w in ws); x1 = max(w[2] for w in ws); y1 = max(w[3] for w in ws)
        out_lines.append({'text': ' '.join(w[4] for w in ws), 'bbox': [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
                          'size': round(y1 - y0, 1), 'bold': False, 'b': int(ws[0][5])})
    return {'w': page.rect.width, 'h': page.rect.height, 'lines': out_lines, 'words': words}


def ocr_range(args):
    path, start, end, dpi, direct = args
    doc = pymupdf.open(path)
    out = []
    for i in range(start, end):
        page = doc[i]
        if direct:
            try:
                out.append(ocr_page_direct(page, dpi))
            except Exception as e:
                out.append({'w': page.rect.width, 'h': page.rect.height, 'lines': [], 'words': [], 'error': str(e)})
            continue
        try:
            tp = page.get_textpage_ocr(language='eng', dpi=dpi, full=True, tessdata=TESSDATA)
            d = page.get_text('dict', textpage=tp)
        except Exception as e:  # keep going; record the failure
            out.append({'w': page.rect.width, 'h': page.rect.height, 'lines': [], 'error': str(e)})
            continue
        lines = []
        for bi, b in enumerate(d.get('blocks', [])):
            for l in b.get('lines', []):
                text = ' '.join(s['text'] for s in l['spans']).strip()
                if not text:
                    continue
                x0, y0, x1, y1 = l['bbox']
                lines.append({'text': text, 'bbox': [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)], 'size': round(y1 - y0, 1), 'bold': False, 'b': bi})
        words = [[round(w[0], 1), round(w[1], 1), round(w[2], 1), round(w[3], 1), w[4]] for w in page.get_text('words', textpage=tp)]
        out.append({'w': page.rect.width, 'h': page.rect.height, 'lines': lines, 'words': words})
    return start, out


def main():
    path, outp = sys.argv[1], sys.argv[2]
    workers = int(sys.argv[sys.argv.index('--workers') + 1]) if '--workers' in sys.argv else 4
    dpi = int(sys.argv[sys.argv.index('--dpi') + 1]) if '--dpi' in sys.argv else 300
    n = pymupdf.open(path).page_count
    step = 4
    direct = '--direct' in sys.argv or outp.endswith('.words.json')
    jobs = [(path, s, min(n, s + step), dpi, direct) for s in range(0, n, step)]
    pages = [None] * n
    done = 0
    with ProcessPoolExecutor(workers) as ex:
        for start, res in ex.map(ocr_range, jobs):
            for k, p in enumerate(res):
                pages[start + k] = p
            done += len(res)
            print(f'{os.path.basename(path)}: {done}/{n} pages', flush=True)
    with open(outp, 'w') as f:
        json.dump({'source': os.path.basename(path), 'pages': pages}, f)


if __name__ == '__main__':
    main()
