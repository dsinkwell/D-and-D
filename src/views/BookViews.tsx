import { useEffect, useMemo, useState } from 'react';
import { BookmarkButton, Header, Icon, Loading, Notice, ShareButton, PinButton } from '../components';
import { formatEntry } from '../lib/statblock';
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
import { useAutolinked } from '../lib/autolink';
import { AddSpellToCharacter } from './CharacterViews';
import { AddToList } from './ListViews';
import { ReplacedBanner } from './HomebrewViews';

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
  // 'outline' = the book's own outline at every depth; 'chapters'; 'all' = every heading
  const [mode, setMode] = useState<'outline' | 'chapters' | 'all'>('outline');
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
  const hasOutline = useMemo(() => (toc || []).filter((e) => e.outline).length >= 8, [toc]);
  const shown = useMemo(() => {
    if (!toc) return [];
    const f = filter.trim().toLowerCase();
    if (f) return toc.filter((e) => e.title.toLowerCase().includes(f)).slice(0, 600);
    if (mode === 'chapters') return toc.filter((e) => e.level === minLevel);
    if (mode === 'outline') return hasOutline ? toc.filter((e) => e.outline && !/^Page \d+$/.test(e.title)) : toc.filter((e) => e.level - minLevel < 3);
    return toc;
  }, [toc, filter, mode, minLevel, hasOutline]);

  if (err) return <Notice kind="error">{err.includes('not installed') ? 'Unlock your group’s books under My Books first.' : err}</Notice>;
  if (book === null) return <Notice kind="error">That book isn’t in the built-in library.</Notice>;
  if (!book || !toc) return <Loading />;

  return (
    <div className="page">
      <Header
        title={book.title}
        subtitle={`${book.shelf} · ${book.edition} · ${toc.length} sections`}
        actions={<PinButton label={book.short || book.title} href={`#/book/${book.id}`} />}
      />
      <div className="filters">
        <input className="filter-text" type="search" placeholder="Find in contents…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {!filter && (
          <select value={mode} onChange={(e) => setMode(e.target.value as 'outline' | 'chapters' | 'all')} aria-label="Detail">
            <option value="outline">{hasOutline ? 'Book’s contents' : 'Main sections'}</option>
            <option value="chapters">Chapters only</option>
            <option value="all">Every heading</option>
          </select>
        )}
      </div>
      <ul className="list compact toc-list">
        {shown.map((e) => (
          <li key={e.id}>
            <a className="row" href={bookEntryHref(e)} style={{ paddingLeft: 14 + Math.min(e.level - minLevel, 7) * 13 }}>
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

  const body = useMemo(() => {
    if (!entry || html === null) return '';
    return (entry.kind !== 'rule' ? formatEntry(html, entry.kind) : html) || '<p class="muted">(This heading has no text of its own — see the sections below.)</p>';
  }, [entry, html]);
  const linked = useAutolinked(body, { selfHref: entry ? bookEntryHref(entry) : undefined, selfTitle: entry?.title });

  if (err) return <Notice kind="error">{err.includes('not installed') ? 'Unlock your group’s books under My Books first.' : err}</Notice>;
  if (entry === null) return <Notice kind="error">That section couldn’t be found.</Notice>;
  if (!entry || html === null) return <Loading />;

  const m = entry.meta || {};
  const isRef = entry.kind !== 'rule';
  const label = BOOK_KIND_LABEL[entry.kind];
  const mark = { key: `bk:${book}/${anchor}`, source: 'book' as const, title: entry.title, subtitle: `${label} · ${info?.short ?? book} p. ${entry.page}`, href: bookEntryHref(entry), kind: entry.kind };
  const facts = [m.ftype && `${m.ftype} feat`, m.price, m.slot && `Slot: ${m.slot}`, m.portfolio && `Portfolio: ${m.portfolio}`].filter(Boolean);
  return (
    <article className="page entry">
      <Header
        title={isRef ? `${label}: ${entry.title}` : entry.title}
        actions={
          <>
            <BookmarkButton mark={mark} />
            <PinButton label={entry.title} href={mark.href} />
            <ShareButton title={entry.title} />
          </>
        }
      />
      <div className="entry-head">
        <h1 className="entry-title">{entry.title}</h1>
        <div className="entry-source">
          <a href={`#/book/${book}`}>{info?.title}</a>, p. {entry.page}
          {entry.path ? ` · ${entry.path}` : ''}
        </div>
        {isRef && facts.length > 0 && <div className="entry-source">{facts.join(' · ')}</div>}
      </div>
      <ReplacedBanner title={entry.title} />
      <div className="entry-adds">
        {entry.kind === 'spell' && <AddSpellToCharacter title={entry.title} />}
        <AddToList item={{ key: mark.key, title: entry.title, href: mark.href, subtitle: mark.subtitle }} />
      </div>
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
      <div
        className={`content ${isRef ? 'ref' : 'book'}`}
        dangerouslySetInnerHTML={{ __html: linked }}
      />
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
