import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Notice, SourceBadge, useDebounced, useOnline } from '../components';
import { getHistory } from '../lib/bookmarks';
import { BookHit, highlight, listBooks, searchBooks } from '../lib/library';
import { navigate, Route, wikiHref } from '../lib/router';
import { CATEGORY_LABEL } from '../lib/srd';
import { searchWikiBest, WikiSearchHit } from '../lib/wiki';
import { OfflineDataCard } from '../OfflineData';
import { booksReady } from '../lib/books';
import { CatalogItem, searchRules } from '../lib/catalog';
import { CatalogRow } from './CategoryView';

type Scope = 'all' | 'rules' | 'books' | 'wiki';
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'rules', label: 'Rules & books' },
  { id: 'wiki', label: 'Realms Wiki' },
  { id: 'books', label: 'Extra PDFs' },
];

const QUICK = [
  { label: 'Conditions', href: '#/rules/condition' },
  { label: 'Spells', href: '#/rules/spell' },
  { label: 'Feats', href: '#/rules/feat' },
  { label: 'Monsters', href: '#/rules/monster' },
  { label: 'Magic items', href: '#/rules/item' },
  { label: 'Combat', href: '#/srd/d/combat-i-basics' },
  { label: 'Special attacks', href: '#/srd/d/combat-ii-movement-modifiers-and-special-actions' },
  { label: 'Grapple', href: '#/srd/e/combat-ii-movement-modifiers-and-special-actions/grapple' },
  { label: 'Faerûn', href: wikiHref('Faerûn') },
  { label: 'Faerûnian pantheon', href: wikiHref('Faerûnian pantheon') },
];

