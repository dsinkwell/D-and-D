import { useEffect, useMemo, useState } from 'react';
import { Header, Loading } from '../components';
import { navigate, Route } from '../lib/router';
import { Category, CLASS_NAMES, crValue, Entry, entryHref, loadEntries, priceValue, SCHOOLS, SPELL_CLASSES } from '../lib/srd';
import { BROWSE } from './RulesHome';
import { BOOK_KIND_LABEL, bookEntryHref, BookHit, BookKind, entriesOfKind } from '../lib/books';
import { crValue as crv } from '../lib/srd';

// Filters are stored in the URL so Back returns you to the same filtered list.
export default function CategoryView({ cat, route }: { cat: string; route: Route }) {
  const [all, setAll] = useState<Entry[] | null>(null);
  useEffect(() => {
    loadEntries().then((e) => setAll(e.filter((x) => x.c === cat)));
  }, [cat]);

  const f = (k: string) => route.query.get(k) || '';
  const setF = (k: string, v: string) => {
    const p = new URLSearchParams(route.query);
    if (v) p.set(k, v);
    else p.delete(k);
    navigate(`/rules/${cat}${p.toString() ? `?${p}` : ''}`, true);
  };

  const [text, setText] = useState(f('q'));
  useEffect(() => {
    const t = setTimeout(() => text !== f('q') && setF('q', text), 200);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const info = BROWSE.find((b) => b.cat === cat);
  const cls = f('class');
  const lvl = f('level');
  const school = f('school');
  const ftype = f('type');
  const sort = f('sort');

  const options = useMemo(() => {
    if (!all) return { types: [] as string[], domains: [] as string[], classes: [] as string[] };
    const types = new Set<string>();
    const domains = new Set<string>();
    const classes = new Set<string>();
    for (const e of all) {
      if (cat === 'feat' && e.m?.ftype) e.m.ftype.split(/,\s*/).forEach((t: string) => types.add(t));
      if (cat === 'monster' && e.m?.ctype) types.add(e.m.ctype.replace(/\s*\(.*$/, ''));
      if (cat === 'item' && e.m?.kind) types.add(e.m.kind.replace(/ Descriptions?$/, '').replace(/^Specific /, ''));
      if (cat === 'spell') Object.keys(e.m?.lv || {}).forEach((k) => (SPELL_CLASSES.includes(k) ? null : domains.add(k)));
      if (cat === 'power') {
        Object.keys(e.m?.lv || {}).forEach((k) => classes.add(k));
        if (e.m?.Discipline) types.add(e.m.Discipline.replace(/\s*\(.*$/, '').trim());
      }
    }
    return { types: [...types].sort(), domains: [...domains].sort(), classes: [...classes].sort() };
  }, [all, cat]);

  const list = useMemo(() => {
    if (!all) return [];
    const needle = f('q').toLowerCase();
    let out = all.filter((e) => !needle || e.t.toLowerCase().includes(needle) || e.x?.toLowerCase().includes(needle));
    if (cat === 'spell' || cat === 'power') {
      if (cls) out = out.filter((e) => e.m?.lv?.[cls] !== undefined);
      if (lvl !== '') out = out.filter((e) => (cls ? e.m?.lv?.[cls] === Number(lvl) : Object.values(e.m?.lv || {}).includes(Number(lvl))));
      if (school) out = out.filter((e) => (e.m?.school || '').startsWith(school));
      if (cat === 'power' && ftype) out = out.filter((e) => (e.m?.Discipline || '').startsWith(ftype));
    }
    if (cat === 'feat' && ftype) out = out.filter((e) => e.m?.ftype?.split(/,\s*/).includes(ftype));
    if (cat === 'monster' && ftype) out = out.filter((e) => (e.m?.ctype || '').startsWith(ftype));
    if (cat === 'item' && ftype) out = out.filter((e) => (e.m?.kind || '').includes(ftype));

    const byName = (a: Entry, b: Entry) => a.t.localeCompare(b.t);
    if (cls && (cat === 'spell' || cat === 'power')) out.sort((a, b) => a.m!.lv[cls] - b.m!.lv[cls] || byName(a, b));
    else if (cat === 'monster' && sort === 'cr') out.sort((a, b) => crValue(a.m?.cr) - crValue(b.m?.cr) || byName(a, b));
    else if (cat === 'item' && sort === 'price') out.sort((a, b) => priceValue(a.m?.price) - priceValue(b.m?.price) || byName(a, b));
    else if (cat !== 'class' && cat !== 'prestige' && cat !== 'race') out.sort(byName);
    return out;
  }, [all, route.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  const levels = cat === 'power' ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  // Group header when sorted by level
  let lastGroup = '';
  const groupOf = (e: Entry) => {
    if (cls && (cat === 'spell' || cat === 'power')) return `Level ${e.m!.lv[cls]}`;
    if (cat === 'monster' && sort === 'cr') return `CR ${e.m?.cr?.replace(/\s*\(.*/, '') ?? '—'}`;
    return '';
  };

  return (
    <div className="page">
      <Header title={info?.label || cat} subtitle={all ? `${list.length} of ${all.length}` : undefined} />
      <div className="filters">
        <input className="filter-text" type="search" placeholder={`Filter ${info?.label.toLowerCase() || ''}…`} value={text} onChange={(e) => setText(e.target.value)} autoCorrect="off" autoCapitalize="none" />
        {cat === 'spell' && (
          <>
            <select value={cls} onChange={(e) => setF('class', e.target.value)} aria-label="Class or domain">
              <option value="">Any class</option>
              {SPELL_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {CLASS_NAMES[c]}
                </option>
              ))}
              <optgroup label="Cleric domains">
                {options.domains.map((d) => (
                  <option key={d} value={d}>
                    {d} domain
                  </option>
                ))}
              </optgroup>
            </select>
            <select value={school} onChange={(e) => setF('school', e.target.value)} aria-label="School">
              <option value="">Any school</option>
              {SCHOOLS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
        {cat === 'power' && (
          <>
            <select value={cls} onChange={(e) => setF('class', e.target.value)} aria-label="Class">
              <option value="">Any class</option>
              {options.classes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select value={ftype} onChange={(e) => setF('type', e.target.value)} aria-label="Discipline">
              <option value="">Any discipline</option>
              {options.types.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
        {(cat === 'spell' || cat === 'power') && (
          <select value={lvl} onChange={(e) => setF('level', e.target.value)} aria-label="Level">
            <option value="">Any level</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                Level {l}
              </option>
            ))}
          </select>
        )}
        {(cat === 'feat' || cat === 'monster' || cat === 'item') && (
          <select value={ftype} onChange={(e) => setF('type', e.target.value)} aria-label="Type">
            <option value="">{cat === 'feat' ? 'Any feat type' : cat === 'item' ? 'Any kind' : 'Any creature type'}</option>
            {options.types.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        {cat === 'monster' && (
          <select value={sort} onChange={(e) => setF('sort', e.target.value)} aria-label="Sort">
            <option value="">Sort A–Z</option>
            <option value="cr">Sort by CR</option>
          </select>
        )}
        {cat === 'item' && (
          <select value={sort} onChange={(e) => setF('sort', e.target.value)} aria-label="Sort">
            <option value="">Sort A–Z</option>
            <option value="price">Sort by price</option>
          </select>
        )}
      </div>

      {!all && <Loading />}
      <ul className="list">
        {list.map((e) => {
          const g = groupOf(e);
          const header = g && g !== lastGroup ? ((lastGroup = g), g) : null;
          return (
            <li key={e.i}>
              {header && <div className="list-group">{header}</div>}
              <a className="row" href={entryHref(e)}>
                <div className="row-main">
                  <div className="row-title">
                    {e.t}
                    <Meta e={e} cat={cat as Category} />
                  </div>
                  {e.x && <div className="row-sub">{e.x}</div>}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
      <BookKindList cat={cat} route={route} />
    </div>
  );
}

const BOOK_KINDS: Record<string, BookKind> = { spell: 'spell', feat: 'feat', monster: 'monster', item: 'item', prestige: 'prestige', class: 'class', deity: 'deity', power: 'power' };

/** Entries of the same kind from the built-in rulebooks, using the same filters as the SRD list. */
function BookKindList({ cat, route }: { cat: string; route: Route }) {
  const kind = BOOK_KINDS[cat];
  const [all, setAll] = useState<BookHit[] | null>(null);
  useEffect(() => {
    if (kind) entriesOfKind(kind).then(setAll).catch(() => setAll([]));
  }, [kind]);
  const q = (route.query.get('q') || '').toLowerCase();
  const cls = route.query.get('class') || '';
  const lvl = route.query.get('level') || '';
  const ftype = route.query.get('type') || '';
  const sort = route.query.get('sort') || '';
  const list = useMemo(() => {
    if (!all) return [];
    let out = all.filter(({ entry: e }) => !q || e.title.toLowerCase().includes(q) || e.summary?.toLowerCase().includes(q));
    if (kind === 'spell') {
      const key = cls === 'Sor/Wiz' ? /^(Sor\/Wiz|Wiz|Sor)$/ : cls ? new RegExp(`^${cls.replace(/[/]/g, '\\/')}$`) : null;
      if (key) out = out.filter(({ entry: e }) => Object.keys(e.meta?.lv || {}).some((k) => key.test(k)));
      if (lvl !== '') out = out.filter(({ entry: e }) => Object.entries(e.meta?.lv || {}).some(([k, v]) => (!key || key.test(k)) && v === Number(lvl)));
    }
    if (kind === 'feat' && ftype) out = out.filter(({ entry: e }) => (e.meta?.ftype || '').toLowerCase().includes(ftype.toLowerCase()));
    if (kind === 'monster' && ftype) out = out.filter(({ entry: e }) => (e.meta?.ctype || '').toLowerCase().startsWith(ftype.toLowerCase()));
    if (kind === 'monster' && sort === 'cr') out = [...out].sort((a, b) => crv(a.entry.meta?.cr) - crv(b.entry.meta?.cr));
    return out;
  }, [all, q, cls, lvl, ftype, sort, kind]);
  if (!kind || !all || !all.length) return cat === 'deity' && all && !all.length ? <p className="muted">Unlock your group’s books (Books tab) to see deities.</p> : null;
  return (
    <section>
      <h2 className="section-title">
        From your rulebooks <span className="muted">· {list.length}</span>
      </h2>
      <ul className="list">
        {list.slice(0, 600).map(({ entry: e, bookShort }) => (
          <li key={e.id}>
            <a className="row" href={bookEntryHref(e)}>
              <span className="cat cat-book">{bookShort}</span>
              <div className="row-main">
                <div className="row-title">
                  {e.title}
                  <span className="row-meta">
                    {[e.meta?.Level, e.meta?.ftype, e.meta?.cr && `CR ${e.meta.cr}`, e.meta?.price, e.meta?.portfolio].filter(Boolean).join(' · ') || BOOK_KIND_LABEL[e.kind]}
                  </span>
                </div>
                {e.summary && <div className="row-sub">{e.summary}</div>}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Meta({ e, cat }: { e: Entry; cat: Category }) {
  const m = e.m || {};
  let txt = '';
  if (cat === 'spell') txt = [m.school?.replace(/\s*\[.*\]/, ''), m.Level].filter(Boolean).join(' · ');
  else if (cat === 'power') txt = [m.Discipline, m.Level].filter(Boolean).join(' · ');
  else if (cat === 'feat') txt = m.ftype;
  else if (cat === 'monster') txt = [m.type, m.cr && `CR ${m.cr}`].filter(Boolean).join(' · ');
  else if (cat === 'item') txt = [m.price, m.kind?.replace(/ Descriptions?$/, '')].filter(Boolean).join(' · ');
  else if (cat === 'skill') txt = m.ability;
  return txt ? <span className="row-meta">{txt}</span> : null;
}
