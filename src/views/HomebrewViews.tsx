// Homebrew (Saved → Homebrew, #/homebrew/<id>, #/homebrew/<id>/edit, #/homebrew/new): the group's
// own spells, feats, items, monsters, skills and rules, shown like book entries, plus the house
// rules switch and the "House rule" banner on printed entries a homebrew entry replaces.
import { useEffect, useMemo, useState } from 'react';
import { Header, Loading, Notice } from '../components';
import { formatEntry } from '../lib/statblock';
import { useAutolinked } from '../lib/autolink';
import { CATEGORY_LABEL, type Category } from '../lib/srd';
import { FIELD_PRESETS, homebrewHref, homebrewHtml, houseRulesOn, replacementFor, setHouseRulesOn, type HomebrewData, type HomebrewRecord } from '../lib/homebrew';
import { createRecord, deleteRecord, saveRecord, useRecord, useRecords, useUserData } from '../lib/userdata';
import { navigate, type Route } from '../lib/router';
import { AddToList } from './ListViews';
import { AddSpellToCharacter } from './CharacterViews';

const KINDS: Category[] = ['spell', 'feat', 'item', 'monster', 'skill', 'rule', 'class', 'prestige', 'race', 'condition', 'deity', 'trap'];
const isImported = (r: HomebrewRecord) => !!r.origin && r.origin !== r.id;

// ------------------------------------------------------------------ house rules switch + banner

export function useHouseRules(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(houseRulesOn);
  useEffect(() => {
    const f = () => setOn(houseRulesOn());
    window.addEventListener('rc-houserules', f);
    return () => window.removeEventListener('rc-houserules', f);
  }, []);
  return [on, setHouseRulesOn];
}

/** On a printed entry that a homebrew entry replaces: "House rule: replaced by Stealth". */
export function ReplacedBanner({ title }: { title: string }) {
  const [on, setOn] = useHouseRules();
  const v = useUserData();
  const [by, setBy] = useState<HomebrewRecord | null>(null);
  useEffect(() => {
    let live = true;
    // looked up even while house rules are off, so the banner can offer to switch them back on
    replacementFor(title, true).then((r) => live && setBy(r));
    return () => {
      live = false;
    };
  }, [title, on, v]);
  if (on && by)
    return (
      <div className="house-banner">
        <b>House rule:</b> replaced by <a href={homebrewHref(by.id)}>{by.name}</a>.{' '}
        <button className="linklike small" onClick={() => setOn(false)}>
          Show rules as written
        </button>
      </div>
    );
  if (!on && by)
    return (
      <div className="house-banner off">
        Showing the rules as written.{' '}
        <button className="linklike small" onClick={() => setOn(true)}>
          Use house rules
        </button>
      </div>
    );
  return null;
}

// ------------------------------------------------------------------ Saved → Homebrew

