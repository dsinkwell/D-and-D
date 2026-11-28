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
import { autoWrite, chooseEngine, engineLabel, prewarmWriter, writeAnswer, type Engine, type Written } from '../lib/ask/writer';
import type { Passage } from '../lib/ask/engine';
import { followUpQuery, rememberWritten, writtenFor } from '../lib/ask/followup';
import type { Convo } from '../lib/ask/prompt';

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
  q: string; // what was searched (a follow-up rebuilt with the previous question's subject)
  asked: string; // what was typed
  direct: Direct | null;
  list: ListAnswer | null;
  result: AskResult | null;
  ms: number;
  error?: string;
}

export async function answer(q: string, asked = q): Promise<Answer> {
  const t0 = performance.now();
  const [direct, list, result] = await Promise.all([
    directAnswer(q).catch(() => null),
    listAnswer(q).catch(() => null),
    ask(q, 8).catch((e) => ({ error: String(e?.message || e) }) as any),
  ]);
  const err = result && 'error' in result ? (result.error as string) : undefined;
  return { q, asked, direct, list, result: err ? null : result, ms: Math.round(performance.now() - t0), error: err };
}

export default function AskView({ route }: { route: Route }) {
  const routeQ = route.query.get('q') || '';
  // earlier questions of a follow-up thread, oldest first
  const prevs = route.query.getAll('prev');
  const prevKey = prevs.join('\u0001');
  const [q, setQ] = useState(routeQ);
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<Answer | null>(null);
  const [model, setModel] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [writeWhy, setWriteWhy] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    askDownloaded().then((ok) => {
      setModel(ok);
      if (ok) prepareAsk().catch(() => {}); // warm up while the user types
    });
    warmDirect();
    // Apple Intelligence where available, else a downloaded open model, else the normal Ask.
    chooseEngine().then(({ engine: e, hint }) => {
      setEngine(e);
      if (e?.kind === 'apple') prewarmWriter();
      if (!e && hint) setWriteWhy(hint);
    });
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
    const asked = routeQ.trim();
    // each earlier follow-up is resolved in turn, so a chain keeps its subject
    // ("range of fireball" → "and the saving throw?" → "what about lightning bolt?")
    const resolve = async () => {
      if (!prevs.length) return asked;
      let prev = prevs[0];
      for (const p of prevs.slice(1)) prev = await followUpQuery(prev, p);
      return followUpQuery(prev, asked);
    };
    resolve()
      .then((searchQ) => answer(searchQ, asked))
      .then((a) => {
        if (!live) return;
        setAns(a);
        setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [routeQ, prevKey, model]); // eslint-disable-line react-hooks/exhaustive-deps

  const followUp = (text: string) => {
    const t = text.trim();
    if (!t || !ans) return;
    const p = new URLSearchParams();
    p.set('q', t);
    for (const x of [...prevs, ans.asked].slice(-4)) p.append('prev', x);
    navigate(`/ask?${p}`);
  };
  const threadHref = (i: number) => {
    const p = new URLSearchParams();
    p.set('q', prevs[i]);
    for (const x of prevs.slice(0, i)) p.append('prev', x);
    return `#/ask?${p}`;
  };
  const convo: Convo | undefined = prevs.length && ans ? { asked: ans.asked, turns: prevs.map((x) => ({ q: x, a: writtenFor(x) })) } : undefined;

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
          {prevs.length > 0 && (
            <p className="ask-thread">
              Following up on{' '}
              {prevs.map((x, i) => (
                <span key={i}>
                  {i ? ' → ' : ''}
                  <a href={threadHref(i)}>“{x}”</a>
                </span>
              ))}
              {ans.q !== ans.asked && <span className="muted"> · searched as “{ans.q}”</span>}
            </p>
          )}
          {engine && (
            <WriteCard
              key={`${prevKey}|${ans.q}`}
              q={ans.q}
              asked={ans.asked}
              convo={convo}
              engine={engine}
              found={{ direct: ans.direct, passages: ans.result?.passages || [] }}
              auto={autoWrite() && !ans.list}
            />
          )}
          {!engine && writeWhy && <p className="muted ask-status">Written answers: {writeWhy}</p>}

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

          <FollowUpBox key={`${prevKey}|${ans.asked}`} onAsk={followUp} disabled={busy} />

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

/** Native app: "Write an answer" with Apple's on-device model, from the passages Ask found. */
function WriteCard({
  q,
  asked,
  convo,
  engine,
  found,
  auto,
}: {
  q: string;
  asked: string;
  convo?: Convo;
  engine: Engine;
  found: { direct: Direct | null; passages: Passage[] };
  auto: boolean;
}) {
  const [state, setState] = useState<'idle' | 'writing' | 'done' | 'error'>('idle');
  const [text, setText] = useState('');
  const [sources, setSources] = useState<Passage[]>([]);
  const [given, setGiven] = useState('');
  const [info, setInfo] = useState<Written | null>(null);
  const [err, setErr] = useState('');
  const started = useRef(false);
  useEffect(() => {
    // the Ask button writes the answer straight away (once per question)
    if (auto && !started.current) {
      started.current = true;
      go();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setState('writing');
    setText('');
    setErr('');
    try {
      const w = await whileBusy('write', () => writeAnswer(q, setText, (b) => (setSources(b.sources), setGiven(b.prompt)), found.passages.length ? found : undefined, engine, convo));
      setText(w.text);
      rememberWritten(asked, w.text);
      setInfo(w);
      setState('done');
    } catch (e) {
      setErr(String((e as Error)?.message || e));
      setState('error');
    }
  };
  if (state === 'idle')
    return (
      <button className="btn ask-write-btn" onClick={go}>
        <Icon name="ask" size={18} /> Write an answer
      </button>
    );
  return (
    <div className="ask-written">
      {(text || state === 'writing') && <p className="ask-written-text">{text || 'Writing…'}</p>}
      {err && <p className="muted ask-status">Couldn’t write an answer ({err}). The search results below still apply.</p>}
      {sources.length > 0 && !err && (
        <p className="ask-written-src">
          Written on this device by {engineLabel(engine)} from:{' '}
          {sources.map((p, i) => (
            <a key={p.key} href={p.href}>
              {i ? ', ' : ''}
              {p.title} ({p.label})
            </a>
          ))}
          {info && <span className="muted"> · {(info.totalMs / 1000).toFixed(1)} s</span>}
        </p>
      )}
      {given && (
        <details className="ask-given">
          <summary>What the model was given</summary>
          <pre>{given}</pre>
        </details>
      )}
      {state !== 'writing' && (
        <button className="btn subtle" onClick={go}>
          Write again
        </button>
      )}
    </div>
  );
}

/** "Ask a follow-up…": keeps the thread (the earlier questions travel in the URL). */
function FollowUpBox({ onAsk, disabled }: { onAsk: (q: string) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  return (
    <form
      className="searchbar askbar ask-followup"
      onSubmit={(e) => {
        e.preventDefault();
        onAsk(text);
      }}
    >
      <Icon name="ask" />
      <input
        type="search"
        enterKeyHint="go"
        placeholder="Ask a follow-up…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Follow-up question"
      />
      <button type="submit" className="btn subtle ask-go" disabled={!text.trim() || disabled}>
        Ask
      </button>
    </form>
  );
}
