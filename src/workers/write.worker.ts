/// <reference lib="webworker" />
// Lab: on-device written answers with a small open language model (WebGPU).
//
// This is a test bench, not part of the app's offline set: transformers.js v4 and its ONNX
// Runtime files are hosted with the app (public/lab/, copied by scripts/copy-lab.mjs); the
// model files come from Hugging Face (free, no account) and are kept in the browser's private
// file storage (OPFS, folder "lab-models"), so each model downloads once per device.

type Msg =
  | { id: number; op: 'probe'; base: string }
  | { id: number; op: 'load'; model: string; dtype: string; device: string }
  | { id: number; op: 'generate'; messages: { role: string; content: string }[]; max: number }
  | { id: number; op: 'unload' }
  | { id: number; op: 'stored'; models: string[]; dtype: string }
  | { id: number; op: 'download'; model: string; dtype: string }
  | { id: number; op: 'clear' };

// ------------------------------------------------------------------ downloads
// Model files are written to the browser's private file storage (OPFS) piece by piece as they
// arrive, so memory stays flat however big the file (Safari's Cache API holds a whole file in
// memory while storing it, which killed the page on the 760 MB models). transformers.js reads
// them back through a custom cache. A download is kept even if preparing the model fails.
const HF = 'https://huggingface.co/';
const OLD_CACHE = 'transformers-cache'; // where earlier test versions stored models
const DIR = 'lab-models';
const fileUrl = (model: string, f: string) => `${HF}${model}/resolve/main/${f}`;
const fname = (url: string) => url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');

let dirP: Promise<FileSystemDirectoryHandle> | null = null;
const dir = () => (dirP ??= navigator.storage.getDirectory().then((r) => r.getDirectoryHandle(DIR, { create: true })));

async function opfsFile(url: string): Promise<File | null> {
  try {
    const d = await dir();
    await d.getFileHandle(`${fname(url)}.ok`); // written only after the file is complete
    return await (await d.getFileHandle(fname(url))).getFile();
  } catch {
    return null;
  }
}

async function has(url: string) {
  if (await opfsFile(url)) return true;
  try {
    return !!(await (await caches.open(OLD_CACHE)).match(url));
  } catch {
    return false;
  }
}

/** Stream a response body into OPFS without holding it in memory. */
async function store(url: string, body: ReadableStream<Uint8Array>, onBytes?: (n: number) => void) {
  const d = await dir();
  try {
    await d.removeEntry(`${fname(url)}.ok`);
  } catch {
    /* not there */
  }
  const fh = await d.getFileHandle(fname(url), { create: true });
  const h = await (fh as any).createSyncAccessHandle();
  try {
    h.truncate(0);
    let at = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      at += h.write(value, { at });
      onBytes?.(value.byteLength);
    }
    h.truncate(at);
    h.flush();
  } finally {
    h.close();
  }
  await d.getFileHandle(`${fname(url)}.ok`, { create: true });
}

// transformers.js asks this "cache" for every file before downloading it
const customCache = {
  async match(req: string | Request) {
    const url = typeof req === 'string' ? req : req.url;
    const f = await opfsFile(url);
    if (f) return new Response(f, { headers: { 'content-length': String(f.size), 'content-type': 'application/octet-stream' } });
    try {
      return (await (await caches.open(OLD_CACHE)).match(url)) || undefined;
    } catch {
      return undefined;
    }
  },
  async put(req: string | Request, res: Response) {
    const url = typeof req === 'string' ? req : req.url;
    if (res.body) await store(url, res.body);
  },
};

// Same rule transformers.js uses: config.json → transformers.js_config.use_external_data_format
// says whether the weights sit in separate .onnx_data files, and how many.
async function bigFiles(model: string, dtype: string): Promise<{ name: string; size: number }[]> {
  const r = await fetch(fileUrl(model, 'config.json'));
  if (!r.ok) throw new Error(`Could not reach Hugging Face (${r.status})`);
  const ext = (await r.json())?.['transformers.js_config']?.use_external_data_format;
  const onnx = `model_${dtype}.onnx`;
  const raw = ext && typeof ext === 'object' ? ext[onnx] ?? ext['model.onnx'] : ext;
  const chunks = raw === true ? 1 : typeof raw === 'number' ? raw : 0;
  const names = [`onnx/${onnx}`];
  for (let i = 0; i < chunks; i++) names.push(`onnx/${onnx}_data${i ? `_${i}` : ''}`);
  // sizes for the progress bar (HEAD follows the redirect to the file server)
  return Promise.all(
    names.map(async (name) => {
      try {
        const h = await fetch(fileUrl(model, name), { method: 'HEAD' });
        return { name, size: Number(h.headers.get('content-length') || 0) };
      } catch {
        return { name, size: 0 };
      }
    }),
  );
}

// list of a model's big files, recorded when its download finishes
const indexUrl = (model: string, dtype: string) => `${HF}__lab__/${model}/${dtype}.json`;

async function isStored(model: string, dtype: string) {
  try {
    const idx = await opfsFile(indexUrl(model, dtype));
    let names: string[] | null = idx ? JSON.parse(await idx.text()) : null;
    if (!names) {
      // earlier test version: index in the Cache API (external-data names only)
      const old = await (await caches.open(OLD_CACHE)).match(`${HF}__lab__/${model}/${dtype}`);
      if (!old) return false;
      names = [`onnx/model_${dtype}.onnx`, ...((await old.json()) as string[])];
    }
    for (const n of names) if (!(await has(fileUrl(model, n)))) return false;
    return true;
  } catch {
    return false;
  }
}

