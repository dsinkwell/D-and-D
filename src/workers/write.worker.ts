/// <reference lib="webworker" />
// Lab: on-device written answers with a small open language model (WebGPU).
//
// This is a test bench, not part of the app's offline set: transformers.js v4 and its ONNX
// Runtime files are hosted with the app (public/lab/, copied by scripts/copy-lab.mjs); the
// model files come from Hugging Face (free, no account). The browser keeps the downloaded
// model in its cache ("transformers-cache"), so it downloads once per device.

type Msg =
  | { id: number; op: 'probe'; base: string }
  | { id: number; op: 'load'; model: string; dtype: string; device: string }
  | { id: number; op: 'generate'; messages: { role: string; content: string }[]; max: number }
  | { id: number; op: 'unload' }
  | { id: number; op: 'stored'; models: string[]; dtype: string }
  | { id: number; op: 'download'; model: string; dtype: string };

// ------------------------------------------------------------------ downloads
// The model's big ONNX files are streamed straight into the browser cache that transformers.js
// reads from ("transformers-cache", keyed by the Hugging Face URL), without holding them in
// memory. A download is then saved even if the next step (preparing the model) runs out of
// memory, and the page can tell which models are already on the device.
const HF = 'https://huggingface.co/';
const CACHE = 'transformers-cache';
const fileUrl = (model: string, f: string) => `${HF}${model}/resolve/main/${f}`;

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

async function isStored(model: string, dtype: string) {
  try {
    const c = await caches.open(CACHE);
    const names = [`onnx/model_${dtype}.onnx`];
    for (const n of names) if (!(await c.match(fileUrl(model, n)))) return false;
    // external weights, when the model has them, are listed in the cached index of this model
    const idx = await c.match(`${HF}__lab__/${model}/${dtype}`);
    if (!idx) return false;
    for (const n of (await idx.json()) as string[]) if (!(await c.match(fileUrl(model, n)))) return false;
    return true;
  } catch {
    return false;
  }
}

async function download(id: number, model: string, dtype: string) {
  const c = await caches.open(CACHE);
  const files = await bigFiles(model, dtype);
  const total = files.reduce((a, f) => a + f.size, 0);
  let done = 0;
  for (const f of files) {
    const url = fileUrl(model, f.name);
    if (await c.match(url)) {
      done += f.size;
      post({ id, progress: { loaded: done, total } });
      continue;
    }
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed: ${f.name} (${res.status})`);
    let last = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        done += chunk.byteLength;
        if (done - last > 2e6) {
          last = done;
          post({ id, progress: { loaded: done, total } });
        }
        ctl.enqueue(chunk);
      },
    });
    const headers = new Headers({ 'content-type': res.headers.get('content-type') || 'application/octet-stream' });
    if (f.size) headers.set('content-length', String(f.size));
    await c.put(url, new Response(res.body.pipeThrough(counter), { status: 200, headers }));
  }
  const extra = files.map((f) => f.name).filter((n) => n.includes('_data'));
  await c.put(`${HF}__lab__/${model}/${dtype}`, new Response(JSON.stringify(extra), { headers: { 'content-type': 'application/json' } }));
  post({ id, progress: { loaded: total, total } });
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
    if (m.op === 'stored') {
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
