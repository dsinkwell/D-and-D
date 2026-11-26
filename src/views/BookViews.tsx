import { useEffect, useMemo, useState } from 'react';
import { BookmarkButton, Header, Icon, Loading, Notice } from '../components';
import { recordVisit } from '../lib/bookmarks';
import {
  BOOK_KIND_LABEL,
  BookEntry,
  bookEntry,
  bookEntryHref,
  BookInfo,
  bookInfo,
  blocksFor,
  bookToc,
  listBuiltInBooks,
  neighbours,
  resetBooksCache,
} from '../lib/books';
import { useDbStatus } from '../lib/db';
import { catalog, nameKey, resetCatalog, Source } from '../lib/catalog';
import { Category } from '../lib/srd';
import { OfflineDataCard } from '../OfflineData';

const PASS_KEY = 'rc.books.pass.hint';

/** Unlock card + shelves of built-in books. Shown at the top of the My Books tab. */
export function BuiltInBooks() {
  const status = useDbStatus();
  const [books, setBooks] = useState<BookInfo[] | null>(null);
  const [pass, setPass] = useState('');
  const [submitted, setSubmitted] = useState('');
  const installed = !!status?.installed.books;

  useEffect(() => {
    if (!installed) return;
    resetBooksCache();
    resetCatalog();
    listBuiltInBooks().then(setBooks).catch(() => setBooks([]));
  }, [installed, status?.installed.books]);

  if (!status) return <Loading />;

  if (!installed) {
    return (
      <section className="card unlock">
        <h2>Your group’s rulebooks</h2>
        <p className="muted small">
          The core books and Forgotten Realms books are built into this app, encrypted. Enter your group’s passphrase once on this device to download and unlock
          them — after that they work offline.
        </p>
        <form
          className="unlock-row"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(pass);
          }}
        >
          <input type="password" autoComplete="current-password" placeholder="Group passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!pass}>
            Unlock
          </button>
        </form>
        {submitted && <OfflineDataCard key={submitted} name="books" passphrase={submitted} autoStart onInstalled={() => localStorage.setItem(PASS_KEY, '1')} />}
      </section>
    );
  }

  const groups = new Map<string, BookInfo[]>();
  for (const b of books || []) {
    if (!groups.has(b.shelf)) groups.set(b.shelf, []);
    groups.get(b.shelf)!.push(b);
  }
  return (
    <>
      {!books && <Loading />}
      {[...groups.entries()].map(([shelf, list]) => (
        <section key={shelf}>
          <h2 className="section-title">{shelf}</h2>
          <div className="book-grid">
            {list.map((b) => (
              <a key={b.id} className="book-tile" href={`#/book/${b.id}`}>
                <span className="book-short">{b.short}</span>
                <span className="book-title">{b.title}</span>
                <span className="muted small">
                  {b.edition} · {b.pages} pages
                </span>
              </a>
            ))}
          </div>
        </section>
      ))}
      <OfflineDataCard name="books" compact />
    </>
  );
}

