/// <reference lib="webworker" />
// Ask box worker: turns a question into a meaning vector (bge-small-en-v1.5, run locally with
// ONNX WebAssembly) and finds the closest passages in the SRD, books and wiki indexes.
//
// Vectors are int8 (384 per passage). A 1-bit signature of every vector is scanned first
// (popcount, a few ms for ~110k passages); the best candidates are then re-scored exactly.
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

const DIMS = 384;
const WORDS = DIMS / 32;
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

type Msg =
  | { id: number; op: 'init'; base: string }
  | { id: number; op: 'load'; source: string; data: ArrayBuffer }
  | { id: number; op: 'search'; q: string; k: number; sources?: string[] }
  | { id: number; op: 'has' };

interface Index {
  vec: Int8Array;
  sig: Uint32Array;
  n: number;
}

const indexes = new Map<string, Index>();
let extractor: Promise<FeatureExtractionPipeline> | null = null;

function popcount(x: number) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function signatures(vec: Int8Array, n: number) {
  const sig = new Uint32Array(n * WORDS);
  for (let i = 0, o = 0; i < n; i++, o += DIMS) {
    for (let d = 0; d < DIMS; d++) if (vec[o + d] > 0) sig[i * WORDS + (d >> 5)] |= 1 << (d & 31);
  }
  return sig;
}

async function embedQuery(q: string) {
  const ex = await extractor!;
  const out = await ex(QUERY_PREFIX + q, { pooling: 'cls', normalize: true });
  const f = out.data as Float32Array;
  const v = new Int8Array(DIMS);
  for (let d = 0; d < DIMS; d++) v[d] = Math.max(-127, Math.min(127, Math.round(f[d] * 127)));
  return v;
}

function search(q: Int8Array, k: number, sources?: string[]) {
  const qs = new Uint32Array(WORDS);
  for (let d = 0; d < DIMS; d++) if (q[d] > 0) qs[d >> 5] |= 1 << (d & 31);
  const hits: { source: string; i: number; score: number }[] = [];
  for (const [source, ix] of indexes) {
    if (sources && !sources.includes(source)) continue;
    // stage 1: Hamming distance on signatures, keep the closest candidates
    const keep = Math.min(ix.n, Math.max(400, k * 40));
    const dist = new Uint16Array(ix.n);
    for (let i = 0, o = 0; i < ix.n; i++, o += WORDS) {
      let a = 0;
      for (let w = 0; w < WORDS; w++) a += popcount(ix.sig[o + w] ^ qs[w]);
      dist[i] = a;
    }
    // counting sort by distance to pick the `keep` nearest without sorting everything
    const hist = new Uint32Array(DIMS + 1);
    for (let i = 0; i < ix.n; i++) hist[dist[i]]++;
    let cut = 0;
    for (let acc = 0; cut <= DIMS; cut++) {
      acc += hist[cut];
      if (acc >= keep) break;
    }
    // stage 2: exact int8 dot product
    for (let i = 0; i < ix.n; i++) {
      if (dist[i] > cut) continue;
      let s = 0;
      const o = i * DIMS;
      for (let d = 0; d < DIMS; d++) s += ix.vec[o + d] * q[d];
      hits.push({ source, i, score: s / (127 * 127) });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  const reply = (data: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage({ id: m.id, ok: true, data }, transfer);
  try {
    if (m.op === 'init') {
      if (!extractor) {
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = `${m.base}models/`;
        env.useBrowserCache = false; // the service worker caches the model files
        env.backends.onnx.wasm!.wasmPaths = `${m.base}ort/`;
        env.backends.onnx.wasm!.numThreads = 1;
        extractor = (pipeline as (...a: unknown[]) => Promise<FeatureExtractionPipeline>)('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'q8' });
        extractor.catch(() => (extractor = null));
      }
      await extractor;
      reply(true);
    } else if (m.op === 'load') {
      const vec = new Int8Array(m.data);
      const n = Math.floor(vec.length / DIMS);
      indexes.set(m.source, { vec, sig: signatures(vec, n), n });
      reply(n);
    } else if (m.op === 'has') {
      reply(Object.fromEntries([...indexes].map(([k, v]) => [k, v.n])));
    } else if (m.op === 'search') {
      const t0 = performance.now();
      const q = await embedQuery(m.q);
      const t1 = performance.now();
      const hits = search(q, m.k, m.sources);
      reply({ hits, ms: { embed: Math.round(t1 - t0), search: Math.round(performance.now() - t1) } });
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: String((e as Error)?.message || e) });
  }
};
