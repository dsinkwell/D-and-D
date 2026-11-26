import { useCallback, useEffect, useRef, useState } from 'react';
import { BookmarkButton, Header, Icon, Loading, Notice, useDebounced } from '../components';
import { recordVisit } from '../lib/bookmarks';
import { Book, BookHit, deleteBook, getBook, getBookFile, highlight, importPdf, listBooks, pdfjs, searchBooks, SHELVES, updateBook } from '../lib/library';
import { Route } from '../lib/router';
import { formatBytes, storageEstimate, bookTextStore } from '../lib/storage';
import { get } from 'idb-keyval';
import { BuiltInBooks } from './BookViews';

// ------------------------------------------------------------------ shelf

export function LibraryView() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [shelf, setShelf] = useState(SHELVES[0]);
  const [busy, setBusy] = useState<{ name: string; page: number; total: number; queue: number } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'info' | 'error' | 'warn'; text: string } | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [editing, setEditing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listBooks().then(setBooks);
    storageEstimate().then((e) => e && setUsage(`${formatBytes(e.usage)} used of ~${formatBytes(e.quota)} available to this app`));
  }, []);
  useEffect(refresh, [refresh]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    setMsg(null);
    const warnings: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setBusy({ name: f.name, page: 0, total: 0, queue: list.length - i - 1 });
      try {
        const book = await importPdf(f, shelf, (page, total) => setBusy({ name: f.name, page, total, queue: list.length - i - 1 }));
        if (book.textChars < book.pages * 40) warnings.push(`“${book.title}” has little or no selectable text (it may be a scanned book), so search won’t find much in it. You can still read it.`);
      } catch (e: any) {
        warnings.push(`Could not import ${f.name}: ${e?.message || e}`);
      }
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
    setMsg(warnings.length ? { kind: 'warn', text: warnings.join(' ') } : { kind: 'info', text: `Imported ${list.length} book${list.length > 1 ? 's' : ''}.` });
    refresh();
  };

  const groups = new Map<string, Book[]>();
  for (const b of books || []) {
    if (!groups.has(b.shelf)) groups.set(b.shelf, []);
    groups.get(b.shelf)!.push(b);
  }

  return (
    <div className="page">
      <Header title="Books" subtitle="Core rulebooks, Forgotten Realms sourcebooks and supplements" back={false} />
      <BuiltInBooks />

      <h2 className="section-title">Extra PDFs on this device</h2>
      <details className="import-details" open={!!books?.length}>
        <summary>Add another PDF just on this device</summary>
      <div className="import-box">
        <p>
          For a book that isn’t built in: import a PDF you own. It’s indexed for search and kept privately on this device only.
        </p>
        <div className="import-row">
          <label>
            Shelf{' '}
            <select value={shelf} onChange={(e) => setShelf(e.target.value)}>
              {SHELVES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button className="btn primary" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <Icon name="plus" size={18} /> Import PDFs…
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        </div>
        {busy && (
          <div className="progress">
            <div className="progress-bar">
              <div style={{ width: `${busy.total ? (100 * busy.page) / busy.total : 2}%` }} />
            </div>
            <span>
              Indexing {busy.name} {busy.total ? `· page ${busy.page} of ${busy.total}` : ''} {busy.queue ? `· ${busy.queue} more queued` : ''}
            </span>
          </div>
        )}
        {usage && <div className="muted small">{usage}</div>}
      </div>
      </details>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {!books && <Loading />}
      {[...groups.entries()].map(([g, list]) => (
        <section key={g}>
          <h2 className="section-title">{g}</h2>
          <ul className="list">
            {list.map((b) => (
              <li key={b.id} className="row-with-action">
                {editing === b.id ? (
                  <BookEditor
                    book={b}
                    onDone={() => {
                      setEditing(null);
                      refresh();
                    }}
                  />
                ) : (
                  <>
                    <a className="row" href={`#/library/${b.id}`}>
                      <span className="cat cat-book">PDF</span>
                      <div className="row-main">
                        <div className="row-title">{b.title}</div>
                        <div className="row-sub">
                          {b.pages} pages · {formatBytes(b.size)}
                          {b.textChars < b.pages * 40 ? ' · no searchable text' : ''}
                        </div>
                      </div>
                    </a>
                    <button className="btn subtle" onClick={() => setEditing(b.id)}>
                      Edit
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BookEditor({ book, onDone }: { book: Book; onDone: () => void }) {
  const [title, setTitle] = useState(book.title);
  const [shelf, setShelf] = useState(book.shelf);
  return (
    <div className="book-editor">
      <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <select value={shelf} onChange={(e) => setShelf(e.target.value)} aria-label="Shelf">
        {SHELVES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <button className="btn primary" onClick={() => updateBook({ ...book, title: title.trim() || book.title, shelf }).then(onDone)}>
        Save
      </button>
      <button
        className="btn danger"
        onClick={() => {
          if (confirm(`Remove “${book.title}” from this device?`)) deleteBook(book.id).then(onDone);
        }}
      >
        Delete
      </button>
      <button className="btn subtle" onClick={onDone}>
        Cancel
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ reader

export function BookView({ id, route }: { id: string; route: Route }) {
  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [doc, setDoc] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPageState] = useState(() => Math.max(1, Number(route.query.get('p')) || 1));
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<'page' | 'text'>('page');
  const [panel, setPanel] = useState(!!route.query.get('q'));
  const [q, setQ] = useState(route.query.get('q') || '');
  const dq = useDebounced(q, 250);
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [pageText, setPageText] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const setPage = (p: number) => {
    if (!book) return;
    const n = Math.min(book.pages, Math.max(1, p));
    setPageState(n);
    const params = new URLSearchParams(route.query);
    params.set('p', String(n));
    if (q) params.set('q', q);
    window.history.replaceState(null, '', `#/library/${id}?${params}`);
  };

  useEffect(() => {
    let destroyed = false;
    let loaded: any = null;
    (async () => {
      const b = await getBook(id);
      setBook(b ?? null);
      if (!b) return;
      recordVisit({ key: `book:${id}`, source: 'book', title: b.title, subtitle: `My Books · ${b.shelf}`, href: `#/library/${id}` });
      const blob = await getBookFile(id);
      if (!blob) return setErr('The PDF file for this book is missing. Try importing it again.');
      const lib = await pdfjs();
      loaded = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      if (destroyed) loaded.destroy();
      else setDoc(loaded);
    })().catch((e) => setErr(String(e?.message || e)));
    return () => {
      destroyed = true;
      loaded?.destroy();
    };
  }, [id]);

  // Track available width for fit-to-width rendering.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [book, mode]);

  // Render the current page.
  useEffect(() => {
    if (!doc || mode !== 'page' || !width || !canvasRef.current) return;
    let task: any;
    let cancelled = false;
    (async () => {
      const pg = await doc.getPage(page);
      if (cancelled) return;
      const base = pg.getViewport({ scale: 1 });
      const cssScale = (Math.min(width, 1100) / base.width) * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const vp = pg.getViewport({ scale: cssScale * dpr });
      const canvas = canvasRef.current!;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
      canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
      task = pg.render({ canvasContext: canvas.getContext('2d')!, viewport: vp });
      await task.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [doc, page, width, zoom, mode]);

  // Text for text mode.
  useEffect(() => {
    if (mode !== 'text') return;
    get<string[]>(id, bookTextStore).then((pages) => setPageText(pages?.[page - 1] || ''));
  }, [mode, page, id]);

  // In-book search.
  useEffect(() => {
    if (!dq.trim()) return setHits(null);
    searchBooks(dq, { bookId: id, limit: 300 }).then((h) => setHits(h.sort((a, b) => a.page - b.page)));
  }, [dq, id]);

  // Keyboard navigation on Mac / iPad keyboards.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage(page + 1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage(page - 1);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  if (book === null) return <Notice kind="error">This book isn’t on this device. Books are stored per device — import it here from My Books.</Notice>;
  if (!book) return <Loading />;

  return (
    <div className={`page reader ${panel ? 'with-panel' : ''}`}>
      <Header
        title={book.title}
        subtitle={`${book.shelf} · page ${page} of ${book.pages}`}
        actions={
          <>
            <button className={`icon-btn ${panel ? 'active' : ''}`} onClick={() => setPanel(!panel)} aria-label="Search this book" title="Search this book">
              <Icon name="search" />
            </button>
            <BookmarkButton mark={{ key: `book:${id}:${page}`, source: 'book', title: `${book.title}, p. ${page}`, subtitle: 'My Books', href: `#/library/${id}?p=${page}` }} />
          </>
        }
      />
      {err && <Notice kind="error">{err}</Notice>}

      <div className="reader-body">
        {panel && (
          <aside className="reader-panel">
            <input type="search" placeholder="Search this book…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!q} />
            {hits && <div className="muted small">{hits.length} page{hits.length === 1 ? '' : 's'} match</div>}
            <ul className="list compact">
              {hits?.map((h) => (
                <li key={h.page}>
                  <button className={`row hit ${h.page === page ? 'current' : ''}`} onClick={() => setPage(h.page)}>
                    <span className="cat cat-book">p. {h.page}</span>
                    <span className="row-sub" dangerouslySetInnerHTML={{ __html: highlight(h.snippet, dq) }} />
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div className="reader-main">
          <div className="reader-toolbar">
            <button className="icon-btn" onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
              <Icon name="prev" />
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = Number(new FormData(e.currentTarget).get('p'));
                if (v) setPage(v);
              }}
            >
              <input key={page} name="p" className="page-input" defaultValue={page} inputMode="numeric" aria-label="Page number" /> / {book.pages}
            </form>
            <button className="icon-btn" onClick={() => setPage(page + 1)} disabled={page >= book.pages} aria-label="Next page">
              <Icon name="next" />
            </button>
            <span className="toolbar-sep" />
            <div className="seg">
              <button className={mode === 'page' ? 'active' : ''} onClick={() => setMode('page')}>
                Page
              </button>
              <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
                Text
              </button>
            </div>
            {mode === 'page' && (
              <>
                <button className="icon-btn zoom" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">
                  <Icon name="minus" />
                </button>
                <button className="icon-btn zoom" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">
                  <Icon name="plus" />
                </button>
              </>
            )}
          </div>
          <div ref={wrapRef} className="reader-canvas-wrap">
            {mode === 'page' ? (
              <>
                {!doc && !err && <Loading label="Opening book…" />}
                <canvas ref={canvasRef} className="pdf-canvas" />
              </>
            ) : (
              <div className="content page-text" dangerouslySetInnerHTML={{ __html: highlight(pageText, dq).replace(/\n/g, '<br>') || '<p class="muted">No text on this page.</p>' }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
