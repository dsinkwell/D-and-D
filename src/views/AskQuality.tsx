// About → Diagnostics → Ask quality test: runs the built-in test questions through Ask and shows
// how many pass at each level. In the native app it can also have the on-device model write
// every answer and check them, so a prompt change can be measured on the real device.
import { useEffect, useState } from 'react';
import { isNative } from '../lib/platform';
import { whileBusy } from '../lib/busy';
import { chooseEngine, engineLabel, type Engine } from '../lib/ask/writer';
import type { QResult } from '../lib/ask/quality';

export default function AskQuality() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [running, setRunning] = useState<null | { done: number; total: number; write: boolean }>(null);
  const [results, setResults] = useState<QResult[] | null>(null);
  const [usedEngine, setUsedEngine] = useState<Engine | null>(null);
  const [mod, setMod] = useState<typeof import('../lib/ask/quality') | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isNative()) chooseEngine().then((c) => setEngine(c.engine)).catch(() => {});
  }, []);

  const run = async (write: boolean) => {
    setErr(null);
    setResults(null);
    setRunning({ done: 0, total: 0, write });
    try {
      const m = await import('../lib/ask/quality');
      setMod(m);
      const eng = write ? engine : null;
      const r = await whileBusy('ask-quality', () => m.runQuality({ engine: eng, onProgress: (done, total) => setRunning({ done, total, write }) }));
      setUsedEngine(eng);
      setResults(r);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setRunning(null);
    }
  };

  const text = () => (results && mod ? mod.report(results, usedEngine) : '');
  const summary = results && mod ? mod.summarize(results) : null;

  return (
    <section className="card">
      <h2>Ask quality test</h2>
      <p className="muted small">
        Asks about 60 rules and Realms questions with known answers and checks what Ask finds{engine ? ' and, if you choose, what the model writes' : ''}.
        Copy the report and paste it into your chat with Claude to have problems fixed.
      </p>
      {running ? (
        <p>
          {running.write ? 'Writing and checking answers' : 'Checking'}… {running.total ? `${running.done} / ${running.total}` : ''}
        </p>
      ) : (
        <div className="row-buttons">
          <button className="btn" onClick={() => run(false)}>
            Test search
          </button>
          {engine && (
            <button className="btn" onClick={() => run(true)}>
              Test written answers ({engineLabel(engine)})
            </button>
          )}
        </div>
      )}
      {engine && !running && !results && <p className="muted small">Written answers take a few seconds each, so that test runs for several minutes.</p>}
      {err && <p className="small error-text">{err}</p>}
      {summary && results && mod && (
        <>
          <p>
            <b>
              {summary.pass} of {summary.total} checks passed
            </b>
            {summary.skipped ? <span className="muted small"> · {summary.skipped} questions skipped (download missing)</span> : null}
          </p>
          <ul className="diag">
            {summary.levels.map((l) => (
              <li key={l.level} className={l.pass === l.total ? 'ok' : 'fail'}>
                <b>
                  {l.pass === l.total ? '✓' : '✗'} {mod.LEVEL_LABEL[l.level]}
                </b>{' '}
                <span className="muted">
                  {l.pass}/{l.total}
                </span>
              </li>
            ))}
          </ul>
          {results.some((r) => r.checks.some((c) => !c.ok)) && (
            <details>
              <summary>Questions with a problem</summary>
              <ul className="diag">
                {results
                  .filter((r) => r.checks.some((c) => !c.ok))
                  .map((r) => (
                    <li key={r.id} className="fail">
                      <b>{r.q}</b>
                      {r.checks
                        .filter((c) => !c.ok)
                        .map((c) => (
                          <div key={c.level} className="muted small">
                            {mod.LEVEL_LABEL[c.level]}: {c.detail}
                          </div>
                        ))}
                      {r.answer && <div className="small">“{r.answer}”</div>}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <div className="row-buttons">
            <button
              className="btn"
              onClick={() =>
                navigator.clipboard.writeText(text()).then(
                  () => (setCopied(true), setTimeout(() => setCopied(false), 2000)),
                  () => {},
                )
              }
            >
              {copied ? 'Copied' : 'Copy report'}
            </button>
            {'share' in navigator && (
              <button className="btn subtle" onClick={() => navigator.share({ title: 'Ask quality test', text: text() }).catch(() => {})}>
                Share report
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