export default function SearchView({ route }: { route: Route }) {
  const initialQ = route.query.get('q') || '';
  const scope = (route.query.get('in') as Scope) || 'all';
  const [q, setQ] = useState(initialQ);
  const dq = useDebounced(q, 160);
  const wq = useDebounced(q, 450);
  const online = useOnline();
  const inputRef = useRef<HTMLInputElement>(null);

  const [rules, setRules] = useState<CatalogItem[] | null>(null);
  const [books, setBooks] = useState<BookHit[] | null>(null);
  const [haveBooks, setHaveBooks] = useState(false);
  const [haveRulebooks, setHaveRulebooks] = useState(false);
  const [wiki, setWiki] = useState<WikiSearchHit[] | null>(null);
  const [wikiErr, setWikiErr] = useState<string | null>(null);
  const [wikiMode, setWikiMode] = useState<'offline' | 'live' | 'saved'>('live');

  // Pick up queries that arrive via navigation (e.g. links to #/search?q=…).
  const routeQ = route.query.get('q') || '';
  useEffect(() => {
    setQ((cur) => (cur.trim() === routeQ ? cur : routeQ));
  }, [routeQ]);

  // keep URL in sync (replace, so typing doesn't flood history)
  useEffect(() => {
    const want = dq.trim();
    if (want !== (route.query.get('q') || '')) {
      const params = new URLSearchParams();
      if (want) params.set('q', want);
      if (scope !== 'all') params.set('in', scope);
      const s = params.toString();
      window.history.replaceState(null, '', `#/search${s ? `?${s}` : ''}`);
    }
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listBooks().then((b) => setHaveBooks(b.length > 0));
    booksReady().then(setHaveRulebooks).catch(() => {});
    if (!initialQ && window.matchMedia('(min-width: 900px)').matches) inputRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    const query = dq.trim();
    if (!query) {
      setRules(null);
      setBooks(null);
      return;
    }
    searchRules(query, 80).then((r) => live && setRules(r)).catch(() => live && setRules([]));
    if (haveBooks) searchBooks(query, { limit: 60 }).then((r) => live && setBooks(r));
    return () => {
      live = false;
    };
  }, [dq, haveBooks, haveRulebooks]);

  useEffect(() => {
    const query = wq.trim();
    setWikiErr(null);
    if (!query || (scope !== 'all' && scope !== 'wiki')) {
      setWiki(null);
      return;
    }
    const ctrl = new AbortController();
    searchWikiBest(query, ctrl.signal)
      .then((r) => {
        setWiki(r.hits);
        setWikiMode(r.mode);
        if (r.error) setWikiErr(r.error);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [wq, scope, online]);

  const setScope = (s: Scope) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (s !== 'all') params.set('in', s);
    navigate(`/search?${params}`, true);
  };

  const history = useMemo(() => getHistory().slice(0, 12), []);
  const query = dq.trim();
  const limit = (n: number) => (scope === 'all' ? n : 500);

  return (
    <div className="page search-page">
      <div className="search-top">
        <h1 className="search-heading">3.5 Forgotten Realms Reference</h1>
        <form
          className="searchbar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            inputRef.current?.blur();
          }}
        >
          <Icon name="search" />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Search spells, feats, monsters, Faerûn, your books…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          {q && (
            <button type="button" className="icon-btn" aria-label="Clear" onClick={() => (setQ(''), inputRef.current?.focus())}>
              <Icon name="close" size={18} />
            </button>
          )}
        </form>
        <div className="chips" role="tablist">
          {SCOPES.filter((s) => s.id !== 'books' || haveBooks).map((s) => (
            <button key={s.id} role="tab" aria-selected={scope === s.id} className={`chip ${scope === s.id ? 'active' : ''}`} onClick={() => setScope(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!query && (
        <div className="home-blocks">
          <OfflineDataCard name="wiki" compact />
          <section>
            <h2 className="section-title">Jump to</h2>
            <div className="quick-grid">
              {QUICK.map((x) => (
                <a key={x.label} className="quick" href={x.href}>
                  {x.label}
                </a>
              ))}
            </div>
          </section>
          {history.length > 0 && (
            <section>
              <h2 className="section-title">Recently viewed</h2>
              <ul className="list">
                {history.map((h) => (
                  <li key={h.key}>
                    <a className="row" href={h.href}>
                      <SourceBadge source={h.source} />
                      <div className="row-main">
                        <div className="row-title">{h.title}</div>
                        {h.subtitle && <div className="row-sub">{h.subtitle}</div>}
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {query && (scope === 'all' || scope === 'rules') && (
        <section className="results">
          <h2 className="section-title">
            Rules <span className="muted">· {haveRulebooks ? 'your books and the 3.5 SRD' : '3.5 SRD'}</span>
          </h2>
          {rules === null && <p className="muted">Searching…</p>}
          {rules && rules.length === 0 && <p className="muted">No rules found for “{query}”.</p>}
          <ul className="list">
            {rules?.slice(0, limit(12)).map((r) => (
              <li key={r.key}>
                <CatalogRow item={r} badge={r.kind === 'rule' ? 'Rules' : CATEGORY_LABEL[r.kind]} />
              </li>
            ))}
          </ul>
          {scope === 'all' && rules && rules.length > 12 && (
            <button className="more" onClick={() => setScope('rules')}>
              All {rules.length >= 80 ? '80+' : rules.length} rules results →
            </button>
          )}
        </section>
      )}

      {query && (scope === 'all' || scope === 'wiki') && (
        <section className="results">
          <h2 className="section-title">
            Forgotten Realms Wiki{' '}
            {wikiMode === 'offline' ? <span className="muted">· offline copy</span> : wikiMode === 'saved' ? <span className="muted">· searching articles saved on this device</span> : null}
          </h2>
          {wikiErr && <Notice kind="warn">{wikiErr} Showing articles saved on this device.</Notice>}
          {wiki === null && <p className="muted">Searching…</p>}
          {wiki && wiki.length === 0 && <p className="muted">No wiki articles found.</p>}
          <ul className="list">
            {wiki?.slice(0, limit(8)).map((h) => (
              <li key={h.title}>
                <a className="row" href={wikiHref(h.title)}>
                  <span className="cat cat-wiki">Wiki</span>
                  <div className="row-main">
                    <div className="row-title">{h.title}</div>
                    {h.snippet && <div className="row-sub" dangerouslySetInnerHTML={{ __html: h.snippet }} />}
                  </div>
                </a>
              </li>
            ))}
          </ul>
          {scope === 'all' && wiki && wiki.length > 8 && (
            <button className="more" onClick={() => setScope('wiki')}>
              More wiki results →
            </button>
          )}
        </section>
      )}

      {query && haveBooks && (scope === 'all' || scope === 'books') && (
        <section className="results">
          <h2 className="section-title">
            Extra PDFs <span className="muted">· on this device</span>
          </h2>
          {books && books.length === 0 && <p className="muted">No matches in your books.</p>}
          <ul className="list">
            {books?.slice(0, limit(6)).map((h) => (
              <li key={`${h.book.id}:${h.page}`}>
                <a className="row" href={`#/library/${h.book.id}?p=${h.page}&q=${encodeURIComponent(query)}`}>
                  <span className="cat cat-book">p. {h.page}</span>
                  <div className="row-main">
                    <div className="row-title">{h.book.title}</div>
                    <div className="row-sub" dangerouslySetInnerHTML={{ __html: highlight(h.snippet, query) }} />
                  </div>
                </a>
              </li>
            ))}
          </ul>
          {scope === 'all' && books && books.length > 6 && (
            <button className="more" onClick={() => setScope('books')}>
              All {books.length} book matches →
            </button>
          )}
        </section>
      )}
    </div>
  );
}
