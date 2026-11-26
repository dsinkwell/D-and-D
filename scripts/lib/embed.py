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
