"""Ask-box meaning index for the 3.5 SRD → public/ask/srd-passages.json + public/ask/srd-vectors.i8
(committed: the SRD text never changes, so this only needs re-running if build-srd changes).

    npm run build:srd && python3 scripts/ask/embed_srd.py
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from embed import ROOT, chunk_blocks, embed_cached, html_text, model_id  # noqa: E402

SRD = os.path.join(ROOT, 'public', 'srd')
OUT = os.path.join(ROOT, 'public', 'ask')


def main():
    entries = json.load(open(os.path.join(SRD, 'entries.json')))
    docs = {}
    refs, texts = [], []
    for e in entries:
        doc = docs.get(e['d']) or json.load(open(os.path.join(SRD, 'docs', e['d'] + '.json')))
        docs[e['d']] = doc
        blocks = doc['blocks']
        lo = e['s'] + (1 if blocks[e['s']].startswith('<h') else 0)
        seg = [html_text(b) for b in blocks[lo:e['e']]]
        rule = e['c'] == 'rule'
        for a, z, text in chunk_blocks(seg, target=700 if rule else 900, max_chunks=12 if rule else 1):
            refs.append([e['i'], lo + a, lo + z])
            texts.append(f"{e['t']}. {text}"[:1200])
    vecs = embed_cached(texts)
    os.makedirs(OUT, exist_ok=True)
    json.dump({'model': model_id(), 'dims': 384, 'passages': refs}, open(os.path.join(OUT, 'srd-passages.json'), 'w'), separators=(',', ':'))
    vecs.tofile(os.path.join(OUT, 'srd-vectors.i8'))
    print(f'SRD meaning index: {len(refs)} passages, {vecs.nbytes / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
