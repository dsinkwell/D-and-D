// "Jump to" on the Search home: shortcut buttons the user can edit (remove, reorder, rename, add).
import { useEffect, useState } from 'react';
import { Icon, useDebounced } from '../components';
import { searchRules } from '../lib/catalog';
import { CATEGORY_LABEL, type Category } from '../lib/srd';
import { wikiHref } from '../lib/router';
import { offlineSearch } from '../lib/wikiOffline';
import { getShortcuts, onShortcutsChanged, resetShortcuts, saveShortcuts, type Shortcut } from '../lib/shortcuts';

export default function JumpTo() {
  const [list, setList] = useState<Shortcut[]>(getShortcuts);
  const [editing, setEditing] = useState(false);
  useEffect(() => onShortcutsChanged(() => setList(getShortcuts())), []);

  const update = (next: Shortcut[]) => {
    setList(next);
    saveShortcuts(next);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  return (
    <section>
      <div className="section-head">
        <h2 className="section-title">Jump to</h2>
        <button className="link-btn" onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {!editing ? (
        list.length ? (
          <div className="quick-grid">
            {list.map((x) => (
              <a key={x.href} className="quick" href={x.href}>
                {x.label}
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">No shortcuts. Tap Edit to add some, or use the pin button on any page.</p>
        )
      ) : (
        <div className="jump-edit">
          <ul className="jump-list">
            {list.map((x, i) => (
              <li key={x.href}>
                <input
                  className="jump-label"
                  value={x.label}
                  aria-label="Button name"
                  onChange={(e) => update(list.map((s, k) => (k === i ? { ...s, label: e.target.value } : s)))}
                />
                <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" size={18} />
                </button>
                <button className="icon-btn" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" size={18} />
                </button>
                <button className="icon-btn" aria-label="Remove" onClick={() => update(list.filter((_, k) => k !== i))}>
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <AddShortcut have={list} onAdd={(s) => update([...list, s])} />
          <p className="muted small">
            Tip: the <Icon name="pin" size={14} /> button on any spell, rule, book page or wiki article adds it here.{' '}
            <button className="link-btn" onClick={() => (resetShortcuts(), setList(getShortcuts()))}>
              Reset to the standard buttons
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

function AddShortcut({ have, onAdd }: { have: Shortcut[]; onAdd: (s: Shortcut) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [hits, setHits] = useState<{ label: string; href: string; kind: string }[]>([]);
  useEffect(() => {
    const t = dq.trim();
    if (!t) return setHits([]);
    let live = true;
    // the rule categories themselves, then rules/book entries, then wiki articles
    const cats = (Object.entries(CATEGORY_LABEL) as [Category, string][])
      .filter(([, l]) => l.toLowerCase().includes(t.toLowerCase()))
      .map(([c, l]) => ({ label: l, href: `#/rules/${c}`, kind: 'List' }));
    Promise.all([searchRules(t, 8).catch(() => []), offlineSearch(t, 5).catch(() => [])]).then(([rules, wiki]) => {
      if (!live) return;
      setHits([
        ...cats,
        ...rules.map((r) => ({ label: r.title, href: r.sources[0].href, kind: `${CATEGORY_LABEL[r.kind] || r.kind} · ${r.sources[0].short}` })),
        ...wiki.map((w) => ({ label: w.title, href: wikiHref(w.title), kind: 'Realms Wiki' })),
      ]);
    });
    return () => {
      live = false;
    };
  }, [dq]);
  const taken = new Set(have.map((s) => s.href));
  return (
    <div className="jump-add">
      <input type="search" placeholder="Add a button: search spells, rules, the wiki…" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="jump-hits">
          {hits.map((h) => (
            <li key={h.href}>
              <button
                disabled={taken.has(h.href)}
                onClick={() => {
                  onAdd({ label: h.label, href: h.href });
                  setQ('');
                }}
              >
                <Icon name={taken.has(h.href) ? 'pin-filled' : 'plus'} size={16} /> <b>{h.label}</b> <span className="muted">{h.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