/** A book's table of contents. */
export function BookTocView({ id }: { id: string }) {
  const [book, setBook] = useState<BookInfo | null | undefined>(undefined);
  const [toc, setToc] = useState<BookEntry[] | null>(null);
  const [filter, setFilter] = useState('');
  const [depth, setDepth] = useState(3);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    bookInfo(id)
      .then((b) => setBook(b ?? null))
      .catch((e) => setErr(String(e.message || e)));
    bookToc(id)
      .then(setToc)
      .catch((e) => setErr(String(e.message || e)));
  }, [id]);

  const minLevel = useMemo(() => Math.min(...(toc || []).map((e) => e.level), 9), [toc]);
  const shown = useMemo(() => {
    if (!toc) return [];
    const f = filter.trim().toLowerCase();
    if (f) return toc.filter((e) => e.title.toLowerCase().includes(f)).slice(0, 400);
    return toc.filter((e) => e.level - minLevel < depth);
  }, [toc, filter, depth, minLevel]);

  if (err) return <Notice kind="error">{err.includes('not installed') ? 'Unlock your group’s books under My Books first.' : err}</Notice>;
  if (book === null) return <Notice kind="error">That book isn’t in the built-in library.</Notice>;
  if (!book || !toc) return <Loading />;

  return (
    <div className="page">
      <Header title={book.title} subtitle={`${book.shelf} · ${book.edition} · ${toc.length} sections`} />
      <div className="filters">
        <input className="filter-text" type="search" placeholder="Find in contents…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {!filter && (
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Detail">
            <option value={1}>Chapters only</option>
            <option value={2}>2 levels</option>
            <option value={3}>3 levels</option>
            <option value={9}>Everything</option>
          </select>
        )}
      </div>
      <ul className="list compact toc-list">
        {shown.map((e) => (
          <li key={e.id}>
            <a className="row" href={bookEntryHref(e)} style={{ paddingLeft: 14 + Math.min(e.level - minLevel, 5) * 16 }}>
              <div className="row-main">
                <div className={`row-title ${e.level === minLevel ? 'chapter-row' : ''}`}>
                  {e.title}
                  {e.kind !== 'rule' && <span className="row-meta">{BOOK_KIND_LABEL[e.kind]}</span>}
                </div>
              </div>
              <span className="muted small">p. {e.page}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One section of a book. */
export function BookEntryView({ book, anchor }: { book: string; anchor: string }) {
  const [entry, setEntry] = useState<BookEntry | null | undefined>(undefined);
  const [info, setInfo] = useState<BookInfo | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [nav, setNav] = useState<{ prev: BookEntry | null; next: BookEntry | null }>({ prev: null, next: null });
  const [err, setErr] = useState<string | null>(null);
  const [also, setAlso] = useState<Source[]>([]);

  useEffect(() => {
    setAlso([]);
    if (!entry || entry.kind === 'rule') return;
    let live = true;
    catalog(entry.kind as Category)
      .then((items) => {
        const it = items.find((x) => x.key === nameKey(entry.title));
        if (live && it) setAlso(it.sources.filter((s) => !(s.book === entry.book && s.page === entry.page)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [entry]);

  useEffect(() => {
    let live = true;
    setHtml(null);
    (async () => {
      const [e, b] = await Promise.all([bookEntry(book, anchor), bookInfo(book)]);
      if (!live) return;
      setEntry(e);
      setInfo(b ?? null);
      if (!e) return;
      let blocks = await blocksFor(book, e.start, e.end);
      if (blocks[0]?.startsWith('<h')) blocks = blocks.slice(1);
      if (!live) return;
      setHtml(blocks.join('\n'));
      setNav(await neighbours(e));
      recordVisit({ key: `bk:${book}/${anchor}`, source: 'book', title: e.title, subtitle: `${b?.short ?? book} p. ${e.page}`, href: bookEntryHref(e) });
    })().catch((x) => setErr(String(x.message || x)));
    return () => {
      live = false;
    };
  }, [book, anchor]);

  if (err) return <Notice kind="error">{err.includes('not installed') ? 'Unlock your group’s books under My Books first.' : err}</Notice>;
  if (entry === null) return <Notice kind="error">That section couldn’t be found.</Notice>;
  if (!entry || html === null) return <Loading />;

  const m = entry.meta || {};
  return (
    <article className="page entry">
      <Header
        title={entry.title}
        subtitle={
          <>
            {entry.kind !== 'rule' && <span className={`cat cat-${entry.kind === 'deity' ? 'class' : entry.kind}`}>{BOOK_KIND_LABEL[entry.kind]}</span>}{' '}
            <a href={`#/book/${book}`}>{info?.title}</a>, p. {entry.page}
            {entry.path ? ` · ${entry.path}` : ''}
          </>
        }
        actions={<BookmarkButton mark={{ key: `bk:${book}/${anchor}`, source: 'book', title: entry.title, subtitle: `${info?.short ?? book} p. ${entry.page}`, href: bookEntryHref(entry) }} />}
      />
      {(m.cr || m.price || m.ftype || m.portfolio) && (
        <div className="meta-strip">
          {m.cr && <span>CR {m.cr}</span>}
          {m.ctype && <span>{[m.size, m.ctype].filter(Boolean).join(' ')}</span>}
          {m.price && <span>{m.price}</span>}
          {m.slot && <span>Slot: {m.slot}</span>}
          {m.ftype && <span>{m.ftype}</span>}
          {m.portfolio && <span>Portfolio: {m.portfolio}</span>}
        </div>
      )}
      {also.length > 0 && (
        <div className="crosslinks">
          <span className="muted small">Also in:</span>
          {also.map((s) => (
            <a key={s.href} className="pill small" href={s.href}>
              {s.label}
            </a>
          ))}
        </div>
      )}
      <div className="content book" dangerouslySetInnerHTML={{ __html: html || '<p class="muted">(This heading has no text of its own — see the sections below.)</p>' }} />
      <nav className="prev-next">
        {nav.prev ? (
          <a className="btn subtle" href={bookEntryHref(nav.prev)}>
            <Icon name="prev" size={18} /> {nav.prev.title}
          </a>
        ) : (
          <span />
        )}
        {nav.next && (
          <a className="btn subtle" href={bookEntryHref(nav.next)}>
            {nav.next.title} <Icon name="next" size={18} />
          </a>
        )}
      </nav>
      <footer className="source-note">
        {info?.title}, page {entry.page}. From your group’s own copy — private to this app.
      </footer>
    </article>
  );
}
