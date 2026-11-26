import { useEffect, useState } from 'react';
import { Header, Loading } from '../components';
import { Category, Chapter, Entry, loadChapters, loadEntries } from '../lib/srd';
import { booksReady, query as _q } from '../lib/booksCount';

export const BROWSE: { cat: Category; label: string; blurb: string }[] = [
  { cat: 'spell', label: 'Spells', blurb: 'Filter by class, level & school' },
  { cat: 'feat', label: 'Feats', blurb: 'General, metamagic, item creation, epic…' },
  { cat: 'monster', label: 'Monsters', blurb: 'Filter by type, sort by CR' },
  { cat: 'item', label: 'Magic Items', blurb: 'Wondrous items, rings, weapons, artifacts' },
  { cat: 'class', label: 'Classes', blurb: 'Core, NPC & psionic classes' },
  { cat: 'prestige', label: 'Prestige Classes', blurb: 'Including epic prestige classes' },
  { cat: 'race', label: 'Races', blurb: 'Core and psionic races' },
  { cat: 'skill', label: 'Skills', blurb: 'Every skill and its uses' },
  { cat: 'condition', label: 'Conditions', blurb: 'Blinded, grappling, stunned…' },
  { cat: 'deity', label: 'Deities', blurb: 'Faerûnian gods, from your books' },
  { cat: 'power', label: 'Psionic Powers', blurb: 'Filter by discipline & level' },
];

export default function RulesHome() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [bookCounts, setBookCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    loadEntries().then(setEntries);
    loadChapters().then(setChapters);
    booksReady()
      .then((ok) => (ok ? _q() : {}))
      .then(setBookCounts)
      .catch(() => {});
  }, []);

  const groups = new Map<string, Chapter[]>();
  for (const c of chapters || []) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group)!.push(c);
  }

  return (
    <div className="page">
      <Header title="Rules" subtitle="3.5 SRD plus your rulebooks" back={false} />
      <div className="tiles">
        {BROWSE.map((b) => (
          <a key={b.cat} className="tile" href={`#/rules/${b.cat}`}>
            <div className="tile-title">{b.label}</div>
            <div className="tile-count">
              {entries ? entries.filter((e) => e.c === b.cat).length + (bookCounts[b.cat] || 0) : '…'}
            </div>
            <div className="tile-blurb">{b.blurb}</div>
          </a>
        ))}
      </div>

      <h2 className="section-title">Chapters</h2>
      {!chapters && <Loading />}
      <div className="chapter-groups">
        {[...groups.entries()].map(([g, list]) => (
          <section key={g} className="chapter-group">
            <h3>{g}</h3>
            <ul className="list compact">
              {list.map((c) => (
                <li key={c.id}>
                  <a className="row" href={`#/srd/d/${c.id}`}>
                    <div className="row-main">
                      <div className="row-title">{c.title}</div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
