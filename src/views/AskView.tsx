// Ask: natural-language questions answered from what is on the device (SRD, rulebooks, wiki).
// 1. Direct answers for single-fact questions, written as a sentence (direct.ts).
// 2. List answers for filter-style questions ("level 3 cleric spells").
// 3. Passages found by meaning + keyword search, with the best sentences highlighted.
import { useEffect, useRef, useState } from 'react';
import { Header, Icon, Notice } from '../components';
import { navigate, Route } from '../lib/router';
import { ask, askDownloaded, downloadAsk, kindLabel, prepareAsk, removeAsk, type AskResult } from '../lib/ask/engine';
import { directAnswer, listAnswer, warmDirect, type Direct, type ListAnswer } from '../lib/ask/direct';
import { highlight } from '../lib/ask/highlight';
import { whileBusy } from '../lib/busy';

const EXAMPLES = [
  'What is the range of fireball?',
  'Can a wizard cast spells in armor?',
  'How does grappling work?',
  'Who rules Cormyr?',
  "What is Mystra's portfolio?",
  'Level 3 cleric spells',
  'Undead monsters CR 4 to 6',
  'How do I become a Red Wizard?',
];

interface Answer {
  q: string;
  direct: Direct | null;
  list: ListAnswer | null;
  result: AskResult | null;
  ms: number;
  error?: string;
}

export async function answer(q: string): Promise<Answer> {
  const t0 = performance.now();
  const [direct, list, result] = await Promise.all([
    directAnswer(q).catch(() => null),
    listAnswer(q).catch(() => null),
    ask(q, 8).catch((e) => ({ error: String(e?.message || e) }) as any),
  ]);
  const err = result && 'error' in result ? (result.error as string) : undefined;
  return { q, direct, list, result: err ? null : result, ms: Math.round(performance.now() - t0), error: err };
}

export default function AskView({ route }: { route: Route }) {
  const routeQ = route.query.get('q') || '';
  const [q, setQ] = useState(routeQ);
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<Answer | null>(null);
  const [model, setModel] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    askDownloaded().then((ok) => {
      setModel(ok);
      if (ok) prepareAsk().catch(() => {}); // warm up while the user types
    });
    warmDirect();
    if (!routeQ) inputRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setQ(routeQ);
    if (!routeQ.trim()) {
      setAns(null);
      return;
    }
    let live = true;
    setBusy(true);
    answer(routeQ.trim()).then((a) => {
      if (!live) return;
      setAns(a);
      setBusy(false);
    });
    return () => {
      live = false;
    };
  }, [routeQ, model]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    inputRef.current?.blur();
    navigate(`/ask?q=${encodeURIComponent(t)}`, routeQ !== '');
  };

  return (
    <div className="page ask-page">
      <Header title="Ask" subtitle="From your rules, books and the Realms wiki" />
      <form
        className="searchbar askbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <Icon name="ask" />
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="go"
          placeholder="Ask a question…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Question"
        />
        <button type="submit" className="btn primary ask-go" disabled={!q.trim() || busy}>
          Ask
        </button>
      </form>

      {model === false && <ModelCard onDone={() => setModel(true)} />}

      {!routeQ && (
        <section>
          <h2 className="section-title">Try</h2>
          <div className="quick-grid">
            {EXAMPLES.map((x) => (
              <button key={x} className="quick" onClick={() => submit(x)}>
                {x}
              </button>
            ))}
          </div>
        </section>
      )}

      {busy && !ans && <p className="muted ask-status">Searching…</p>}

      {ans && (
        <div className={`ask-results ${busy ? 'stale' : ''}`} data-q={ans.q}>
          {ans.direct && (
            <a className="ask-direct" href={ans.direct.href}>
              <p dangerouslySetInnerHTML={{ __html: ans.direct.html }} />
              <span className="ask-src">
                {ans.direct.title} · {ans.direct.source}
              </span>
            </a>
          )}

          {ans.list && (
            <section className="ask-list">
              <h2 className="section-bar">
                <a href={ans.list.href}>
                  {ans.list.label} <span className="count">{ans.list.total}</span>
                </a>
              </h2>
              <ul className="ask-list-items">
                {ans.list.items.map((it) => (
                  <li key={it.key}>
                    <a href={it.sources[0].href}>
                      <b>{it.title}</b>
                      {it.extra && <span className="muted"> {it.extra}</span>}
                    </a>
                  </li>
                ))}
              </ul>
              {ans.list.total > ans.list.items.length && (
                <a className="ask-more" href={ans.list.href}>
                  See all {ans.list.total} →
                </a>
              )}
            </section>
          )}

          {ans.error && <Notice kind="error">{ans.error}</Notice>}

          {ans.result && ans.result.passages.length > 0 && (
            <section>
              {(ans.direct || ans.list) && <h2 className="section-title">Related passages</h2>}
              {ans.result.passages.map((p) => {
                const h = highlight(p.html, ans.q, 360, p.title);
                return (
                  <a key={p.key} className="ask-passage" href={p.href}>
                    <div className="ask-passage-head">
                      <span className="ask-title">{p.title}</span>
                      <span className="ask-meta">
                        {[kindLabel(p.kind), p.label].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <p className="ask-excerpt" dangerouslySetInnerHTML={{ __html: h.excerpt }} />
                  </a>
                );
              })}
            </section>
          )}

          {ans.result && !ans.result.passages.length && !ans.direct && !ans.list && <p className="muted">Nothing found. Try different words.</p>}

          <p className="ask-timing">
            {ans.ms} ms
            {ans.result && (ans.result.meaning ? ` · meaning search ${ans.result.ms.embed + ans.result.ms.search} ms` : ' · keyword search only')}
          </p>
        </div>
      )}
    </div>
  );
}

function ModelCard({ onDone }: { onDone: () => void }) {
  const [prog, setProg] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setErr(null);
    setProg(0);
    try {
      await whileBusy('ask-model', () => downloadAsk((d, t) => setProg(d / t)));
      onDone();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
      setProg(null);
    }
  };
  return (
    <div className="card ask-model">
      <div>
        <b>Better answers: understand questions by meaning</b>
        <p className="muted">
          Right now Ask matches keywords. A one-time 47 MB download adds a small language model that runs on this device, finds
          passages by meaning (“can wizards wear armor” finds <i>arcane spell failure</i>), and works offline. No account, no cost.
        </p>
        {err && <Notice kind="error">Download failed: {err}</Notice>}
      </div>
      {prog === null ? (
        <button className="btn primary" onClick={start}>
          <Icon name="download" size={18} /> Download 47 MB
        </button>
      ) : (
        <div className="progress" aria-label="Downloading">
          <div className="progress-bar">
            <div style={{ width: `${Math.round(prog * 100)}%` }} />
          </div>
          <span>{Math.round(prog * 100)}%</span>
        </div>
      )}
    </div>
  );
}

/** Settings row (About page): remove the downloaded model. */
export function AskModelSettings() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => void askDownloaded().then(setOk), []);
  if (!ok) return null;
  return (
    <section className="card">
      <h2>Ask</h2>
      <p>The Ask meaning-search model (47 MB) is stored on this device and works offline.</p>
      <button className="btn subtle" onClick={() => removeAsk().then(() => setOk(false))}>
        <Icon name="trash" size={16} /> Remove model
      </button>
    </section>
  );
}
