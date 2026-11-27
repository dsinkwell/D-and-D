import { useMemo, useRef, useState } from 'react';
import { Header, Notice, SourceBadge, StarToggle } from '../components';
import { clearHistory, getHistory, Mark, setBookmarks, useBookmarks } from '../lib/bookmarks';
import { useRecords } from '../lib/userdata';
import { ListsSection } from './ListViews';
import { HomebrewSection } from './HomebrewViews';
import { className, type Character } from '../lib/characters';

/** Characters (spellbooks) at the top of Saved. */
function CharactersShortcut() {
  const chars = useRecords<Character>('character');
  return (
    <section>
      <h2 className="section-bar">Characters</h2>
      <ul className="list">
        {chars.map((c) => (
          <li key={c.id}>
            <a className="row" href={`#/character/${c.id}`}>
              <div className="row-main">
                <div className="row-title">{c.name}</div>
                <div className="muted small">{c.data.classes.map((k) => `${className(k)} ${k.level}`).join(' / ')}</div>
              </div>
            </a>
          </li>
        ))}
        <li>
          <a className="row" href="#/characters">
            <div className="row-main">
              <div className="row-title">{chars.length ? 'All characters / new character…' : 'New character (spellbook, spells per day)…'}</div>
            </div>
          </a>
        </li>
      </ul>
    </section>
  );
}

// Bookmarks are grouped by what they are, in this order.
const GROUPS: [string, string][] = [
  ['spell', 'Spells'],
  ['feat', 'Feats'],
  ['monster', 'Monsters'],
  ['item', 'Magic Items'],
  ['prestige', 'Prestige Classes'],
  ['class', 'Classes'],
  ['deity', 'Deities'],
  ['trap', 'Traps'],
  ['power', 'Psionic Powers'],
  ['race', 'Races'],
  ['skill', 'Skills'],
  ['condition', 'Conditions'],
  ['rule', 'Rules & Book Sections'],
  ['wiki', 'Realms Wiki'],
];
const FROM_LABEL: Record<string, string> = {
  Spell: 'spell', Feat: 'feat', Monster: 'monster', 'Magic item': 'item', 'Prestige class': 'prestige', Class: 'class', Deity: 'deity',
  Trap: 'trap', 'Psionic power': 'power', Race: 'race', Skill: 'skill', Condition: 'condition',
};

/** What a bookmark is: stored kind, else read from its subtitle ("Spell · PHB p. 232"). */
function kindOf(m: Mark): string {
  if (m.source === 'wiki') return 'wiki';
  if (m.kind) return GROUPS.some(([k]) => k === m.kind) ? m.kind : 'rule';
  const first = (m.subtitle || '').split(' · ')[0];
  return FROM_LABEL[first] || 'rule';
}

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

  const [plan, setPlan] = useState<import('../lib/share').ImportPlan | null>(null);
  const finishImport = async (p: import('../lib/share').ImportPlan, how: import('../lib/share').Conflict) => {
    const { applyImport } = await import('../lib/share');
    const r = await applyImport(p, how);
    setPlan(null);
    const who = p.file.author ? ` from ${p.file.author}` : '';
    setMsg(`Imported${who}: ${[r.added && `${r.added} added`, r.replaced && `${r.replaced} updated`, r.skipped && `${r.skipped} skipped`].filter(Boolean).join(', ') || 'nothing new'}.`);
  };
  const importMarks = async (f?: File) => {
    if (!f) return;
    try {
      const text = await f.text();
      // a shared character, list or homebrew file
      const share = await import('../lib/share');
      const file = share.parseShareFile(text);
      if (file) {
        const p = await share.planImport(file);
        if (p.existing.length) setPlan(p);
        else await finishImport(p, 'skip');
        if (fileRef.current) fileRef.current.value = '';
        return;
      }
      const data = JSON.parse(text);
      const incoming: Mark[] = (data.bookmarks || []).filter((m: any) => m?.key && m?.href && m?.title && /^#\//.test(m.href));
      const map = new Map(marks.map((m) => [m.key, m]));
      incoming.forEach((m) => map.set(m.key, m));
      setBookmarks([...map.values()].sort((a, b) => b.at - a.at));
      setMsg(`Imported ${incoming.length} bookmarks.`);
    } catch {
      setMsg('That file is not a bookmarks export from this app.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const shown = marks.filter((m) => !f || m.title.toLowerCase().includes(f) || (m.subtitle || '').toLowerCase().includes(f));
    return GROUPS.map(([k, label]) => [label, shown.filter((m) => kindOf(m) === k).sort((a, b) => a.title.localeCompare(b.title))] as const).filter(
      ([, l]) => l.length,
    );
  }, [marks, filter]);

  return (
    <div className="page">
      <Header
        title="Saved"
        back={false}
        actions={
          <>
            <button className="btn subtle" onClick={exportMarks} disabled={!marks.length}>
              Export
            </button>
            <button className="btn subtle" onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json,.frref.json" hidden onChange={(e) => importMarks(e.target.files?.[0])} />
          </>
        }
      />
      {msg && <Notice>{msg}</Notice>}
      {plan && (
        <div className="card import-choice">
          <p>
            <b>{plan.existing.length === 1 ? `“${plan.existing[0].current.name}” is` : `${plan.existing.length} of these are`} already on this device.</b>
            {plan.fresh.length ? ` (${plan.fresh.length} new will be added.)` : ''}
          </p>
          <div className="row-buttons">
            <button className="btn primary" onClick={() => finishImport(plan, 'replace')}>
              Replace with the new version
            </button>
            <button className="btn subtle" onClick={() => finishImport(plan, 'both')}>
              Keep both
            </button>
            <button className="btn subtle" onClick={() => finishImport(plan, 'skip')}>
              Skip
            </button>
          </div>
        </div>
      )}
      <CharactersShortcut />
      <ListsSection />
      <HomebrewSection />
      {!marks.length && <p className="muted">Tap the ☆ next to any spell, feat, monster, item, book section or wiki article to save it here. Use Export/Import to copy bookmarks between your devices.</p>}
      {marks.length > 0 && (
        <div className="filters">
          <input className="filter-text" type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} autoCorrect="off" autoCapitalize="none" />
        </div>
      )}
      {groups.map(([label, list]) => (
        <section key={label}>
          <h2 className="section-bar">{label}</h2>
          <ul className="list">
            {list.map((m) => (
              <li key={m.key} className="ref-row">
                <a className="row" href={m.href}>
                  <div className="row-main">
                    <div className="ref-line">
                      <span className="ref-name">{m.title}</span>
                    </div>
                    {m.subtitle && <div className="ref-second">{m.subtitle}</div>}
                  </div>
                </a>
                <StarToggle mark={m} />
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
