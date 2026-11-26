"""OCR a scanned PDF (no text layer) into a JSON cache of text lines with positions and sizes.

    python3 scripts/books/ocr_pages.py BOOK.pdf OUT.json [--workers 4] [--dpi 300]

Output: {"pages": [ {"w": .., "h": .., "lines": [{"text", "bbox": [x0,y0,x1,y1], "size", "bold"}]} ]}
The cache is consumed by build_books.py exactly like text extracted from a normal PDF.
"""
import json, os, sys, glob
from concurrent.futures import ProcessPoolExecutor
import pymupdf

TESSDATA = next(iter(glob.glob('/usr/share/tesseract-ocr/*/tessdata')), None)


def ocr_range(args):
    path, start, end, dpi = args
    doc = pymupdf.open(path)
    out = []
    for i in range(start, end):
        page = doc[i]
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
        out.append({'w': page.rect.width, 'h': page.rect.height, 'lines': lines})
    return start, out


def main():
    path, outp = sys.argv[1], sys.argv[2]
    workers = int(sys.argv[sys.argv.index('--workers') + 1]) if '--workers' in sys.argv else 4
    dpi = int(sys.argv[sys.argv.index('--dpi') + 1]) if '--dpi' in sys.argv else 300
    n = pymupdf.open(path).page_count
    step = 4
    jobs = [(path, s, min(n, s + step), dpi) for s in range(0, n, step)]
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
