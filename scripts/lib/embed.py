"""Sentence embeddings with the same ONNX model the app runs in the browser (bge-small-en-v1.5,
int8), so vectors computed at build time match the ones computed for questions on the device.

CLS pooling + L2 normalisation, as transformers.js `pipeline('feature-extraction', …,
{ pooling: 'cls', normalize: true })`. Questions get the BGE query prefix; passages don't.
"""
import os

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODEL_DIR = os.path.join(ROOT, 'public', 'models', 'Xenova', 'bge-small-en-v1.5')
QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
MAX_TOKENS = 256  # passages are trimmed to this many tokens (questions are short)


class Embedder:
    def __init__(self, threads=None):
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads or os.cpu_count() or 4
        self.sess = ort.InferenceSession(os.path.join(MODEL_DIR, 'onnx', 'model_quantized.onnx'), so, providers=['CPUExecutionProvider'])
        self.tok = Tokenizer.from_file(os.path.join(MODEL_DIR, 'tokenizer.json'))
        self.tok.enable_truncation(MAX_TOKENS)
        self.inputs = {i.name for i in self.sess.get_inputs()}

    def embed(self, texts, batch=32):
        out = []
        # sort by length so batches pad less; restore order afterwards
        order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
        vecs = [None] * len(texts)
        for s in range(0, len(order), batch):
            idx = order[s:s + batch]
            enc = self.tok.encode_batch([texts[i] for i in idx])
            n = max(len(e.ids) for e in enc)
            ids = np.zeros((len(enc), n), dtype=np.int64)
            mask = np.zeros((len(enc), n), dtype=np.int64)
            for k, e in enumerate(enc):
                ids[k, :len(e.ids)] = e.ids
                mask[k, :len(e.ids)] = 1
            feed = {'input_ids': ids, 'attention_mask': mask}
            if 'token_type_ids' in self.inputs:
                feed['token_type_ids'] = np.zeros_like(ids)
            hidden = self.sess.run(None, feed)[0]  # (b, n, 384)
            cls = hidden[:, 0, :]
            cls = cls / np.linalg.norm(cls, axis=1, keepdims=True)
            for k, i in enumerate(idx):
                vecs[i] = cls[k]
        return np.stack(vecs).astype(np.float32) if vecs else np.zeros((0, 384), np.float32)


def quantize(vecs):
    """float32 unit vectors → int8 (scale 127). Dot products of int8 vectors rank like the floats."""
    return np.clip(np.round(vecs * 127), -127, 127).astype(np.int8)


def model_id():
    import json
    lock = json.load(open(os.path.join(ROOT, 'scripts', 'models.lock.json')))
    return 'Xenova/bge-small-en-v1.5@' + lock['Xenova/bge-small-en-v1.5']['revision'][:12]


def embed_cached(texts, cache_path=None, log=print):
    """int8 vectors for texts, reusing earlier results from a small SQLite cache keyed by
    (model, text hash), so rebuilding only embeds passages that changed."""
    import hashlib, sqlite3
    cache_path = cache_path or os.path.join(ROOT, 'data-build', 'ask-cache.db')
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    db = sqlite3.connect(cache_path)
    db.execute('CREATE TABLE IF NOT EXISTS v (k TEXT PRIMARY KEY, vec BLOB)')
    mid = model_id()
    keys = [hashlib.sha1((mid + '\n' + t).encode()).hexdigest() for t in texts]
    have = {}
    for i in range(0, len(keys), 900):
        chunk = keys[i:i + 900]
        for k, v in db.execute(f'SELECT k, vec FROM v WHERE k IN ({",".join("?" * len(chunk))})', chunk):
            have[k] = v
    todo = [i for i, k in enumerate(keys) if k not in have]
    if todo:
        log(f'  embedding {len(todo)} new passages ({len(texts) - len(todo)} cached)…')
        emb = Embedder()
        for s in range(0, len(todo), 2048):
            part = todo[s:s + 2048]
            q = quantize(emb.embed([texts[i] for i in part]))
            db.executemany('INSERT OR REPLACE INTO v VALUES (?,?)', [(keys[i], q[n].tobytes()) for n, i in enumerate(part)])
            db.commit()
            for n, i in enumerate(part):
                have[keys[i]] = q[n].tobytes()
            log(f'    {min(s + 2048, len(todo))}/{len(todo)}')
    out = np.frombuffer(b''.join(have[k] for k in keys), dtype=np.int8).reshape(len(keys), 384) if keys else np.zeros((0, 384), np.int8)
    db.close()
    return out


ROWS_PER_PART = 4096


def write_vector_tables(db, refs, vecs):
    """Store passages + vectors in a SQLite database the app downloads:
    ask_passages(id, ref, start, end, name) and ask_vectors(n, data) with ROWS_PER_PART vectors per row.
    `name` is set for a passage that is one run-in definition inside a section ("Longsword" in the
    PHB's weapon descriptions): the app shows it as the passage's title."""
    db.executescript('''
      DROP TABLE IF EXISTS ask_passages; DROP TABLE IF EXISTS ask_vectors;
      CREATE TABLE ask_passages (id INTEGER PRIMARY KEY, ref INTEGER, start INTEGER, "end" INTEGER, name TEXT);
      CREATE TABLE ask_vectors (n INTEGER PRIMARY KEY, data BLOB);
    ''')
    db.executemany('INSERT INTO ask_passages VALUES (?,?,?,?,?)', [(i, *r[:3], r[3] if len(r) > 3 else None) for i, r in enumerate(refs)])
    for n in range(0, len(vecs), ROWS_PER_PART):
        db.execute('INSERT INTO ask_vectors VALUES (?,?)', (n // ROWS_PER_PART, vecs[n:n + ROWS_PER_PART].tobytes()))
    db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
    db.execute("INSERT OR REPLACE INTO meta VALUES ('ask_model', ?)", (model_id(),))
    db.execute("INSERT OR REPLACE INTO meta VALUES ('ask_dims', '384')")
    db.commit()


def html_text(h):
    import html as _html, re
    return re.sub(r'\s+', ' ', _html.unescape(re.sub(r'<[^>]+>', ' ', h or ''))).strip()


def chunk_blocks(texts, target=700, max_chunks=12):
    """Group consecutive block texts into passages of about `target` characters.
    Returns [(first_index, end_index, text)]."""
    out, cur, start = [], [], 0
    for i, t in enumerate(texts):
        if not t:
            continue
        if not cur:
            start = i
        cur.append(t)
        if sum(len(x) for x in cur) >= target:
            out.append((start, i + 1, ' '.join(cur)))
            cur = []
            if len(out) >= max_chunks:
                return out
    if cur:
        out.append((start, len(texts), ' '.join(cur)))
    return out
