// Characters (Saved → Characters, #/characters, #/character/<id>): per-character spellbooks with
// spells per day, prepared or known spells, and what has been cast today.
import { useEffect, useMemo, useState } from 'react';
import { Header, Icon, Loading, Notice } from '../components';
import {
  abilityMod,
  castingOf,
  className,
  classTables,
  createCharacter,
  LIST_KEYS,
  listKeyOf,
  newClass,
  preparedAt,
  refOf,
  rest,
  slotsFor,
  spellsFor,
  SRD_CLASSES,
  updateCharacter,
  usesSpellbook,
  type CastingClass,
  type Character,
  type ClassInfo,
  type LevelSlots,
  type SpellRef,
} from '../lib/characters';
import { deleteRecord, useRecord, useRecords } from '../lib/userdata';
import { navigate } from '../lib/router';
import { ShareRecordsButton } from './ListViews';

const LEVEL_NAME = ['0-level', '1st-level', '2nd-level', '3rd-level', '4th-level', '5th-level', '6th-level', '7th-level', '8th-level', '9th-level'];
const ABIL: Record<string, string> = { Int: 'Int', Wis: 'Wis', Cha: 'Cha' };

function useClassTables() {
  const [info, setInfo] = useState<Record<string, ClassInfo> | null>(null);
  useEffect(() => {
    classTables().then(setInfo);
  }, []);
  return info;
}

// ------------------------------------------------------------------ list

