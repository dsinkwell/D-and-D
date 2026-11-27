// Hidden test bench (#/lab): can this device write answers with a small on-device model, and how
// fast? The Ask search finds the passages; the model writes a short answer from them.
import { useEffect, useState } from 'react';
import { Header, Notice } from '../components';
import { ask, type Passage } from '../lib/ask/engine';
import { directAnswer } from '../lib/ask/direct';
import { highlight, textOf } from '../lib/ask/highlight';
import { whileBusy } from '../lib/busy';

interface ModelChoice {
  id: string;
  name: string;
  mb: number;
  note: string;
}
const MODELS: ModelChoice[] = [
  { id: 'onnx-community/LFM2-350M-ONNX', name: 'LFM2 · 350M', mb: 255, note: 'tiny; try this first on iPhone' },
  { id: 'onnx-community/gemma-3-270m-it-ONNX', name: 'Gemma 3 · 270M', mb: 273, note: 'tiny' },
  { id: 'onnx-community/Qwen2.5-0.5B-Instruct', name: 'Qwen 2.5 · 0.5B', mb: 483, note: 'smallest, fastest' },
  { id: 'onnx-community/LFM2-700M-ONNX', name: 'LFM2 · 700M', mb: 496, note: 'built for phones' },
  { id: 'onnx-community/Qwen3-0.6B-ONNX', name: 'Qwen 3 · 0.6B', mb: 570, note: 'newer, small' },
  { id: 'onnx-community/LFM2-1.2B-ONNX', name: 'LFM2 · 1.2B', mb: 760, note: 'better writing, slower' },
  { id: 'onnx-community/gemma-3-1b-it-ONNX-GQA', name: 'Gemma 3 · 1B', mb: 763, note: 'good writing, slower' },
  { id: 'onnx-community/Llama-3.2-1B-Instruct-q4f16', name: 'Llama 3.2 · 1B', mb: 1238, note: 'largest; may not fit on iPhone' },
];

const TEST_QUESTIONS = [
  'Can a wizard cast spells in armor?',
  'How does grappling work?',
  'Who is Elminster?',
  'What happens when a character is flat-footed?',
  'How do I become a Red Wizard?',
];

const INSTRUCTIONS =
  'You answer questions about Dungeons & Dragons 3.5 and the Forgotten Realms. Use only the sources below. ' +
  'Answer in 2 to 4 plain sentences. Name the source you used in brackets, like [PHB p. 57]. ' +
  'If the sources do not answer the question, say so.';

interface Stats {
  promptTokens: number;
  tokens: number;
  firstMs: number;
  tokPerSec: number;
  totalMs: number;
}
interface Run {
  n: number;
  q: string;
  answer: string;
  searchMs: number;
  stats?: Stats;
  sources: Passage[];
  error?: string;
}

// ------------------------------------------------------------------ worker RPC

let runSeq = 0;
let worker: Worker | null = null;
let seq = 0;
type Handler = { res: (v: any) => void; rej: (e: Error) => void; on?: (m: any) => void };
const pending = new Map<number, Handler>();
function call<T>(msg: Record<string, unknown>, on?: (m: any) => void): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('../workers/write.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const h = pending.get(ev.data.id);
      if (!h) return;
      if (ev.data.ok === undefined) return h.on?.(ev.data);
      pending.delete(ev.data.id);
      if (ev.data.ok) h.res(ev.data.data);
      else h.rej(new Error(ev.data.error));
    };
    worker.onerror = (e) => {
      for (const h of pending.values()) h.rej(new Error(`The model worker stopped: ${e.message || 'unknown error'}`));
      pending.clear();
      worker = null;
    };
  }
  const id = ++seq;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res, rej, on });
    worker!.postMessage({ id, ...msg });
  });
}

// ------------------------------------------------------------------ prompt

async function buildPrompt(q: string) {
  const t0 = performance.now();
  const [direct, found] = await Promise.all([directAnswer(q).catch(() => null), ask(q, 6)]);
  const sources = found.passages.slice(0, 4);
  const lines: string[] = [];
  if (direct) lines.push(`[${direct.source}] ${direct.title}: ${textOf(direct.html)}`);
  for (const p of sources) {
    const ex = textOf(highlight(p.html, q, 520, p.title).excerpt.replace(/<\/?mark>/g, ''));
    lines.push(`[${p.label}] ${p.title}: ${ex}`);
  }
  const content = `${INSTRUCTIONS}\n\nSources:\n${lines.join('\n\n')}\n\nQuestion: ${q}`;
  return { messages: [{ role: 'user', content }], sources, searchMs: Math.round(performance.now() - t0) };
}

