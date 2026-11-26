import { useEffect, useState } from 'react';
import { Header, Loading } from '../components';
import { Category, Chapter, loadChapters } from '../lib/srd';
import { catalog } from '../lib/catalog';

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
  { cat: 'trap', label: 'Traps', blurb: 'Sort by CR, from your books' },
  { cat: 'power', label: 'Psionic Powers', blurb: 'Filter by discipline & level' },
];

export default function RulesHome() {
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    loadChapters().then(setChapters);
    // Counts are of distinct names across the SRD and all books (duplicates merged).
    for (const b of BROWSE) catalog(b.cat).then((list) => setCounts((c) => ({ ...c, [b.cat]: list.length }))).catch(() => {});
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
              {counts[b.cat] !== undefined ? counts[b.cat].toLocaleString() : '…'}
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
