import { useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from './components';
import { useRoute } from './lib/router';
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

const TABS = [
  { id: 'search', label: 'Search', href: '#/', match: (p: string) => p === '/' || p.startsWith('/search') },
  { id: 'rules', label: 'Rules', href: '#/rules', match: (p: string) => p.startsWith('/rules') || p.startsWith('/srd') },
  { id: 'realms', label: 'Realms', href: '#/wiki', match: (p: string) => p.startsWith('/wiki') },
  { id: 'library', label: 'Books', href: '#/library', match: (p: string) => p.startsWith('/library') || p.startsWith('/book') },
  { id: 'saved', label: 'Saved', href: '#/saved', match: (p: string) => p.startsWith('/saved') },
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

  let view;
  switch (section) {
    case undefined:
    case 'search':
      view = <SearchView route={route} />;
      break;
    case 'rules':
      view = rest[0] ? <CategoryView cat={rest[0]} route={route} /> : <RulesHome />;
      break;
    case 'srd':
      if (rest[0] === 'e') view = <EntryView id={`${rest[1]}/${rest[2]}`} />;
      else view = <ChapterView id={rest[1]} at={route.query.get('at') || undefined} />;
      break;
    case 'wiki':
      view = rest.length ? <WikiPage title={rest.join('/')} /> : <WikiHome />;
      break;
    case 'library':
      view = rest[0] ? <BookView id={rest[0]} route={route} /> : <LibraryView />;
      break;
    case 'book':
      view = rest[1] ? <BookEntryView book={rest[0]} anchor={rest.slice(1).join('/')} /> : <BookTocView id={rest[0]} />;
      break;
    case 'saved':
      view = <SavedView />;
      break;
    case 'about':
      view = <AboutView />;
      break;
    default:
      view = <SearchView route={route} />;
  }

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <a className="brand" href="#/">
          <img src="icons/icon.svg" alt="" width={30} height={30} />
          <span>3.5 Forgotten Realms Reference</span>
        </a>
        {TABS.map((t) => (
          <a key={t.id} href={t.href} className={`nav-item ${t.match(route.path) ? 'active' : ''}`}>
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
      <main className="main" key={section || 'search'}>
        {view}
      </main>
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
