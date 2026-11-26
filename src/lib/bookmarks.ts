import { useEffect, useState } from 'react';
import { readLocal, writeLocal } from './storage';

export type Source = 'srd' | 'wiki' | 'book';

export interface Mark {
  key: string; // unique, e.g. "srd:spells-f-g/fireball", "wiki:Waterdeep", "book:<id>:12"
  source: Source;
  title: string;
  subtitle?: string;
  href: string;
  at: number;
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

export function recordVisit(m: Omit<Mark, 'at'>) {
  const list = getHistory().filter((x) => x.key !== m.key);
  list.unshift({ ...m, at: Date.now() });
  writeLocal(HIST, list.slice(0, 40));
}

export function clearHistory() {
  writeLocal(HIST, []);
  emit();
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
