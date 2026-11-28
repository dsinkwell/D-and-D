// Forgotten Realms tools: the Calendar of Harptos (with the group's campaign date) and overland
// travel time from the Player's Handbook's movement tables.
import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components';
import { getArticle } from '../lib/wiki';
import { textOf } from '../lib/ask/highlight';
import { wikiHref } from '../lib/router';
import { readLocal, writeLocal } from '../lib/storage';
import {
  addDays,
  CAMPAIGN_EVENT,
  campaignDate,
  daysBetween,
  dayOf,
  FRCS_YEAR_NAMES,
  isShieldmeetYear,
  label,
  MONTHS,
  nextSpecial,
  setCampaignDate,
  shortLabel,
  specialOf,
  tendayLabel,
  yearDays,
  type HDate,
  type HDay,
} from '../lib/harptos';
import { fmtMiles, MODES, TERRAIN, travel, type Route } from '../lib/travel';

export function ToolsHome() {
  return (
    <div className="page">
      <Header title="Realms tools" />
      <div className="quick-grid tools-grid">
        <a className="quick tool-tile" href="#/tools/calendar">
          <b>Calendar of Harptos</b>
          <span className="muted">Months, holidays and Shieldmeet; your campaign’s date</span>
        </a>
        <a className="quick tool-tile" href="#/tools/travel">
          <b>Travel time</b>
          <span className="muted">Days on the road, by foot, mount or ship (PHB chapter 9)</span>
        </a>
      </div>
    </div>
  );
}