// iPhone/iPad Safari silently reloads a page that runs out of memory. Remember the step in
// progress so the reloaded page can say where it stopped.
const CRUMB = 'lab-step';
const crumb = (step: string | null) => {
  try {
    if (step) localStorage.setItem(CRUMB, JSON.stringify({ step, at: Date.now() }));
    else localStorage.removeItem(CRUMB);
  } catch {
    /* private mode */
  }
};
const lastCrumb = (): string | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CRUMB) || 'null');
    localStorage.removeItem(CRUMB);
    return c && Date.now() - c.at < 30 * 60 * 1000 ? c.step : null;
  } catch {
    return null;
  }
};

const clean = (s: string) => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

// ------------------------------------------------------------------ view

export default function LabView() {
  const [dev, setDev] = useState<Record<string, any> | null>(null);
  const [choice, setChoice] = useState(MODELS[0].id);
  const [loading, setLoading] = useState<number | null>(null); // 0..1
  const [loaded, setLoaded] = useState<{ id: string; loadMs: number; warmMs: number; dtype: string; device: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatusText] = useState('Checking this device…');
  const [stored, setStored] = useState<Record<string, boolean>>({});
  const [crashed] = useState(lastCrumb);
  const setStatus = (t: string, keep = true) => {
    setStatusText(t);
    crumb(keep ? t : null);
  };

  useEffect(() => {
    call<Record<string, any>>({ op: 'probe', base: new URL(import.meta.env.BASE_URL, location.href).href })
      .then((d) => {
        setDev(d);
        setStatusText('Pick a model and tap Load.');
      })
      .catch((e) => {
        setDev({ webgpu: false, error: String(e) });
        setStatusText(`Device check failed: ${String((e as Error)?.message || e)}`);
      });
  }, []);

  const model = MODELS.find((m) => m.id === choice)!;
  // #/lab?device=wasm forces the processor (for comparison / testing)
  const force = new URLSearchParams(location.hash.split('?')[1] || '').get('device');
  const device = force || (dev?.webgpu ? 'webgpu' : 'wasm');
  const dtype = device === 'webgpu' && dev?.f16 ? 'q4f16' : 'q4';

  const refreshStored = () =>
    call<Record<string, boolean>>({ op: 'stored', models: MODELS.map((m) => m.id), dtype })
      .then(setStored)
      .catch(() => {});
  useEffect(() => {
    if (dev) refreshStored();
  }, [dev, dtype]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (): Promise<boolean> => {
    setErr(null);
    setLoading(0);
    let ok = false;
    let shown = -1;
    let phase = 'download';
    try {
      // 1. download (streamed to storage; kept even if step 2 fails)
      if (!stored[choice]) {
        setStatus(`Downloading ${model.name}: 0%`);
        await call({ op: 'download', model: choice, dtype }, (m) => {
          if (!m.progress?.total) return;
          const f = m.progress.loaded / m.progress.total;
          setLoading(Math.min(f, 0.999));
          const pct = Math.floor(f * 10) * 10;
          if (pct !== shown) {
            shown = pct;
            setStatus(`Downloading ${model.name}: ${pct}%`);
          }
        });
        setStored((st) => ({ ...st, [choice]: true }));
      }
      // 2. prepare: the model goes into memory and onto the GPU (the step that can run out of memory)
      phase = 'prepare';
      setLoading(1);
      setStatus(`Preparing ${model.name} on the ${device === 'webgpu' ? 'GPU' : 'processor'} (download saved)`);
      const r = await call<{ loadMs: number; warmMs: number }>({ op: 'load', model: choice, dtype, device });
      setLoaded({ id: choice, dtype, device, ...r });
      setStatus(`${model.name} is ready.`, false);
      ok = true;
    } catch (e) {
      const msg = String((e as Error).message || e);
      setErr(msg);
      setStatus(`${phase === 'download' ? 'Downloading' : 'Preparing'} ${model.name} failed: ${msg}`, false);
    }
    setLoading(null);
    return ok;
  };
  // typing and tapping Write works any time: load the chosen model first if none is ready
  const ready = async () => !!loaded || (await load());

  const write = async (question: string) => {
    const run: Run = { n: ++runSeq, q: question, answer: '', searchMs: 0, sources: [] };
    const show = () => setRuns((rs) => rs.map((r) => (r.n === run.n ? { ...run } : r)));
    setRuns((rs) => [{ ...run }, ...rs]);
    try {
      setStatus(`Searching for sources: “${question}”`);
      const p = await buildPrompt(question);
      run.sources = p.sources;
      run.searchMs = p.searchMs;
      show();
      setStatus(`Writing an answer with ${loaded?.id.split('/')[1] || model.name}: “${question}”`);
      run.stats = await call<Stats>({ op: 'generate', messages: p.messages, max: 180 }, (m) => {
        if (m.text) {
          run.answer += m.text;
          show();
        }
      });
    } catch (e) {
      run.error = String((e as Error).message || e);
    }
    run.answer = clean(run.answer);
    show();
    setStatus(run.error ? `Writing failed: ${run.error}` : 'Done.', false);
  };

  const runOne = async () => {
    if (!q.trim() || busy || loading !== null) return;
    setBusy(true);
    await whileBusy('lab', async () => {
      if (await ready()) await write(q.trim());
    });
    setBusy(false);
  };
  const runTest = async () => {
    if (busy || loading !== null) return;
    setBusy(true);
    await whileBusy('lab', async () => {
      if (await ready()) for (const t of TEST_QUESTIONS) await write(t);
    });
    setBusy(false);
  };

  const report = () => {
    const done = runs.filter((r) => r.stats).reverse();
    const avg = (f: (s: Stats) => number) => (done.length ? Math.round(done.reduce((a, r) => a + f(r.stats!), 0) / done.length) : 0);
    return [
      `Device: ${navigator.userAgent}`,
      `WebGPU: ${dev?.webgpu ? 'yes' : 'no'} · f16: ${dev?.f16 ? 'yes' : 'no'} · GPU: ${dev?.adapter || '?'} · cores ${dev?.cores ?? '?'} · memory ${dev?.memory ?? '?'} GB`,
      loaded ? `Model: ${loaded.id} (${loaded.dtype}, ${loaded.device}) · load ${loaded.loadMs} ms · warm-up ${loaded.warmMs} ms` : 'Model: not loaded',
      `Average: first words ${avg((s) => s.firstMs)} ms · ${avg((s) => s.tokPerSec * 10) / 10} tokens/s · whole answer ${avg((s) => s.totalMs)} ms`,
      '',
      ...done.map(
        (r) =>
          `Q: ${r.q}\n  search ${r.searchMs} ms · prompt ${r.stats!.promptTokens} tok · first ${r.stats!.firstMs} ms · ${r.stats!.tokPerSec} tok/s · ${r.stats!.tokens} tok · total ${r.stats!.totalMs} ms\n  A: ${r.answer.replace(/\s+/g, ' ')}`,
      ),
    ].join('\n');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Copy failed. Select the text in the box at the bottom and copy it by hand.');
    }
  };

  return (
    <div className="page lab-page">
      <Header title="Written answers (test)" subtitle="On-device AI speed test" />

      {crashed && (
        <Notice kind="warn">
          Last time, the page stopped while: <b>{crashed}</b>.{' '}
          {/^Preparing/.test(crashed)
            ? 'The download is saved, but this device ran out of memory while preparing the model (Safari then reloads the page). Try a smaller model: LFM2 · 350M or Gemma 3 · 270M.'
            : 'Safari reloads a page that runs out of memory. Try again, or try a smaller model (LFM2 · 350M or Gemma 3 · 270M).'}
        </Notice>
      )}
      <p className="lab-status">
        Status: <b>{status}</b>
      </p>

      <section className="card lab-card">
        <h2>This device</h2>
        {!dev ? (
          <p className="muted">Checking…</p>
        ) : (
          <p>
            WebGPU: <b>{dev.webgpu ? 'yes' : 'no'}</b>
            {dev.webgpu && (
              <>
                {' '}
                · half precision: <b>{dev.f16 ? 'yes' : 'no'}</b> · GPU: {dev.adapter || 'unknown'}
              </>
            )}
            {!dev.webgpu && (
              <Notice kind="warn">
                No WebGPU in this browser, so the model would run on the processor only (very slow). On iPhone and iPad this needs iOS 26 or later; on
                Mac, Safari 26 or a current Chrome.
              </Notice>
            )}
          </p>
        )}
      </section>

      <section className="card lab-card">
        <h2>1. Pick and load a model</h2>
        <p className="muted">Downloads once from Hugging Face (free, no account) and stays in this browser's cache. Use Wi-Fi.</p>
        <div className="lab-models">
          {MODELS.map((m) => (
            <label key={m.id} className={`lab-model ${choice === m.id ? 'on' : ''}`}>
              <input type="radio" name="model" checked={choice === m.id} onChange={() => setChoice(m.id)} disabled={loading !== null || busy} />
              <span>
                <b>{m.name}</b> <span className="muted">· {dtype === 'q4f16' ? m.mb : Math.round(m.mb * 1.6)} MB · {m.note}</span>
                {loaded?.id === m.id ? <span className="lab-ok"> · ready</span> : stored[m.id] ? <span className="lab-ok"> · downloaded</span> : null}
              </span>
            </label>
          ))}
        </div>
        {loading !== null ? (
          <div className="progress">
            <div className="progress-bar">
              <div style={{ width: `${Math.round(loading * 100)}%` }} />
            </div>
            <span>{loading < 1 ? `Downloading ${Math.round(loading * 100)}% of ${model.mb} MB` : `Preparing the model on the ${device === 'webgpu' ? 'GPU' : 'processor'}…`}</span>
          </div>
        ) : (
          <button className="btn primary" onClick={() => void whileBusy('lab', load)} disabled={!dev || busy || loaded?.id === choice}>
            {loaded?.id === choice ? 'Loaded' : stored[choice] ? `Load ${model.name} (downloaded)` : `Download and load ${model.name}`}
          </button>
        )}
        {loaded && (
          <p className="lab-stat">
            Ready: {(loaded.loadMs / 1000).toFixed(1)} s to load, {(loaded.warmMs / 1000).toFixed(1)} s to prepare ({loaded.dtype}, {loaded.device}).
          </p>
        )}
        {err && <Notice kind="error">{err}</Notice>}
      </section>

      <section className="card lab-card">
        <h2>2. Ask</h2>
        {!loaded && <p className="muted">You can type now; Write loads the model picked above first.</p>}
        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            runOne();
          }}
        >
          <input type="search" placeholder="Ask a question…" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="go" />
          <button className="btn primary ask-go" type="submit" disabled={busy || loading !== null || !q.trim()}>
            Write
          </button>
        </form>
        <button className="btn" onClick={runTest} disabled={busy || loading !== null}>
          Run the 5-question speed test
        </button>
      </section>

      {runs.map((r) => (
        <section key={r.n} className="lab-run">
          <h3>{r.q}</h3>
          <p className="lab-answer">{clean(r.answer) || (r.error ? '' : '…')}</p>
          {r.error && <Notice kind="error">{r.error}</Notice>}
          {r.stats && (
            <p className="lab-stat">
              First words after <b>{(r.stats.firstMs / 1000).toFixed(1)} s</b> · <b>{r.stats.tokPerSec}</b> tokens/s · whole answer {(r.stats.totalMs / 1000).toFixed(1)} s ·
              search {r.searchMs} ms · read {r.stats.promptTokens} tokens of sources
            </p>
          )}
          {r.sources.length > 0 && (
            <p className="lab-sources">
              Sources:{' '}
              {r.sources.map((p, k) => (
                <a key={p.key} href={p.href}>
                  {k ? ', ' : ''}
                  {p.title} ({p.label})
                </a>
              ))}
            </p>
          )}
        </section>
      ))}

      {runs.some((r) => r.stats) && (
        <section className="card lab-card">
          <h2>3. Send me the results</h2>
          <p className="muted">Copy and paste this into our chat.</p>
          <button className="btn primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy results'}
          </button>
          <textarea className="lab-report" readOnly value={report()} rows={8} />
        </section>
      )}

      <p className="muted lab-foot">
        <button
          className="btn subtle"
          onClick={async () => {
            await call({ op: 'unload' }).catch(() => {});
            await caches.delete('transformers-cache');
            setLoaded(null);
            setStored({});
          }}
        >
          Delete downloaded test models
        </button>
      </p>
    </div>
  );
}
