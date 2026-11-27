import { MouseEvent, useEffect, useRef, useState } from 'react';
import { BookmarkButton, Header, Icon, Loading, Notice, useOnline, PinButton } from '../components';
import { getHistory, recordVisit } from '../lib/bookmarks';
import { navigate, wikiHref } from '../lib/router';
import { useDbStatus } from '../lib/db';
import { CATEGORY_LABEL, Entry, entryHref, loadEntries } from '../lib/srd';
import { OfflineDataCard, versionDate } from '../OfflineData';
import {
  Article,
  CategoryMember,
  deleteSaved,
  getArticle,
  getCategoryMembers,
  listSaved,
  saveCategoryOffline,
  WikiError,
  wikiPageUrl,
} from '../lib/wiki';

const START = [
  { group: 'Places', items: ['Faerûn', 'Toril', 'Sword Coast', 'Waterdeep', "Baldur's Gate", 'Neverwinter', 'Cormyr', 'Dalelands', 'Moonsea', 'Thay', 'Calimshan', 'Underdark', 'Anauroch', 'Silver Marches'] },
  { group: 'Gods & powers', items: ['Faerûnian pantheon', 'Mystra', 'Tyr', 'Lathander', 'Shar', 'Selûne', 'Bane', 'Cyric', 'Tymora', 'Moradin', 'Corellon Larethian', 'Lolth'] },
  { group: 'Factions', items: ['Harpers', 'Zhentarim', 'Red Wizards of Thay', 'Lords\' Alliance', 'Cult of the Dragon', 'Emerald Enclave', 'Order of the Gauntlet'] },
  { group: 'History & lore', items: ['Netheril', 'Myth Drannor', 'Time of Troubles', 'Dale Reckoning', 'Calendar of Harptos', 'Weave', 'Shadow Weave', 'Elminster', 'Chosen of Mystra'] },
  { group: 'Categories', items: ['Category:Deities', 'Category:Organizations', 'Category:Settlements', 'Category:Locations', 'Category:Creatures', 'Category:Magic items'] },
];