export function HomebrewSection() {
  const list = useRecords<HomebrewData>('homebrew');
  const [on, setOn] = useHouseRules();
  const [making, setMaking] = useState(false);
  const hasSkills = list.some((r) => r.data.kind === 'skill' && r.data.replaces?.length);
  return (
    <section>
      <h2 className="section-bar">Homebrew &amp; house rules</h2>
      <ul className="list">
        {list.map((r) => (
          <li key={r.id}>
            <a className="row" href={homebrewHref(r.id)}>
              <div className="row-main">
                <div className="row-title">
                  {r.name}
                  {r.data.draft && <span className="pill small">Draft</span>}
                </div>
                <div className="muted small">
                  {CATEGORY_LABEL[r.data.kind] || r.data.kind}
                  {r.data.replaces?.length ? ` · replaces ${r.data.replaces.join(', ')}` : ''}
                  {isImported(r) && r.author ? ` · from ${r.author}` : ''}
                </div>
              </div>
            </a>
          </li>
        ))}
        <li>
          <a className="row" href="#/homebrew/new">
            <div className="row-main">
              <div className="row-title">New homebrew entry…</div>
            </div>
          </a>
        </li>
      </ul>
      <div className="row-buttons">
        <label className="switch-row">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Use house rules (uncheck to see the rules as written)
        </label>
      </div>
      {!hasSkills && (
        <div className="row-buttons">
          <button
            className="btn subtle"
            disabled={making}
            onClick={async () => {
              setMaking(true);
              const { createSkillHouseRules } = await import('../lib/houserules');
              await createSkillHouseRules();
              setMaking(false);
            }}
          >
            {making ? 'Drafting…' : 'Draft the group’s skill house rules (Acrobatics, Athletics, Perception, Stealth, Investigate)'}
          </button>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ one entry

export function HomebrewView({ id }: { id: string }) {
  const rec = useRecord<HomebrewData>(id);
  const body = useMemo(() => {
    if (!rec) return '';
    const html = homebrewHtml(rec.data);
    return rec.data.kind === 'rule' ? html : formatEntry(html, rec.data.kind);
  }, [rec]);
  const linked = useAutolinked(body, { selfHref: homebrewHref(id), selfTitle: rec?.name });
  if (rec === null) return <Loading />;
  if (!rec) return <Notice kind="error">That homebrew entry isn’t on this device.</Notice>;
  const label = CATEGORY_LABEL[rec.data.kind] || rec.data.kind;
  const imported = isImported(rec);
  return (
    <article className="page entry">
      <Header
        title={`${label}: ${rec.name}`}
        actions={
          !imported && (
            <a className="btn subtle" href={`#/homebrew/${id}/edit`}>
              Edit
            </a>
          )
        }
      />
      <div className="entry-head">
        <h1 className="entry-title">{rec.name}</h1>
        <div className="entry-source">
          Homebrew{imported && rec.author ? ` · from ${rec.author}` : ''} · {label}
          {rec.data.replaces?.length ? ` · replaces ${rec.data.replaces.join(', ')}` : ''}
        </div>
      </div>
      {rec.data.draft && !imported && (
        <Notice kind="warn">
          Drafted by the app from the SRD and the group’s decisions. Read it through, change what you like with Edit, then save to remove this note.
        </Notice>
      )}
      <div className="entry-adds">
        {rec.data.kind === 'spell' && <AddSpellToCharacter title={rec.name} />}
        <AddToList item={{ key: `hb:${id}`, title: rec.name, href: homebrewHref(id), subtitle: `${label} · Homebrew` }} />
      </div>
      <div className={`content ${rec.data.kind === 'rule' ? 'book' : 'ref'}`} dangerouslySetInnerHTML={{ __html: linked }} />
      <footer className="source-note">The group’s own entry{imported ? ', imported from a shared file' : ''}.</footer>
    </article>
  );
}

// ------------------------------------------------------------------ editing

export function HomebrewEdit({ id, route }: { id: string; route: Route }) {
  const existing = useRecord<HomebrewData>(id === 'new' ? '__none__' : id);
  const [d, setD] = useState<HomebrewData | null>(null);
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [replaces, setReplaces] = useState('');
  useEffect(() => {
    if (d) return;
    if (id === 'new') {
      const kind = (route.query.get('kind') as Category) || 'spell';
      setD({ kind, fields: (FIELD_PRESETS[kind] || []).map((k) => [k, '']), text: '' });
    } else if (existing) {
      setD(structuredClone(existing.data));
      setName(existing.name);
      setAliases((existing.data.aliases || []).join(', '));
      setReplaces((existing.data.replaces || []).join(', '));
    }
  }, [id, existing, d, route]);
  if (!d) return id !== 'new' && existing === undefined ? <Notice kind="error">That homebrew entry isn’t on this device.</Notice> : <Loading />;

  const setKind = (kind: Category) => {
    const keep = new Map(d.fields);
    setD({ ...d, kind, fields: [...new Set([...(FIELD_PRESETS[kind] || []), ...d.fields.filter(([, v]) => v).map(([k]) => k)])].map((k) => [k, keep.get(k) || '']) });
  };
  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const data: HomebrewData = { ...d, aliases: list(aliases), replaces: list(replaces), draft: false };
    const r = id === 'new' ? await createRecord('homebrew', name.trim(), data) : await saveRecord({ ...existing!, name: name.trim(), data });
    navigate(homebrewHref(r.id), true);
  };

  return (
    <div className="page">
      <Header title={id === 'new' ? 'New homebrew entry' : `Edit ${existing?.name}`} />
      <form className="hb-form" onSubmit={save}>
        <div className="char-fields">
          <select value={d.kind} onChange={(e) => setKind(e.target.value as Category)} aria-label="Kind">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {CATEGORY_LABEL[k]}
              </option>
            ))}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" required />
        </div>
        {d.fields.map(([k, v], i) => (
          <div className="hb-field" key={i}>
            <input
              className="hb-label"
              value={k}
              onChange={(e) => setD({ ...d, fields: d.fields.map((f, j) => (j === i ? [e.target.value, f[1]] : f)) })}
              aria-label="Field name"
            />
            <input value={v} onChange={(e) => setD({ ...d, fields: d.fields.map((f, j) => (j === i ? [f[0], e.target.value] : f)) })} aria-label={k || 'Value'} />
          </div>
        ))}
        <button type="button" className="linklike small" onClick={() => setD({ ...d, fields: [...d.fields, ['', '']] })}>
          Add a line
        </button>
        <label className="hb-text">
          Description <span className="muted small">(blank line = new paragraph; **bold**, *italic*, “- ” for a list, “### ” for a heading)</span>
          <textarea value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} rows={12} />
        </label>
        <label className="hb-text">
          Also found as <span className="muted small">(other names, separated by commas)</span>
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </label>
        <label className="hb-text">
          Replaces <span className="muted small">(printed entries this replaces as a house rule, e.g. “Hide, Move Silently”)</span>
          <input value={replaces} onChange={(e) => setReplaces(e.target.value)} />
        </label>
        <div className="row-buttons">
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            Save
          </button>
          {id !== 'new' && (
            <button
              type="button"
              className="btn subtle danger-text"
              onClick={() => {
                if (confirm(`Delete ${existing?.name}?`)) {
                  deleteRecord(id);
                  navigate('#/saved', true);
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