async function download(id: number, model: string, dtype: string) {
  const files = await bigFiles(model, dtype);
  const total = files.reduce((a, f) => a + f.size, 0);
  let done = 0;
  let last = 0;
  const tick = (n: number) => {
    done += n;
    if (done - last > 2e6) {
      last = done;
      post({ id, progress: { loaded: done, total } });
    }
  };
  for (const f of files) {
    const url = fileUrl(model, f.name);
    if (await has(url)) {
      tick(f.size);
      continue;
    }
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed: ${f.name} (${res.status})`);
    await store(url, res.body, tick);
  }
  const names = files.map((f) => f.name);
  await store(indexUrl(model, dtype), new Response(JSON.stringify(names)).body!);
  post({ id, progress: { loaded: total, total } });
}

async function clearAll() {
  try {
    await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true });
  } catch {
    /* nothing stored */
  }
  dirP = null;
  await caches.delete(OLD_CACHE);
}

let T: any = null;
let tok: any = null;
let model: any = null;
let loadedId = '';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

let base = '';
async function lib() {
  if (!T) {
    T = await import(/* @vite-ignore */ `${base}lab/transformers.min.js`);
    T.env.allowLocalModels = false;
    T.env.backends.onnx.wasm.wasmPaths = `${base}lab/`;
    T.env.useBrowserCache = false;
    T.env.useCustomCache = true;
    T.env.customCache = customCache;
  }
  return T;
}

async function probe() {
  const gpu = (navigator as any).gpu;
  const out: Record<string, unknown> = { webgpu: !!gpu, f16: false, adapter: '' };
  if (gpu) {
    try {
      const a = await gpu.requestAdapter();
      if (a) {
        out.f16 = a.features.has('shader-f16');
        const info = a.info || {};
        out.adapter = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
        out.maxBuffer = Math.round(Number(a.limits?.maxBufferSize || 0) / 1e6);
      } else out.webgpu = false;
    } catch {
      out.webgpu = false;
    }
  }
  out.cores = navigator.hardwareConcurrency;
  out.memory = (navigator as any).deviceMemory;
  return out;
}

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  const reply = (data: unknown) => post({ id: m.id, ok: true, data });
  try {
    if (m.op === 'clear') {
      await model?.dispose?.();
      model = tok = null;
      loadedId = '';
      await clearAll();
      reply(true);
    } else if (m.op === 'stored') {
      const out: Record<string, boolean> = {};
      for (const mid of m.models) out[mid] = await isStored(mid, m.dtype);
      reply(out);
    } else if (m.op === 'download') {
      await download(m.id, m.model, m.dtype);
      reply(true);
    } else if (m.op === 'probe') {
      base = m.base;
      reply(await probe());
    }
    else if (m.op === 'unload') {
      await model?.dispose?.();
      model = tok = null;
      loadedId = '';
      reply(true);
    } else if (m.op === 'load') {
      const t = await lib();
      if (model && loadedId !== `${m.model}|${m.dtype}|${m.device}`) {
        await model.dispose?.();
        model = null;
      }
      const t0 = performance.now();
      const progress_callback = (p: any) => {
        if (p.status === 'progress_total') post({ id: m.id, progress: { loaded: p.loaded, total: p.total } });
      };
      tok = await t.AutoTokenizer.from_pretrained(m.model, { progress_callback });
      model = await t.AutoModelForCausalLM.from_pretrained(m.model, { dtype: m.dtype, device: m.device, progress_callback });
      const t1 = performance.now();
      // first run compiles the GPU shaders; time it separately
      const warm = tok.apply_chat_template([{ role: 'user', content: 'Hi' }], { add_generation_prompt: true, return_dict: true, enable_thinking: false });
      await model.generate({ ...warm, max_new_tokens: 2, do_sample: false });
      loadedId = `${m.model}|${m.dtype}|${m.device}`;
      reply({ loadMs: Math.round(t1 - t0), warmMs: Math.round(performance.now() - t1) });
    } else if (m.op === 'generate') {
      const t = await lib();
      if (!model) throw new Error('No model loaded');
      const inputs = tok.apply_chat_template(m.messages, { add_generation_prompt: true, return_dict: true, enable_thinking: false });
      const promptTokens = inputs.input_ids.dims.at(-1);
      const t0 = performance.now();
      let first = 0;
      let n = 0;
      const streamer = new t.TextStreamer(tok, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => post({ id: m.id, text }),
        token_callback_function: () => {
          if (!n++) first = performance.now();
        },
      });
      await model.generate({ ...inputs, max_new_tokens: m.max, do_sample: false, repetition_penalty: 1.1, streamer });
      const end = performance.now();
      reply({
        promptTokens,
        tokens: n,
        firstMs: Math.round(first - t0), // reading the sources (prefill) + first word
        tokPerSec: n > 1 ? Math.round(((n - 1) / (end - first)) * 10000) / 10 : 0,
        totalMs: Math.round(end - t0),
      });
    }
  } catch (e) {
    post({ id: m.id, ok: false, error: String((e as Error)?.message || e) });
  }
};