export function WikiHome() {
  const [saved, setSaved] = useState<{ title: string; fetched: number }[] | null>(null);
  const [q, setQ] = useState('');
  const dbs = useDbStatus();
  const offlineInstalled = !!dbs?.installed.wiki;
  const online = useOnline();
  useEffect(() => {
    listSaved().then(setSaved);
  }, []);
  const recent = getHistory()
    .filter((h) => h.source === 'wiki')
    .slice(0, 8);

  return (
    <div className="page">
      <Header title="The Realms" subtitle="The Forgotten Realms Wiki" back={false} />
      <OfflineDataCard name="wiki" />
      {!online && !offlineInstalled && <Notice kind="warn">You’re offline. Articles you’ve opened before are still available; download the offline wiki above to have everything.</Notice>}
      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}&in=wiki`);
        }}
      >
        <Icon name="search" />
        <input type="search" enterKeyHint="search" placeholder="Search the Forgotten Realms Wiki…" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>

      {recent.length > 0 && (
        <section>
          <h2 className="section-title">Recently read</h2>
          <div className="pill-list">
            {recent.map((r) => (
              <a key={r.key} className="pill" href={r.href}>
                {r.title}
              </a>
            ))}
          </div>
        </section>
      )}

      {START.map((g) => (
        <section key={g.group}>
          <h2 className="section-title">{g.group}</h2>
          <div className="pill-list">
            {g.items.map((t) => (
              <a key={t} className="pill" href={wikiHref(t)}>
                {t.replace(/^Category:/, '')}
              </a>
            ))}
          </div>
        </section>
      ))}

      {!offlineInstalled && (
      <section>
        <h2 className="section-title">Saved on this device {saved && <span className="muted">· {saved.length}</span>}</h2>
        {saved && saved.length === 0 && <p className="muted">Every article you open is saved automatically for offline reading. Open a category to save all its articles at once.</p>}
        <SavedList saved={saved} onChange={() => listSaved().then(setSaved)} />
      </section>
      )}
    </div>
  );
}

function SavedList({ saved, onChange }: { saved: { title: string; fetched: number }[] | null; onChange: () => void }) {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  if (!saved || !saved.length) return null;
  const list = saved.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      {saved.length > 12 && <input className="filter-text" type="search" placeholder="Filter saved articles…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <ul className="list compact">
        {(showAll ? list : list.slice(0, 30)).map((s) => (
          <li key={s.title} className="row-with-action">
            <a className="row" href={wikiHref(s.title)}>
              <div className="row-main">
                <div className="row-title">{s.title}</div>
              </div>
            </a>
            <button className="icon-btn subtle" aria-label={`Remove ${s.title}`} onClick={() => deleteSaved(s.title).then(onChange)}>
              <Icon name="trash" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {!showAll && list.length > 30 && (
        <button className="more" onClick={() => setShowAll(true)}>
          Show all {list.length}
        </button>
      )}
    </>
  );
}

export function WikiPage({ title }: { title: string }) {
  const clean = title.replace(/_/g, ' ');
  if (/^Category:/i.test(clean)) return <WikiCategory title={clean} />;
  return <WikiArticle title={clean} />;
}

function WikiArticle({ title }: { title: string }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [err, setErr] = useState<WikiError | Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rules, setRules] = useState<Entry[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const dbs = useDbStatus();

  // 3.5 rules for the same thing (e.g. a spell, monster or magic item with the same name).
  useEffect(() => {
    if (!article) return;
    let live = true;
    const key = article.title.toLowerCase().replace(/\s*\(.*\)$/, '');
    loadEntries().then((all) => {
      if (!live) return;
      const hits = all.filter(
        (e) => e.c !== 'rule' && (e.t.toLowerCase() === key || e.al?.some((a) => a.toLowerCase() === key) || e.t.toLowerCase() === `${key}s` || `${e.t.toLowerCase()}s` === key),
      );
      setRules(hits.slice(0, 4));
    });
    return () => {
      live = false;
    };
  }, [article]);

  // Jump to a section when arriving through a redirect like "Waterdeep#History"; hide images that can't load offline.
  useEffect(() => {
    if (!article || !ref.current) return;
    // On phones, fold the (often very long) infobox so the article text comes first.
    if (window.matchMedia('(max-width: 700px)').matches) {
      ref.current.querySelectorAll('.portable-infobox').forEach((box) => {
        if (box.parentElement?.tagName === 'DETAILS') return;
        const d = document.createElement('details');
        d.className = 'infobox-wrap';
        const sum = document.createElement('summary');
        sum.textContent = `${box.querySelector('.pi-title')?.textContent?.trim() || 'Infobox'} — quick facts`;
        box.replaceWith(d);
        d.append(sum, box);
      });
    }
    ref.current.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => ((img.closest('figure') || img) as HTMLElement).style.setProperty('display', 'none'), { once: true }));
    if (article.frag) {
      const id = article.frag.replace(/ /g, '_');
      requestAnimationFrame(() => ref.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' }));
    }
  }, [article]);

  const load = () => {
    setErr(null);
    const ctrl = new AbortController();
    getArticle(title, { signal: ctrl.signal })
      .then(({ article, fromCache }) => {
        setArticle(article);
        setFromCache(fromCache);
        recordVisit({ key: `wiki:${article.title}`, source: 'wiki', title: article.title, subtitle: 'Forgotten Realms Wiki', href: wikiHref(article.title) });
        // Follow redirects in the address bar so bookmarks and sharing use the real title.
        if (article.title !== title) window.history.replaceState(null, '', wikiHref(article.title));
      })
      .catch((e) => e?.name !== 'AbortError' && setErr(e));
    return ctrl;
  };

  useEffect(() => {
    setArticle(null);
    const ctrl = load();
    return () => ctrl.abort();
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  const forceRefresh = async () => {
    setRefreshing(true);
    setErr(null);
    try {
      const r = await getArticle(title, { force: true });
      setArticle(r.article);
      setFromCache(r.fromCache);
      if (r.fromCache) setErr(new WikiError('Could not reach the live wiki — showing the copy on this device.', 'network'));
    } catch (e: any) {
      setErr(e);
    } finally {
      setRefreshing(false);
    }
  };

  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-frag]');
    if (a) {
      e.preventDefault();
      const id = a.getAttribute('data-frag')!;
      const el = ref.current?.querySelector(`[id="${CSS.escape(id)}"]`) || ref.current?.querySelector(`[id="${CSS.escape(id.replace(/ /g, '_'))}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (err && !article) {
    const missing = err instanceof WikiError && err.kind === 'missing';
    return (
      <div className="page">
        <Header title={title} subtitle="Forgotten Realms Wiki" />
        <Notice kind="error">
          {missing ? 'There is no wiki article with that title.' : err.message}{' '}
          {!missing && 'This article has not been saved on this device yet.'}
        </Notice>
        <p>
          <a href={`#/search?q=${encodeURIComponent(title)}&in=wiki`}>Search the wiki for “{title}” →</a>
        </p>
      </div>
    );
  }
  if (!article) return <Loading label="Opening article…" />;

  return (
    <article className="page wiki-article">
      <Header
        title={<span dangerouslySetInnerHTML={{ __html: article.displayTitle }} />}
        subtitle={
          <>
            Forgotten Realms Wiki
            {article.source === 'offline' ? (
              <span className="saved-flag"> · offline copy{dbs?.installed.wiki ? ` from ${versionDate(dbs.installed.wiki)?.toLocaleDateString() ?? ''}` : ''}</span>
            ) : fromCache ? (
              <span className="saved-flag"> · saved copy from {new Date(article.fetched).toLocaleDateString()}</span>
            ) : (
              <span className="saved-flag"> · live</span>
            )}
          </>
        }
        actions={
          <>
            <PinButton label={textOfTitle(article.displayTitle)} href={wikiHref(article.title)} />
            <button className="icon-btn" onClick={forceRefresh} disabled={refreshing || !navigator.onLine} title="Load the latest version from the live wiki" aria-label="Load the latest version from the live wiki">
              <Icon name="refresh" />
            </button>
            <a className="icon-btn" href={wikiPageUrl(article.title)} target="_blank" rel="noopener noreferrer" title="Open on the wiki" aria-label="Open on the wiki">
              <Icon name="external" />
            </a>
            <BookmarkButton mark={{ key: `wiki:${article.title}`, source: 'wiki', title: article.title, subtitle: 'Forgotten Realms Wiki', href: wikiHref(article.title) }} />
          </>
        }
      />
      {err && <Notice kind="warn">{err.message}</Notice>}
      {rules.length > 0 && (
        <div className="crosslinks">
          <span className="muted small">3.5 rules:</span>
          {rules.map((e) => (
            <a key={e.i} className="pill small" href={entryHref(e)}>
              <span className={`cat cat-${e.c}`}>{CATEGORY_LABEL[e.c]}</span> {e.t}
            </a>
          ))}
        </div>
      )}
      <div ref={ref} className="content wiki" onClick={onClick} dangerouslySetInnerHTML={{ __html: article.html }} />
      {article.categories.length > 0 && (
        <div className="wiki-cats">
          {article.categories.map((c) => (
            <a key={c} className="pill small" href={wikiHref(`Category:${c}`)}>
              {c}
            </a>
          ))}
        </div>
      )}
      <footer className="source-note">
        This article uses material from the “
        <a href={wikiPageUrl(article.title)} target="_blank" rel="noopener noreferrer">
          {article.title}
        </a>
        ” article on the Forgotten Realms Wiki at Fandom and is licensed under the{' '}
        <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">
          Creative Commons Attribution-Share Alike License
        </a>
        . Authors: see the{' '}
        <a href={`${wikiPageUrl(article.title)}?action=history`} target="_blank" rel="noopener noreferrer">
          page history
        </a>
        .
      </footer>
    </article>
  );
}

