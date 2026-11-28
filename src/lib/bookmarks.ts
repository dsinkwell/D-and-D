import { useEffect, useState } from 'react';
import { readLocal, writeLocal } from './storage';

export type Source = 'srd' | 'wiki' | 'book';

export interface Mark {
  key: string; // unique, e.g. "srd:spells-f-g/fireball", "wiki:Waterdeep", "book:<id>:12"
  source: Source;
  title: string;
  subtitle?: string;
  href: string;
  kind?: string; // spell, feat, monster, item… (groups the Saved screen)
  at: number;
}

/** The bookmark key for a link, matching the keys the entry pages use. */
export function keyForHref(href: string): string {
  let m = href.match(/^#\/book\/([^/]+)\/(.+)$/);
  if (m) return `bk:${m[1]}/${decodeURIComponent(m[2])}`;
  m = href.match(/^#\/srd\/e\/(.+)$/);
  if (m) return `srd:${m[1]}`;
  m = href.match(/^#\/wiki\/(.+)$/);
  if (m) return `wiki:${decodeURIComponent(m[1])}`;
  return href;
}

const BM = 'rc.bookmarks';
const HIST = 'rc.history';
const EVT = 'rc-marks-changed';

export const getBookmarks = () => readLocal<Mark[]>(BM, []);
export const getHistory = () => readLocal<Mark[]>(HIST, []);

function emit() {
  window.dispatchEvent(new Event(EVT));
}

export function toggleBookmark(m: Omit<Mark, 'at'>) {
  const list = getBookmarks();
  const i = list.findIndex((x) => x.key === m.key);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ ...m, at: Date.now() });
  writeLocal(BM, list);
  emit();
}

export function removeBookmark(key: string) {
  writeLocal(
    BM,
    getBookmarks().filter((x) => x.key !== key),
  );
  emit();
}

export function setBookmarks(list: Mark[]) {
  writeLocal(BM, list);
  emit();
}

export const HISTORY_EVENT = 'rc-history-changed'; // also how iCloud sync notices a change (cloud.ts)

export function recordVisit(m: Omit<Mark, 'at'>) {
  const list = getHistory().filter((x) => x.key !== m.key);
  // the same page again on top: nothing to record or sync
  if (getHistory()[0]?.key === m.key) return;
  list.unshift({ ...m, at: Date.now() });
  writeLocal(HIST, list.slice(0, 40));
  window.dispatchEvent(new Event(HISTORY_EVENT));
}

export function clearHistory() {
  writeLocal(HIST, []);
  emit();
  window.dispatchEvent(new Event(HISTORY_EVENT));
}

export function useBookmarks() {
  const [list, setList] = useState(getBookmarks);
  useEffect(() => {
    const on = () => setList(getBookmarks());
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return list;
}

export function useIsBookmarked(key: string) {
  const list = useBookmarks();
  return list.some((m) => m.key === key);
}
