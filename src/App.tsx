import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './components';
import { parseHash, Route, useRoute } from './lib/router';
import { PaneContext, paneKind, SPLIT_QUERY, useMediaQuery } from './lib/pane';
import { loadEntries, loadIndex } from './lib/srd';
import SearchView from './views/SearchView';
import RulesHome from './views/RulesHome';
import CategoryView from './views/CategoryView';
import EntryView from './views/EntryView';
import ChapterView from './views/ChapterView';
import { WikiHome, WikiPage } from './views/WikiViews';
import { LibraryView, BookView } from './views/LibraryViews';
import { BookEntryView, BookTocView } from './views/BookViews';
import SavedView from './views/SavedView';
import AboutView from './views/AboutView';
import AskView from './views/AskView';
import { CalendarView, ToolsHome, TravelView } from './views/ToolsViews';
import DiceTray from './DiceTray';
import { CharacterView, CharactersView } from './views/CharacterViews';
import { ListView } from './views/ListViews';
import { HomebrewEdit, HomebrewView } from './views/HomebrewViews';

const TABS = [
  { id: 'search', label: 'Search', href: '#/', match: (p: string) => p === '/' || p.startsWith('/search') || p.startsWith('/ask') },
  { id: 'rules', label: 'Rules', href: '#/rules', match: (p: string) => p.startsWith('/rules') || p.startsWith('/srd') },
  { id: 'realms', label: 'Realms', href: '#/wiki', match: (p: string) => p.startsWith('/wiki') || p.startsWith('/tools') },
  { id: 'library', label: 'Books', href: '#/library', match: (p: string) => p.startsWith('/library') || p.startsWith('/book') },
  { id: 'saved', label: 'Saved', href: '#/saved', match: (p: string) => p.startsWith('/saved') || p.startsWith('/character') || p.startsWith('/list') || p.startsWith('/homebrew') },
];

