import { useRef, useState } from 'react';
import { Header, Icon, Notice, SourceBadge } from '../components';
import { clearHistory, getHistory, Mark, removeBookmark, setBookmarks, useBookmarks } from '../lib/bookmarks';

const LABEL = { srd: 'Rules', wiki: 'Realms Wiki', book: 'My Books' } as const;

export default function SavedView() {
  const marks = useBookmarks();
  const [history, setHistory] = useState(getHistory);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportMarks = () => {
    const blob = new Blob([JSON.stringify({ app: 'realms-codex', bookmarks: marks }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'realms-codex-bookmarks.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const importMarks = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming: Mark[] = (data.bookmarks || []).filter((m: any) => m?.key && m?.href && m?.title && /^#\//.test(m.href));
      const map = new Map(marks.map((m) => [m.key, m]));
      incoming.forEach((m) => map.set(m.key, m));
      setBookmarks([...map.values()].sort((a, b) => b.at - a.at));
      setMsg(`Imported ${incoming.length} bookmarks.`);
    } catch {
      setMsg('That file is not a Realms Codex bookmarks export.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const groups = (['srd', 'wiki', 'book'] as const).map((s) => [s, marks.filter((m) => m.source === s)] as const).filter(([, l]) => l.length);

  return (
    <div className="page">
      <Header
        title="Saved"
        subtitle="Bookmarks and history"
        back={false}
        actions={
          <>
            <button className="btn subtle" onClick={exportMarks} disabled={!marks.length}>
              Export
            </button>
            <button className="btn subtle" onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importMarks(e.target.files?.[0])} />
          </>
        }
      />
      {msg && <Notice>{msg}</Notice>}
      {!marks.length && <p className="muted">Tap the ☆ on any rule, wiki article or book page to bookmark it. Use Export/Import to copy bookmarks between your devices.</p>}
      {groups.map(([source, list]) => (
        <section key={source}>
          <h2 className="section-title">{LABEL[source]}</h2>
          <ul className="list">
            {list.map((m) => (
              <li key={m.key} className="row-with-action">
                <a className="row" href={m.href}>
                  <SourceBadge source={m.source} />
                  <div className="row-main">
                    <div className="row-title">{m.title}</div>
                    {m.subtitle && <div className="row-sub">{m.subtitle}</div>}
                  </div>
                </a>
                <button className="icon-btn subtle" aria-label={`Remove bookmark ${m.title}`} onClick={() => removeBookmark(m.key)}>
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {history.length > 0 && (
        <section>
          <h2 className="section-title">
            History{' '}
            <button
              className="linklike small"
              onClick={() => {
                clearHistory();
                setHistory([]);
              }}
            >
              Clear
            </button>
          </h2>
          <ul className="list compact">
            {history.map((h) => (
              <li key={h.key}>
                <a className="row" href={h.href}>
                  <SourceBadge source={h.source} />
                  <div className="row-main">
                    <div className="row-title">{h.title}</div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
