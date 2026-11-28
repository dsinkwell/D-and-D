// The Calendar of Harptos (FRCS ch. 3, Table 3–1): 12 months of 30 days, each three tendays; five
// annual holidays between months; Shieldmeet after Midsummer once every four years (1372 DR, the
// FRCS's current year, is one: years divisible by four). Equinoxes from FRCS ("Spring Equinox
// Ches 19", "Autumn Equinox Eleint 21"); solstices (Kythorn 20, Nightal 20) from the Forgotten
// Realms Wiki's Calendar of Harptos article. Days are numbered 1… within the year.
import { readLocal, writeLocal } from './storage';

export const MONTHS = [
  { name: 'Hammer', common: 'Deepwinter' },
  { name: 'Alturiak', common: 'The Claw of Winter' },
  { name: 'Ches', common: 'The Claw of the Sunsets' },
  { name: 'Tarsakh', common: 'The Claw of the Storms' },
  { name: 'Mirtul', common: 'The Melting' },
  { name: 'Kythorn', common: 'The Time of Flowers' },
  { name: 'Flamerule', common: 'Summertide' },
  { name: 'Eleasis', common: 'Highsun' },
  { name: 'Eleint', common: 'The Fading' },
  { name: 'Marpenoth', common: 'Leaffall' },
  { name: 'Uktar', common: 'The Rotting' },
  { name: 'Nightal', common: 'The Drawing Down' },
];

// the annual holidays, after the month with this index
const HOLIDAYS: Record<number, string> = { 0: 'Midwinter', 3: 'Greengrass', 6: 'Midsummer', 8: 'Highharvestide', 10: 'The Feast of the Moon' };

export const SPECIAL: Record<string, string> = {
  'Ches 19': 'Spring Equinox',
  'Kythorn 20': 'Summer Solstice',
  'Eleint 21': 'Autumn Equinox',
  'Nightal 20': 'Winter Solstice',
};

export type HDay =
  | { kind: 'month'; month: number; day: number } // month 0–11, day 1–30
  | { kind: 'holiday'; name: string; after: number }; // after month index

export const isShieldmeetYear = (year: number) => year % 4 === 0;
export const daysInYear = (year: number) => (isShieldmeetYear(year) ? 366 : 365);

/** Every day of the year in order. */
export function yearDays(year: number): HDay[] {
  const out: HDay[] = [];
  MONTHS.forEach((_, m) => {
    for (let d = 1; d <= 30; d++) out.push({ kind: 'month', month: m, day: d });
    if (HOLIDAYS[m]) out.push({ kind: 'holiday', name: HOLIDAYS[m], after: m });
    if (m === 6 && isShieldmeetYear(year)) out.push({ kind: 'holiday', name: 'Shieldmeet', after: m });
  });
  return out;
}

export interface HDate {
  year: number; // DR
  doy: number; // day of the year, 1…365/366
}

export const dayOf = (d: HDate): HDay => yearDays(d.year)[d.doy - 1];

export function label(d: HDate): string {
  const x = dayOf(d);
  return x.kind === 'month' ? `${MONTHS[x.month].name} ${x.day}, ${d.year} DR` : `${x.name}, ${d.year} DR`;
}
export const shortLabel = (x: HDay) => (x.kind === 'month' ? `${MONTHS[x.month].name} ${x.day}` : x.name);

/** "third-day of the second tenday of Hammer"; holidays fall outside the tendays. */
export function tendayLabel(x: HDay): string | null {
  if (x.kind !== 'month') return null;
  const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const t = Math.floor((x.day - 1) / 10);
  return `${ord[(x.day - 1) % 10]}-day of the ${ord[t]} tenday of ${MONTHS[x.month].name}`;
}

export const specialOf = (x: HDay) => (x.kind === 'month' ? SPECIAL[shortLabel(x)] : undefined);

/** Move by n days (negative: back), across years. */
export function addDays(d: HDate, n: number): HDate {
  let { year, doy } = d;
  doy += n;
  while (doy > daysInYear(year)) doy -= daysInYear(year++);
  while (doy < 1) doy += daysInYear(--year);
  return { year, doy };
}

/** Days from a to b (positive when b is later). */
export function daysBetween(a: HDate, b: HDate): number {
  let n = 0;
  if (a.year === b.year) return b.doy - a.doy;
  const [s, e, sign] = a.year < b.year ? [a, b, 1] : [b, a, -1];
  n += daysInYear(s.year) - s.doy;
  for (let y = s.year + 1; y < e.year; y++) n += daysInYear(y);
  n += e.doy;
  return n * sign;
}

/** The next holiday or equinox/solstice after a date (within a year). */
export function nextSpecial(d: HDate): { date: HDate; name: string; inDays: number } | null {
  for (let i = 1; i <= 370; i++) {
    const t = addDays(d, i);
    const x = dayOf(t);
    const name = x.kind === 'holiday' ? x.name : specialOf(x);
    if (name) return { date: t, name, inDays: i };
  }
  return null;
}

export function fromMonthDay(year: number, month: number, day: number): HDate {
  const days = yearDays(year);
  const i = days.findIndex((x) => x.kind === 'month' && x.month === month && x.day === day);
  return { year, doy: i + 1 };
}

// Year names from the FRCS's Roll of Years (the rest come from the wiki's "1372 DR"-style articles)
export const FRCS_YEAR_NAMES: Record<number, string> = {
  1372: 'the Year of Wild Magic',
  1373: 'the Year of Rogue Dragons',
  1374: 'the Year of Lightning Storms',
  1375: 'the Year of Risen Elfkin',
  1376: 'the Year of the Bent Blade',
  1377: 'the Year of the Haunting',
  1378: 'the Year of the Cauldron',
  1379: 'the Year of the Lost Keep',
  1380: 'the Year of the Blazing Hand',
};

// The group's campaign date on this device (synced between a person's devices in the app)
const KEY = 'rc.harptos';
export const CAMPAIGN_EVENT = 'rc-harptos-changed';
export const campaignDate = (): HDate => readLocal<HDate>(KEY, { year: 1372, doy: 1 });
export function setCampaignDate(d: HDate) {
  writeLocal(KEY, d);
  window.dispatchEvent(new Event(CAMPAIGN_EVENT));
}