function WikiCategory({ title }: { title: string }) {
  const [members, setMembers] = useState<CategoryMember[]>([]);
  const [cont, setCont] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [fromOffline, setFromOffline] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const name = title.replace(/^Category:/i, '');

  const more = (c?: string) => {
    setLoading(true);
    getCategoryMembers(title, c)
      .then((r) => {
        setMembers((m) => [...m, ...r.members]);
        setCont(r.cont);
        setFromOffline(!!r.offline);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setMembers([]);
    more();
    return () => abort.current?.abort();
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAll = async () => {
    abort.current = new AbortController();
    setResult(null);
    setProgress({ done: 0, total: 0, current: '' });
    try {
      const r = await saveCategoryOffline(title, (done, total, current) => setProgress({ done, total, current }), abort.current.signal);
      setResult(`Saved ${r.saved} articles for offline reading.${r.failed.length ? ` ${r.failed.length} could not be fetched.` : ''}`);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setResult(e.message);
    } finally {
      setProgress(null);
    }
  };

  const subcats = members.filter((m) => m.isCategory);
  const pages = members.filter((m) => !m.isCategory);

  return (
    <div className="page">
      <Header title={name} subtitle="Wiki category" />
      {err && <Notice kind="error">{err}</Notice>}
      {fromOffline ? (
        <p className="muted small">From the offline copy on this device. Subcategories are listed when you’re online.</p>
      ) : (
      <div className="toolbar">
        {progress ? (
          <div className="progress">
            <div className="progress-bar">
              <div style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
            </div>
            <span>
              {progress.total ? `${progress.done} / ${progress.total}` : 'Listing articles…'} {progress.current && `· ${progress.current}`}
            </span>
            <button className="btn" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          </div>
        ) : (
          <button className="btn primary" onClick={saveAll} disabled={!!err}>
            <Icon name="download" size={18} /> Save all articles in this category for offline
          </button>
        )}
      </div>
      )}
      {result && <Notice>{result}</Notice>}
      {subcats.length > 0 && (
        <section>
          <h2 className="section-title">Subcategories</h2>
          <div className="pill-list">
            {subcats.map((m) => (
              <a key={m.title} className="pill" href={wikiHref(m.title)}>
                {m.title.replace(/^Category:/, '')}
              </a>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="section-title">Articles {pages.length > 0 && <span className="muted">· {pages.length}{cont ? '+' : ''}</span>}</h2>
        <ul className="list compact columns">
          {pages.map((m) => (
            <li key={m.title}>
              <a className="row" href={wikiHref(m.title)}>
                <div className="row-main">
                  <div className="row-title">{m.title}</div>
                </div>
              </a>
            </li>
          ))}
        </ul>
        {loading && <Loading />}
        {!loading && cont && (
          <button className="more" onClick={() => more(cont)}>
            Load more →
          </button>
        )}
      </section>
    </div>
  );
}

const textOfTitle = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