export default function App() {
  const route = useRoute();
  const [section, ...rest] = route.parts;

  // Warm up the SRD data and search index in the background.
  useEffect(() => {
    const idle = (window as any).requestIdleCallback || ((f: () => void) => setTimeout(f, 300));
    idle(() => loadEntries().then(() => loadIndex()));
  }, []);

  // Remember scroll position per route so "Back" returns you to where you were.
  const scrollMem = useRef(new Map<string, number>());
  const lastHash = useRef(route.hash);
  useLayoutEffect(() => {
    scrollMem.current.set(lastHash.current, window.scrollY);
    lastHash.current = route.hash;
    const y = scrollMem.current.get(route.hash) ?? 0;
    window.scrollTo(0, y);
    // content may load asynchronously; try again shortly
    if (y) setTimeout(() => window.scrollY === 0 && window.scrollTo(0, y), 120);
  }, [route.hash]);

  const view = viewFor(route);

  // Wide screens: the list you came from (search results, a category, a book's contents…) stays
  // on the left while the entry it opened shows on the right.
  const wide = useMediaQuery(SPLIT_QUERY);
  const kind = paneKind(route);
  const [listHash, setListHash] = useState<string | null>(() => (kind === 'list' ? route.hash : null));
  useEffect(() => {
    if (kind === 'list') setListHash(route.hash);
    else if (kind === 'other') setListHash(null);
  }, [route.hash, kind]);
  // a book section opened directly: its book's contents on the left
  const leftHash = listHash ?? (section === 'book' && rest[1] ? `/book/${rest[0]}` : null);
  const split = wide && kind === 'detail' && !!leftHash;

  // the open entry highlighted in the left pane, and kept in view
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const pane = listRef.current;
    if (!split || !pane) return;
    const mark = () => {
      let current: HTMLElement | null = null;
      pane.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
        const on = decodeURIComponent(a.getAttribute('href') || '') === decodeURIComponent(`#${route.hash}`);
        a.classList.toggle('is-current', on);
        if (on && !current) current = a;
      });
      const c = current as HTMLElement | null;
      if (c) {
        const r = c.getBoundingClientRect();
        const pr = pane.getBoundingClientRect();
        if (r.top < pr.top + 60 || r.bottom > pr.bottom) c.scrollIntoView({ block: 'nearest' });
      }
    };
    mark();
    const t = setTimeout(mark, 400); // lists can render after their data loads
    // a book section that isn't in the list on the left (opened from a link or a bookmark):
    // show its book's contents there instead
    const t2 = setTimeout(() => {
      const bookToc = section === 'book' && rest[1] ? `/book/${rest[0]}` : null;
      if (bookToc && leftHash !== bookToc && pane.querySelectorAll('a[href^="#"]').length > 5 && !pane.querySelector('a.is-current')) setListHash(bookToc);
    }, 900);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [split, route.hash, leftHash]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <a className="brand" href="#/">
          <img src="icons/icon.svg" alt="" width={30} height={30} />
          <span>3.5 Forgotten Realms Reference</span>
        </a>
        {TABS.map((t) => (
          <a key={t.id} href={t.href} className={`nav-item ${t.match(split ? parseHash(`#${leftHash}`).path : route.path) ? 'active' : ''}`}>
            <Icon name={t.id} />
            <span>{t.label}</span>
          </a>
        ))}
        <div className="nav-spacer" />
        <a href="#/about" className={`nav-item ${route.path.startsWith('/about') ? 'active' : ''}`}>
          <Icon name="about" />
          <span>About &amp; Settings</span>
        </a>
      </nav>
      {split ? (
        <main className="main split" key="split">
          <PaneContext.Provider value={{ embedded: true, setList: setListHash }}>
            <aside className="pane-list" ref={listRef} key={leftHash!.split('?')[0]} aria-label="List">
              {viewFor(parseHash(`#${leftHash}`))}
            </aside>
          </PaneContext.Provider>
          <section className="pane-detail" key={section}>
            {view}
          </section>
        </main>
      ) : (
        <main className="main" key={section || 'search'}>
          {view}
        </main>
      )}
      <DiceTray />
      <nav className="tabbar" aria-label="Tabs">
        {TABS.map((t) => (
          <a key={t.id} href={t.href} className={`tab ${t.match(route.path) ? 'active' : ''}`}>
            <Icon name={t.id} />
            <span>{t.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

function viewFor(route: Route) {
  const [section, ...rest] = route.parts;
  switch (section) {
    case undefined:
    case 'search':
      return <SearchView route={route} />;
    case 'rules':
      return rest[0] ? <CategoryView cat={rest[0]} route={route} /> : <RulesHome />;
    case 'srd':
      if (rest[0] === 'e') return <EntryView id={`${rest[1]}/${rest[2]}`} />;
      else return <ChapterView id={rest[1]} at={route.query.get('at') || undefined} />;
    case 'wiki':
      return rest.length ? <WikiPage title={rest.join('/')} /> : <WikiHome />;
    case 'library':
      return rest[0] ? <BookView id={rest[0]} route={route} /> : <LibraryView />;
    case 'book':
      return rest[1] ? <BookEntryView book={rest[0]} anchor={rest.slice(1).join('/')} /> : <BookTocView id={rest[0]} />;
    case 'ask':
      return <AskView route={route} />;
    case 'saved':
      return <SavedView />;
    case 'characters':
      return <CharactersView />;
    case 'character':
      return <CharacterView id={rest[0]} />;
    case 'list':
      return <ListView id={rest[0]} />;
    case 'homebrew':
      return rest[0] === 'new' || rest[1] === 'edit' ? <HomebrewEdit id={rest[0]} route={route} /> : <HomebrewView id={rest[0]} />;
    case 'about':
      return <AboutView />;
    case 'tools':
      return rest[0] === 'calendar' ? <CalendarView /> : rest[0] === 'travel' ? <TravelView /> : <ToolsHome />;
    default:
      return <SearchView route={route} />;
  }

}
