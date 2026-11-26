import { useEffect, useMemo, useState } from 'react';
import { Header, Loading } from '../components';
import { navigate, Route } from '../lib/router';
import { Category, CLASS_NAMES, crValue, priceValue, SCHOOLS, SPELL_CLASSES } from '../lib/srd';
import { BROWSE } from './RulesHome';
import { catalog, CatalogItem, sourceOptions } from '../lib/catalog';

const PAGE = 300;
const OTHER_CASTERS = ['Adept', 'Assassin', 'Blackguard', 'Duskblade', 'Harper', 'Hathran', 'Healer', 'Shugenja', 'Warmage', 'Wu Jen'];

// One list per kind: the SRD and every rulebook merged, one row per name. Filters live in the
// URL so Back returns you to the same filtered list.
export default function CategoryView({ cat, route }: { cat: string; route: Route }) {
  const [all, setAll] = useState<CatalogItem[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    setAll(null);
    catalog(cat as Category).then(setAll).catch(() => setAll([]));
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
  useEffect(() => setShown(PAGE), [route.hash]);

  const info = BROWSE.find((b) => b.cat === cat);
  const cls = f('class');
  const lvl = f('level');
  const school = f('school');
  const ftype = f('type');
  const sort = f('sort');
  const src = f('src');

  const options = useMemo(() => {
    const types = new Set<string>();
    const domains = new Set<string>();
    const classes = new Set<string>();
    for (const e of all || []) {
      if (cat === 'feat') (e.ftype || []).forEach((t) => types.add(t));
      if (cat === 'monster' && e.ctype) types.add(e.ctype);
      if (cat === 'item' && e.itemKind) types.add(e.itemKind);
      if (cat === 'spell')
        Object.keys(e.lv).forEach((k) => {
          if (SPELL_CLASSES.includes(k)) return;
          if (OTHER_CASTERS.includes(k)) classes.add(k);
          else if (/^[A-Z][a-z]+$/.test(k)) domains.add(k);
        });
      if (cat === 'power') {
        Object.keys(e.lv).forEach((k) => classes.add(k));
        if (e.discipline) types.add(e.discipline);
      }
    }
    // Feat types that occur only once or twice are mostly extraction noise.
    const typeList = [...types].sort();
    return { types: typeList, domains: [...domains].sort(), classes: [...classes].sort(), sources: all ? sourceOptions(all) : [] };
  }, [all, cat]);

  const list = useMemo(() => {
    if (!all) return [];
    const needle = f('q').toLowerCase();
    let out = all.filter((e) => !needle || e.title.toLowerCase().includes(needle) || e.summary?.toLowerCase().includes(needle));
    if (src) out = out.filter((e) => e.sources.some((s) => s.short === src));
    if (cat === 'spell' || cat === 'power') {
      if (cls) out = out.filter((e) => e.lv[cls] !== undefined);
      if (lvl !== '') out = out.filter((e) => (cls ? e.lv[cls] === Number(lvl) : Object.values(e.lv).includes(Number(lvl))));
      if (school) out = out.filter((e) => (e.school || '').startsWith(school));
      if (cat === 'power' && ftype) out = out.filter((e) => (e.discipline || '').startsWith(ftype));
    }
    if (cat === 'feat' && ftype) out = out.filter((e) => e.ftype?.includes(ftype));
    if (cat === 'monster' && ftype) out = out.filter((e) => (e.ctype || '').startsWith(ftype));
    if (cat === 'item' && ftype) out = out.filter((e) => (e.itemKind || '').includes(ftype));

    const byName = (a: CatalogItem, b: CatalogItem) => a.title.localeCompare(b.title);
    if (cls && (cat === 'spell' || cat === 'power')) out = [...out].sort((a, b) => a.lv[cls] - b.lv[cls] || byName(a, b));
    else if ((cat === 'monster' || cat === 'trap') && sort === 'cr') out = [...out].sort((a, b) => crValue(a.cr) - crValue(b.cr) || byName(a, b));
    else if (cat === 'item' && sort === 'price') out = [...out].sort((a, b) => priceValue(a.price) - priceValue(b.price) || byName(a, b));
    return out;
  }, [all, route.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  const levels = cat === 'power' ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  let lastGroup = '';
  const groupOf = (e: CatalogItem) => {
    if (cls && (cat === 'spell' || cat === 'power')) return `Level ${e.lv[cls]}`;
    if ((cat === 'monster' || cat === 'trap') && sort === 'cr') return `CR ${e.cr?.replace(/\s*\(.*/, '') ?? '—'}`;
    return '';
  };

  return (
    <div className="page">
      <Header title={info?.label || cat} subtitle={all ? `${list.length.toLocaleString()} of ${all.length.toLocaleString()}` : undefined} />
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
              {options.classes.length > 0 && (
                <optgroup label="Other classes">
                  {options.classes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              )}
              {options.domains.length > 0 && (
                <optgroup label="Cleric domains">
                  {options.domains.map((d) => (
                    <option key={d} value={d}>
                      {d} domain
                    </option>
                  ))}
                </optgroup>
              )}
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
        {(cat === 'feat' || cat === 'monster' || cat === 'item') && options.types.length > 0 && (
          <select value={ftype} onChange={(e) => setF('type', e.target.value)} aria-label="Type">
            <option value="">{cat === 'feat' ? 'Any feat type' : cat === 'item' ? 'Any kind' : 'Any creature type'}</option>
            {options.types.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        {(cat === 'monster' || cat === 'trap') && (
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
        {options.sources.length > 1 && (
          <select value={src} onChange={(e) => setF('src', e.target.value)} aria-label="Book">
            <option value="">All books</option>
            {options.sources.map((s) => (
              <option key={s} value={s}>
                {s === 'SRD' ? 'SRD (3.5 reference)' : s}
              </option>
            ))}
          </select>
        )}
      </div>

      {!all && <Loading />}
      {all && list.length === 0 && <p className="muted pad">Nothing matches these filters.</p>}
      <ul className="list">
        {list.slice(0, shown).map((e) => {
          const g = groupOf(e);
          const header = g && g !== lastGroup ? ((lastGroup = g), g) : null;
          return (
            <li key={e.key}>
              {header && <div className="list-group">{header}</div>}
              <CatalogRow item={e} />
            </li>
          );
        })}
      </ul>
      {list.length > shown && (
        <button className="more" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({(list.length - shown).toLocaleString()} left)
        </button>
      )}
    </div>
  );
}

/** A row for one rules item: name, key stats, and where it appears (tap goes to the best version). */
export function CatalogRow({ item: e, badge }: { item: CatalogItem; badge?: string }) {
  const first = e.sources[0];
  return (
    <a className="row" href={first.href}>
      {badge && <span className={`cat cat-${e.kind}`}>{badge}</span>}
      <div className="row-main">
        <div className="row-title">
          {e.title}
          {e.extra && <span className="row-meta">{e.extra}</span>}
        </div>
        {e.summary && <div className="row-sub">{e.summary}</div>}
        <div className="row-sources">
          {e.sources.slice(0, 5).map((s) => (
            <span key={s.href} className={`src-chip ${s.srd ? 'srd' : ''}`}>
              {s.label}
            </span>
          ))}
          {e.sources.length > 5 && <span className="src-chip">+{e.sources.length - 5}</span>}
        </div>
      </div>
    </a>
  );
}