function useCampaignDate(): [HDate, (d: HDate) => void] {
  const [d, setD] = useState(campaignDate);
  useEffect(() => {
    const on = () => setD(campaignDate());
    window.addEventListener(CAMPAIGN_EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(CAMPAIGN_EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return [d, setCampaignDate];
}

/** "the Year of Wild Magic": the FRCS's Roll of Years, else the wiki's article for the year. */
function useYearName(year: number) {
  const [name, setName] = useState<string | null>(FRCS_YEAR_NAMES[year] || null);
  useEffect(() => {
    if (FRCS_YEAR_NAMES[year]) return setName(FRCS_YEAR_NAMES[year]);
    setName(null);
    let live = true;
    getArticle(`${year} DR`, { preferCache: true })
      .then(({ article }) => {
        const m = textOf(article.html).match(/\bYear of (?:the )?[A-Z][\w’'-]*(?: (?:of |the |and )*[A-Z][\w’'-]*)*/);
        if (live && m) setName(`the ${m[0]}`);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [year]);
  return name;
}

export function CalendarView() {
  const [campaign, setCampaign] = useCampaignDate();
  const [year, setYear] = useState(campaign.year);
  const [sel, setSel] = useState<HDate>(campaign);
  const [jump, setJump] = useState('');
  const days = useMemo(() => yearDays(year), [year]);
  const yearName = useYearName(year);
  const next = nextSpecial(campaign);
  const selDay = dayOf(sel);
  const fromCampaign = daysBetween(campaign, sel);

  const move = (n: number) => {
    const d = addDays(campaign, n);
    setCampaign(d);
    setSel(d);
    setYear(d.year);
  };

  // months with the holidays after them
  const blocks: { month?: number; holiday?: HDay; doy: number }[] = [];
  days.forEach((x, i) => {
    if (x.kind === 'holiday') blocks.push({ holiday: x, doy: i + 1 });
    else if (x.day === 1) blocks.push({ month: x.month, doy: i + 1 });
  });

  return (
    <div className="page calendar-page">
      <Header title="Calendar of Harptos" subtitle={`${year} DR${yearName ? ` · ${yearName}` : ''}`} />

      <section className="card campaign-card">
        <div className="muted small">Your campaign’s date</div>
        <div className="campaign-date">{label(campaign)}</div>
        <div className="muted">
          {tendayLabel(dayOf(campaign)) || 'An annual holiday, outside the tendays'}
          {next && (
            <>
              {' '}
              · {next.name} in {next.inDays} day{next.inDays === 1 ? '' : 's'}
            </>
          )}
        </div>
        <div className="button-row">
          <button className="btn subtle" onClick={() => move(-1)}>
            − 1 day
          </button>
          <button className="btn subtle" onClick={() => move(1)}>
            + 1 day
          </button>
          <button className="btn subtle" onClick={() => move(10)}>
            + 1 tenday
          </button>
          <form
            className="advance"
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(jump, 10);
              if (n) move(n);
              setJump('');
            }}
          >
            <input type="number" inputMode="numeric" placeholder="± days" value={jump} onChange={(e) => setJump(e.target.value)} aria-label="Days to move" />
            <button className="btn subtle" disabled={!parseInt(jump, 10)}>
              Move
            </button>
          </form>
        </div>
      </section>

      <div className="year-nav">
        <button className="btn subtle" onClick={() => setYear(year - 1)} aria-label="Previous year">
          ‹ {year - 1}
        </button>
        <div>
          <b>{year} DR</b>
          {yearName && <div className="muted small">{yearName.replace(/^the /, 'The ')}</div>}
          <div className="muted small">
            {days.length} days{isShieldmeetYear(year) ? ' · Shieldmeet year' : ''} ·{' '}
            <a href={wikiHref(`${year} DR`)}>{year} DR on the wiki</a>
          </div>
        </div>
        <button className="btn subtle" onClick={() => setYear(year + 1)} aria-label="Next year">
          {year + 1} ›
        </button>
      </div>

      {sel.year === year && (
        <section className="card day-card">
          <b>{label(sel)}</b>
          <div className="muted">
            {tendayLabel(selDay) || 'An annual holiday, outside the tendays'}
            {specialOf(selDay) && <> · {specialOf(selDay)}</>}
          </div>
          <div className="muted small">
            {fromCampaign === 0 ? 'Your campaign’s date' : `${Math.abs(fromCampaign)} day${Math.abs(fromCampaign) === 1 ? '' : 's'} ${fromCampaign > 0 ? 'after' : 'before'} your campaign’s date`}
          </div>
          {fromCampaign !== 0 && (
            <button className="btn subtle" onClick={() => setCampaign(sel)}>
              Make this the campaign’s date
            </button>
          )}
        </section>
      )}

      <div className="harptos">
        {blocks.map((b) =>
          b.holiday ? (
            <button
              key={b.doy}
              className={`holiday ${sel.year === year && sel.doy === b.doy ? 'sel' : ''} ${campaign.year === year && campaign.doy === b.doy ? 'now' : ''}`}
              onClick={() => setSel({ year, doy: b.doy })}
            >
              {b.holiday.kind === 'holiday' && b.holiday.name}
            </button>
          ) : (
            <section key={b.doy} className="month">
              <h2>
                {MONTHS[b.month!].name} <span className="muted">· {MONTHS[b.month!].common}</span>
              </h2>
              <div className="tendays">
                {Array.from({ length: 30 }, (_, i) => {
                  const doy = b.doy + i;
                  const x = days[doy - 1];
                  const sp = specialOf(x);
                  return (
                    <button
                      key={doy}
                      className={`day ${sel.year === year && sel.doy === doy ? 'sel' : ''} ${campaign.year === year && campaign.doy === doy ? 'now' : ''} ${sp ? 'special' : ''}`}
                      title={`${shortLabel(x)}${sp ? ` · ${sp}` : ''}`}
                      onClick={() => setSel({ year, doy })}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </section>
          ),
        )}
      </div>
      <p className="muted small source-note">
        The Calendar of Harptos: <i>Forgotten Realms Campaign Setting</i>, chapter 3 (Table 3–1); solstices from the{' '}
        <a href={wikiHref('Calendar of Harptos')}>Forgotten Realms Wiki</a>. Shieldmeet follows Midsummer in years divisible by four.
      </p>
    </div>
  );
}

interface TravelPrefs {
  miles: string;
  mode: string;
  terrain: number;
  route: Route;
  extra: number;
  downstream: boolean;
}
const TRAVEL_KEY = 'rc.travel';

export function TravelView() {
  const [p, setP] = useState<TravelPrefs>(() => ({ miles: '100', mode: 'foot30', terrain: 6, route: 'road', extra: 0, downstream: false, ...readLocal<Partial<TravelPrefs>>(TRAVEL_KEY, {}) }));
  const [campaign, setCampaign] = useCampaignDate();
  const set = (k: Partial<TravelPrefs>) => {
    const n = { ...p, ...k };
    setP(n);
    writeLocal(TRAVEL_KEY, n);
  };
  const mode = MODES.find((m) => m.id === p.mode) || MODES[2];
  const miles = parseFloat(p.miles) || 0;
  const r = travel({ miles, mode, terrain: p.terrain, route: p.route, extraHours: mode.water ? 0 : p.extra, downstream: p.downstream });
  const daysUp = Math.ceil(r.days - 1e-9);
  const arrive = miles > 0 && Number.isFinite(r.days) ? addDays(campaign, daysUp) : null;
  const groups = [...new Set(MODES.map((m) => m.group))];

  return (
    <div className="page travel-page">
      <Header title="Travel time" subtitle="Player’s Handbook, chapter 9" />
      <section className="card travel-form">
        <label>
          Distance (miles)
          <input type="number" inputMode="decimal" min="0" value={p.miles} onChange={(e) => set({ miles: e.target.value })} />
        </label>
        <label>
          How
          <select value={p.mode} onChange={(e) => set({ mode: e.target.value })}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {MODES.filter((m) => m.group === g).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {!mode.water && (
          <>
            <label>
              Terrain
              <select value={p.terrain} onChange={(e) => set({ terrain: +e.target.value })}>
                {TERRAIN.map((t, i) => (
                  <option key={t.name} value={i}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="seg" role="radiogroup" aria-label="Route">
              {(['highway', 'road', 'trackless'] as Route[]).map((rt) => (
                <button key={rt} role="radio" aria-checked={p.route === rt} className={`chip ${p.route === rt ? 'active' : ''}`} onClick={() => set({ route: rt })}>
                  {rt === 'road' ? 'Road or trail' : rt[0].toUpperCase() + rt.slice(1)}
                </button>
              ))}
            </div>
            <label>
              Forced march (hours beyond 8 a day)
              <select value={p.extra} onChange={(e) => set({ extra: +e.target.value })}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'None' : `${n} hour${n > 1 ? 's' : ''}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {mode.downstream && (
          <label className="check">
            <input type="checkbox" checked={p.downstream} onChange={(e) => set({ downstream: e.target.checked })} /> Going downstream
          </label>
        )}
      </section>

      {miles > 0 && (
        <section className="card travel-result">
          <div className="travel-days">
            {Number.isFinite(r.days) ? (
              <>
                {Math.floor(r.days + 1e-9) > 0 && (
                  <>
                    {Math.floor(r.days + 1e-9)} day{Math.floor(r.days + 1e-9) === 1 ? '' : 's'}
                  </>
                )}
                {r.hoursLastDay > 0.05 && (
                  <>
                    {Math.floor(r.days + 1e-9) > 0 ? ' and ' : ''}
                    {fmtMiles(Math.round(r.hoursLastDay * 2) / 2)} hours
                  </>
                )}
              </>
            ) : (
              '—'
            )}
          </div>
          <div className="muted">
            {fmtMiles(Math.round(r.perDay * 10) / 10)} miles a day
            {!mode.water && r.multiplier !== 1 && <> (×{r.multiplier === 0.5 ? '½' : r.multiplier === 0.75 ? '¾' : r.multiplier === 0.25 ? '¼' : r.multiplier} for {TERRAIN[p.terrain].name.toLowerCase()}, {p.route === 'road' ? 'road or trail' : p.route})</>}
          </div>
          {r.notes.map((n) => (
            <p key={n} className="muted small">
              {n}
            </p>
          ))}
          {arrive && (
            <div className="travel-arrive">
              Leaving on {label(campaign)}: arrive {daysUp === 1 ? 'the next day' : `${daysUp} days later`}, on <b>{label(arrive)}</b>.{' '}
              <button className="btn subtle" onClick={() => setCampaign(arrive)}>
                Advance the campaign date
              </button>
            </div>
          )}
        </section>
      )}
      <p className="muted small source-note">
        Speeds from the <i>Player’s Handbook</i>: Table 9–3 (Movement and Distance), Table 9–5 (Terrain and Overland Movement) and Table 9–6
        (Mounts and Vehicles). A travel day is 8 hours on land, 10 hours of rowing, or 24 hours under sail. The distance is yours: measure it on a map or take it from a source.
      </p>
    </div>
  );
}
