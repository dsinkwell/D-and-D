// About page, native app: written answers. Shows which writer is used (Apple Intelligence or a
// downloaded open model), automatic writing, and open-model downloads.
import { useEffect, useState } from 'react';
import { Icon, Notice } from '../components';
import { whileBusy } from '../lib/busy';
import { isNative } from '../lib/platform';
import {
  autoWrite,
  cancelLocalDownload,
  chooseEngine,
  downloadLocalModel,
  engineLabel,
  localChoice,
  localStatus,
  preferOpen,
  removeLocalModel,
  setAutoWrite,
  setLocalChoice,
  setPreferOpen,
  writerAvailability,
  type Engine,
  type LocalStatus,
} from '../lib/ask/writer';

export default function WritingSettings() {
  const [apple, setApple] = useState<boolean | null>(null);
  const [st, setSt] = useState<LocalStatus | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [auto, setAuto] = useState(autoWrite());
  const [open, setOpen] = useState(preferOpen());
  const [choice, setChoice] = useState(localChoice());
  const [dl, setDl] = useState<{ model: string; f: number } | null>(null);
  const [err, setErr] = useState('');

  const refresh = () =>
    Promise.all([writerAvailability(), localStatus(), chooseEngine()]).then(([a, s, c]) => {
      setApple(a.available);
      setSt(s);
      setEngine(c.engine);
    });
  useEffect(() => {
    if (isNative()) refresh();
  }, []);

  if (!isNative() || apple === null || !st) return null;
  if (!apple && !st.capable) return null; // this device can't write answers: nothing to show

  const download = async (model: string) => {
    setErr('');
    setDl({ model, f: 0 });
    try {
      await whileBusy('local-model', () => downloadLocalModel(model, (r, t) => setDl({ model, f: t ? r / t : 0 })));
      setLocalChoice(model);
      setChoice(model);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
    setDl(null);
    refresh();
  };

  return (
    <section className="card">
      <h2>Written answers</h2>
      <p>
        {engine ? (
          <>
            Answers are written on this device by <b>{engineLabel(engine)}</b>. Nothing is sent anywhere.
          </>
        ) : (
          'Download a writing model below to get written answers on this device.'
        )}
      </p>
      {engine && (
        <label className="toggle-row">
          <input type="checkbox" checked={auto} onChange={(e) => (setAuto(e.target.checked), setAutoWrite(e.target.checked))} /> Write answers
          automatically when you tap Ask
        </label>
      )}

      {st.capable && (
        <>
          <h3 className="writing-sub">{apple ? 'Open models (for testing)' : 'Writing model'}</h3>
          {!apple && (
            <p className="muted">
              A small open model runs on this device (offline, free). Download once over Wi-Fi and keep the app open until it finishes.
            </p>
          )}
          <ul className="model-list">
            {st.models.map((m) => (
              <li key={m.id}>
                <div>
                  <b>{m.name}</b> <span className="muted">· {(m.mb / 1000).toFixed(1)} GB</span>
                  {!m.fits && <span className="muted"> · needs a device with more memory</span>}
                  {m.downloaded && st.models.filter((x) => x.downloaded).length > 1 && (
                    <label className="model-use">
                      <input
                        type="radio"
                        name="local-model"
                        checked={(choice || st.models.find((x) => x.downloaded)?.id) === m.id}
                        onChange={() => (setLocalChoice(m.id), setChoice(m.id), refresh())}
                      />{' '}
                      use this one
                    </label>
                  )}
                </div>
                {dl?.model === m.id ? (
                  <div className="progress">
                    <div className="progress-bar">
                      <div style={{ width: `${Math.round(dl.f * 100)}%` }} />
                    </div>
                    <span>{dl.f >= 0.999 ? 'Checking the download…' : `Downloading ${Math.round(dl.f * 100)}%`}</span>
                    <button className="btn subtle" onClick={() => cancelLocalDownload()}>
                      Cancel
                    </button>
                  </div>
                ) : m.downloaded ? (
                  <button className="btn subtle" onClick={() => removeLocalModel(m.id).then(refresh)}>
                    <Icon name="trash" size={16} /> Remove
                  </button>
                ) : (
                  <button className="btn" disabled={!m.fits || !!dl} onClick={() => download(m.id)}>
                    <Icon name="download" size={16} /> Download
                  </button>
                )}
              </li>
            ))}
          </ul>
          {apple && (
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={open}
                disabled={!st.models.some((m) => m.downloaded)}
                onChange={(e) => (setOpen(e.target.checked), setPreferOpen(e.target.checked), refresh())}
              />{' '}
              Testing: use the open model instead of Apple Intelligence
            </label>
          )}
        </>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </section>
  );
}
