// "Explain this" on an entry (SRD, rulebooks, wiki): a plain-English explanation written on the
// device by Apple Intelligence or a downloaded open model, from the entry's own text only.
// Shown only where a writer is available (the native app); the website doesn't offer it.
import { useEffect, useState } from 'react';
import { Icon } from '../components';
import { whileBusy } from '../lib/busy';
import { textOf } from '../lib/ask/highlight';
import { chooseEngine, engineLabel, explainEntry, type Engine } from '../lib/ask/writer';

export function ExplainCard({ title, label, html }: { title: string; label: string; html: string }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [state, setState] = useState<'idle' | 'writing' | 'done' | 'error'>('idle');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [ms, setMs] = useState(0);

  useEffect(() => {
    let live = true;
    chooseEngine()
      .then(({ engine: e }) => live && setEngine(e))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!engine) return null;

  const go = async () => {
    setState('writing');
    setText('');
    setErr('');
    try {
      const r = await whileBusy('write', () => explainEntry(title, label, textOf(html), engine, setText));
      setText(r.text);
      setMs(r.totalMs);
      setState('done');
    } catch (e) {
      setErr(String((e as Error)?.message || e));
      setState('error');
    }
  };

  if (state === 'idle')
    return (
      <button className="btn subtle explain-btn" onClick={go}>
        <Icon name="ask" size={18} /> Explain this
      </button>
    );
  return (
    <div className="ask-written explain-card">
      {(text || state === 'writing') && <p className="ask-written-text">{text || 'Writing…'}</p>}
      {err && <p className="muted ask-status">Couldn’t write an explanation ({err}).</p>}
      {state !== 'writing' && !err && (
        <p className="ask-written-src">
          Explained on this device by {engineLabel(engine)} from the text below{ms ? ` · ${(ms / 1000).toFixed(1)} s` : ''}. The text itself is the rule.
        </p>
      )}
      {state !== 'writing' && (
        <button className="btn subtle" onClick={go}>
          Explain again
        </button>
      )}
    </div>
  );
}