export function CharactersView() {
  const chars = useRecords<Character>('character');
  const info = useClassTables();
  const [name, setName] = useState('');
  const [cls, setCls] = useState('Wizard');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await createCharacter(name.trim(), cls);
    navigate(`#/character/${r.id}`);
  };
  return (
    <div className="page">
      <Header title="Characters" />
      <p className="muted small">Each character keeps their own spells: spells per day from the class table and their key ability, the spells they know or have prepared, and what they have cast today.</p>
      {chars.length > 0 && (
        <ul className="list">
          {chars.map((c) => (
            <li key={c.id}>
              <a className="row" href={`#/character/${c.id}`}>
                <div className="row-main">
                  <div className="row-title">{c.name}</div>
                  <div className="muted small">{c.data.classes.map((k) => `${className(k)} ${k.level}`).join(' / ')}</div>
                </div>
                <Icon name="next" size={18} />
              </a>
            </li>
          ))}
        </ul>
      )}
      <form className="card char-new" onSubmit={add}>
        <h2>New character</h2>
        <div className="char-fields">
          <input placeholder="Name (e.g. Elandra)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Character name" />
          <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Spellcasting class">
            {SRD_CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
            <option value="Other">Other class (enter spells per day)</option>
          </select>
          <button className="btn primary" type="submit" disabled={!name.trim() || !info}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ one character

export function CharacterView({ id }: { id: string }) {
  const rec = useRecord<Character>(id);
  const info = useClassTables();
  const [renaming, setRenaming] = useState(false);
  if (rec === null || !info) return <Loading />;
  if (!rec) return <Notice kind="error">That character isn’t on this device.</Notice>;
  const ch = rec.data;
  const change = (f: (c: Character) => void) => updateCharacter(id, f);

  return (
    <div className="page character">
      <Header
        title={rec.name}
        actions={
          <>
            <ShareRecordsButton records={[rec]} title={rec.name} />
            <button className="btn subtle" onClick={() => setRenaming(!renaming)}>
              Rename
            </button>
          </>
        }
      />
      {renaming && (
        <form
          className="char-fields"
          onSubmit={(e) => {
            e.preventDefault();
            const v = (e.currentTarget.elements.namedItem('n') as HTMLInputElement).value.trim();
            if (v) updateCharacter(id, () => {}, v);
            setRenaming(false);
          }}
        >
          <input name="n" defaultValue={rec.name} aria-label="New name" autoFocus />
          <button className="btn primary" type="submit">
            Save
          </button>
        </form>
      )}
      <div className="row-buttons">
        <button className="btn primary" onClick={() => change(rest)}>
          New day (all spells back)
        </button>
      </div>
      {ch.classes.map((c, i) => (
        <ClassBlock key={c.id} c={c} info={info} onChange={(f) => change((x) => f(x.classes[i]))} onRemove={ch.classes.length > 1 ? () => change((x) => void x.classes.splice(i, 1)) : undefined} />
      ))}
      <div className="row-buttons">
        <button className="btn subtle" onClick={() => change((x) => void x.classes.push(newClass('Cleric')))}>
          Add another spellcasting class
        </button>
        <button
          className="btn subtle danger-text"
          onClick={() => {
            if (confirm(`Delete ${rec.name} from this device?`)) {
              deleteRecord(id);
              navigate('#/characters', true);
            }
          }}
        >
          Delete character
        </button>
      </div>
    </div>
  );
}

function ClassBlock({ c, info, onChange, onRemove }: { c: CastingClass; info: Record<string, ClassInfo>; onChange: (f: (c: CastingClass) => void) => void; onRemove?: () => void }) {
  const slots = useMemo(() => slotsFor(c, info), [c, info]);
  const casting = castingOf(c, info);
  const listKey = listKeyOf(c, info);
  const ability = c.cls === 'Other' ? 'Key ability' : ABIL[info[c.cls]?.ability] || 'Ability';
  const [picker, setPicker] = useState<null | { level: number; mode: 'known' | 'prepare'; slot?: number }>(null);

  return (
    <section className="card char-class">
      <div className="char-fields">
        <select value={c.cls} onChange={(e) => onChange((x) => void (x.cls = e.target.value))} aria-label="Class">
          {SRD_CLASSES.map((k) => (
            <option key={k}>{k}</option>
          ))}
          <option value="Other">Other</option>
        </select>
        <label>
          Level{' '}
          <select value={c.level} onChange={(e) => onChange((x) => void (x.level = Number(e.target.value)))}>
            {Array.from({ length: 20 }, (_, i) => (
              <option key={i + 1}>{i + 1}</option>
            ))}
          </select>
        </label>
        <label>
          {ability}{' '}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={c.score}
            onChange={(e) => onChange((x) => void (x.score = Math.max(1, Math.min(60, Number(e.target.value) || 10))))}
            className="num"
          />{' '}
          <span className="muted small">({abilityMod(c.score) >= 0 ? '+' : ''}{abilityMod(c.score)})</span>
        </label>
        {onRemove && (
          <button className="icon-btn" onClick={onRemove} aria-label="Remove this class">
            <Icon name="close" />
          </button>
        )}
      </div>
      {c.cls === 'Other' && <OtherClassFields c={c} onChange={onChange} />}
      {c.cls === 'Cleric' && (
        <label className="char-domains">
          Domains{' '}
          <input value={c.domains || ''} placeholder="e.g. Fire, Sun" onChange={(e) => onChange((x) => void (x.domains = e.target.value))} />
        </label>
      )}
      {!slots.length && <p className="muted small">No spells at this level yet.</p>}

      {slots.map((s) => (
        <div key={s.level} className="char-level">
          <h3>
            {LEVEL_NAME[s.level]} <span className="muted small">{perDayText(s, ability)}</span>
          </h3>
          {s.tooLow && <p className="small muted">Needs {ability} {10 + s.level} to cast spells of this level.</p>}
          {casting === 'spontaneous' ? (
            <Spontaneous c={c} s={s} onChange={onChange} onAdd={() => setPicker({ level: s.level, mode: 'known' })} />
          ) : (
            <Prepared c={c} s={s} onChange={onChange} onPick={(slot) => setPicker({ level: s.level, mode: 'prepare', slot })} onAddBook={() => setPicker({ level: s.level, mode: 'known' })} />
          )}
        </div>
      ))}
      {picker && (
        <SpellPicker
          title={picker.mode === 'known' ? (usesSpellbook(c) ? `Add to spellbook (${LEVEL_NAME[picker.level]})` : `Add a spell known (${LEVEL_NAME[picker.level]})`) : `Prepare a ${LEVEL_NAME[picker.level]} spell`}
          listKey={listKey}
          level={picker.level}
          domains={picker.mode === 'prepare' && c.cls === 'Cleric' ? c.domains : undefined}
          // wizards prepare from their spellbook (all cantrips are in it)
          from={picker.mode === 'prepare' && usesSpellbook(c) && picker.level > 0 ? c.known.filter((k) => k.level === picker.level) : undefined}
          onClose={() => setPicker(null)}
          onPick={(ref) => {
            onChange((x) => {
              if (picker.mode === 'known') {
                if (!x.known.some((k) => k.key === ref.key && k.level === ref.level)) x.known.push(ref);
              } else {
                const sl = slots.find((y) => y.level === picker.level)!;
                const list = preparedAt(x, sl);
                list[picker.slot!] = { ...list[picker.slot!], spell: ref, used: false };
                x.prepared[picker.level] = list;
              }
            });
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}

function perDayText(s: LevelSlots, ability: string) {
  if (s.tooLow) return '';
  const parts = [`${s.total + s.domain} per day`];
  const why: string[] = [];
  if (s.base !== null && (s.bonus || s.extra || s.domain)) why.push(`${s.base} from the class table`);
  if (s.bonus) why.push(`${s.bonus} bonus from ${ability}`);
  if (s.domain) why.push(`${s.domain} domain`);
  if (s.extra) why.push(`${s.extra > 0 ? '+' : ''}${s.extra} adjusted`);
  return parts.concat(why.length ? [`(${why.join(', ')})`] : []).join(' ');
}

function OtherClassFields({ c, onChange }: { c: CastingClass; onChange: (f: (c: CastingClass) => void) => void }) {
  const row = (vals: (number | null)[] | undefined, key: 'manual' | 'manualKnown') => (
    <div className="char-manual">
      {Array.from({ length: 10 }, (_, l) => (
        <label key={l}>
          <span className="muted small">{l === 0 ? '0' : LEVEL_NAME[l].slice(0, 3)}</span>
          <input
            className="num"
            inputMode="numeric"
            value={vals?.[l] ?? ''}
            placeholder="—"
            onChange={(e) =>
              onChange((x) => {
                const arr = (x[key] ||= Array(10).fill(null));
                const v = e.target.value.trim();
                arr[l] = v === '' ? null : Math.max(0, Math.min(20, Number(v) || 0));
              })
            }
          />
        </label>
      ))}
    </div>
  );
  return (
    <div className="char-other">
      <div className="char-fields">
        <input value={c.name || ''} placeholder="Class name (e.g. Warmage)" onChange={(e) => onChange((x) => void (x.name = e.target.value))} aria-label="Class name" />
        <select value={c.casting || 'prepared'} onChange={(e) => onChange((x) => void (x.casting = e.target.value as 'prepared' | 'spontaneous'))} aria-label="Casting">
          <option value="prepared">Prepares spells</option>
          <option value="spontaneous">Casts spontaneously</option>
        </select>
        <select value={c.listKey || 'Sor/Wiz'} onChange={(e) => onChange((x) => void (x.listKey = e.target.value))} aria-label="Spell list">
          {LIST_KEYS.map(([k, label]) => (
            <option key={k} value={k}>
              {label} spell list
            </option>
          ))}
        </select>
      </div>
      <p className="small muted">Spells per day from the class table, by spell level (leave “—” where the table has none; bonus spells are added for you):</p>
      {row(c.manual, 'manual')}
      {c.casting === 'spontaneous' && (
        <>
          <p className="small muted">Spells known:</p>
          {row(c.manualKnown, 'manualKnown')}
        </>
      )}
    </div>
  );
}

function SpellLink({ r }: { r: SpellRef }) {
  return r.href ? <a href={r.href}>{r.title}</a> : <span>{r.title}</span>;
}

function Prepared({ c, s, onChange, onPick, onAddBook }: { c: CastingClass; s: LevelSlots; onChange: (f: (c: CastingClass) => void) => void; onPick: (slot: number) => void; onAddBook: () => void }) {
  const slots = preparedAt(c, s);
  const book = usesSpellbook(c) && s.level > 0 ? c.known.filter((k) => k.level === s.level) : null;
  const setSlot = (i: number, f: (p: (typeof slots)[number]) => void) =>
    onChange((x) => {
      const list = preparedAt(x, s);
      f(list[i]);
      x.prepared[s.level] = list;
    });
  return (
    <>
      <ul className="char-slots">
        {slots.map((p, i) => (
          <li key={i} className={p.used ? 'used' : ''}>
            <label className="cast-box" title={p.used ? 'Cast' : 'Not cast yet'}>
              <input type="checkbox" checked={p.used} disabled={!p.spell} onChange={() => setSlot(i, (x) => void (x.used = !x.used))} aria-label={p.spell ? `Cast ${p.spell.title}` : 'Empty slot'} />
            </label>
            {p.spell ? <SpellLink r={p.spell} /> : <span className="muted">Empty slot</span>}
            {p.domain && <span className="pill small">Domain</span>}
            <button className="linklike small" onClick={() => onPick(i)}>
              {p.spell ? 'Change' : 'Prepare…'}
            </button>
            {p.spell && (
              <button className="icon-btn small-icon" onClick={() => setSlot(i, (x) => void (x.spell = undefined))} aria-label="Clear this slot">
                <Icon name="close" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {book && (
        <details className="char-book">
          <summary>
            Spellbook: {book.length} {book.length === 1 ? 'spell' : 'spells'}
          </summary>
          <ul>
            {book.map((k) => (
              <li key={k.key}>
                <SpellLink r={k} />{' '}
                <button className="icon-btn small-icon" onClick={() => onChange((x) => void (x.known = x.known.filter((y) => !(y.key === k.key && y.level === k.level))))} aria-label={`Remove ${k.title} from the spellbook`}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
          <button className="linklike small" onClick={onAddBook}>
            Add a spell to the spellbook…
          </button>
        </details>
      )}
    </>
  );
}

function Spontaneous({ c, s, onChange, onAdd }: { c: CastingClass; s: LevelSlots; onChange: (f: (c: CastingClass) => void) => void; onAdd: () => void }) {
  const used = Math.min(c.used[s.level] || 0, s.total);
  const known = c.known.filter((k) => k.level === s.level);
  const setUsed = (n: number) =>
    onChange((x) => {
      x.used ||= [];
      x.used[s.level] = Math.max(0, Math.min(s.total, n));
    });
  return (
    <>
      <div className="char-dots" role="group" aria-label={`${s.total - used} of ${s.total} left`}>
        {Array.from({ length: s.total }, (_, i) => (
          <button key={i} className={`dot ${i < used ? 'spent' : ''}`} onClick={() => setUsed(i < used ? i : i + 1)} aria-label={i < used ? 'Spent (tap to restore)' : 'Available (tap to spend)'} />
        ))}
        <span className="muted small">
          {s.total - used} of {s.total} left
        </span>
        {s.total > 0 && (
          <button className="btn small" onClick={() => setUsed(used + 1)} disabled={used >= s.total}>
            Cast
          </button>
        )}
      </div>
      <ul className="char-known">
        {known.map((k) => (
          <li key={k.key}>
            <SpellLink r={k} />{' '}
            <button className="icon-btn small-icon" onClick={() => onChange((x) => void (x.known = x.known.filter((y) => !(y.key === k.key && y.level === k.level))))} aria-label={`Remove ${k.title}`}>
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button className="linklike small" onClick={onAdd}>
        Add a spell known…{s.known != null ? ` (${known.length} of ${s.known})` : ''}
      </button>
    </>
  );
}

// ------------------------------------------------------------------ choosing a spell

function SpellPicker({ title, listKey, level, domains, from, onPick, onClose }: { title: string; listKey: string; level: number; domains?: string; from?: SpellRef[]; onPick: (r: SpellRef) => void; onClose: () => void }) {
  const [all, setAll] = useState<SpellRef[] | null>(null);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(!from);
  useEffect(() => {
    spellsFor(listKey, level, domains).then((list) => setAll(list.map((it) => ({ ...refOf(it, level), source: it.sources[0]?.short })) as SpellRef[]));
  }, [listKey, level, domains]);
  const list = (showAll ? all : from) || [];
  const f = q.trim().toLowerCase();
  const shown = list.filter((r) => !f || r.title.toLowerCase().includes(f));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <input type="search" placeholder="Find a spell…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Find a spell" />
        {from && (
          <label className="small muted">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show every spell on the list, not just the spellbook
          </label>
        )}
        {!all && showAll ? (
          <Loading />
        ) : (
          <ul className="list compact sheet-list">
            {shown.slice(0, 300).map((r) => (
              <li key={r.key}>
                <button className="row" onClick={() => onPick({ key: r.key, title: r.title, href: r.href, level })}>
                  <span className="row-main">{r.title}</span>
                  <span className="muted small">{(r as any).source || ''}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted small">{from && !showAll ? 'The spellbook has no spells of this level yet.' : 'No spells found.'}</li>}
          </ul>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ "Add to character" on spell pages

/** On a spell's page: add it to a character who can cast it (spellbook, spells known, or a free prepared slot). */
export function AddSpellToCharacter({ title }: { title: string }) {
  const chars = useRecords<Character>('character');
  const info = useClassTables();
  const [lv, setLv] = useState<Record<string, number> | null>(null);
  const [item, setItem] = useState<{ key: string; href: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import('../lib/catalog').then(async ({ catalog, nameKey }) => {
      const it = (await catalog('spell')).find((x) => x.key === nameKey(title));
      if (live && it) {
        setLv(it.lv);
        setItem({ key: it.key, href: it.sources[0]?.href || '' });
      }
    });
    return () => {
      live = false;
    };
  }, [title]);
  if (!chars.length || !info || !lv || !item) return null;

  const options: { label: string; run: () => void }[] = [];
  for (const ch of chars) {
    ch.data.classes.forEach((c, ci) => {
      const key = listKeyOf(c, info);
      const level = lv[key] ?? (c.cls === 'Cleric' ? domainLevel(lv, c.domains) : undefined);
      if (level === undefined) return;
      const ref: SpellRef = { key: item.key, title, href: item.href, level };
      const who = `${ch.name} (${className(c)})`;
      const spontaneous = castingOf(c, info) === 'spontaneous';
      if (usesSpellbook(c) || spontaneous) {
        const has = c.known.some((k) => k.key === ref.key && k.level === level);
        options.push({
          label: has ? `${who}: already ${spontaneous ? 'known' : 'in the spellbook'}` : `${who}: add to ${spontaneous ? 'spells known' : 'spellbook'} (level ${level})`,
          run: () => {
            if (!has) updateCharacter(ch.id, (x) => void x.classes[ci].known.push(ref));
            setDone(`Added to ${ch.name}.`);
          },
        });
      }
      if (!spontaneous) {
        options.push({
          label: `${who}: prepare in a free level ${level} slot`,
          run: () =>
            updateCharacter(ch.id, (x) => {
              const cc = x.classes[ci];
              const s = slotsFor(cc, info).find((y) => y.level === level);
              if (!s) return void setDone(`${ch.name} has no level ${level} slots yet.`);
              const list = preparedAt(cc, s);
              const free = list.findIndex((p) => !p.spell);
              if (free < 0) return void setDone(`${ch.name}’s level ${level} slots are full.`);
              list[free] = { ...list[free], spell: ref, used: false };
              cc.prepared[level] = list;
              setDone(`Prepared for ${ch.name}.`);
            }),
        });
      }
    });
  }
  if (!options.length) return null;
  return (
    <div className="add-to-char">
      <button className="btn subtle small" onClick={() => (setOpen(!open), setDone(null))}>
        Add to a character…
      </button>
      {done && <span className="muted small"> {done}</span>}
      {open && (
        <ul className="list compact">
          {options.map((o) => (
            <li key={o.label}>
              <button
                className="row linklike"
                onClick={() => {
                  o.run();
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function domainLevel(lv: Record<string, number>, domains?: string): number | undefined {
  const doms = (domains || '').split(/[,;/]+/).map((d) => d.trim().toLowerCase());
  for (const [k, v] of Object.entries(lv)) if (doms.includes(k.toLowerCase())) return v;
  return undefined;
}
