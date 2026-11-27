// The "Jump to" buttons on the Search home: editable, saved on this device.
import { wikiHref } from './router';

export interface Shortcut {
  label: string;
  href: string;
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { label: 'Conditions', href: '#/rules/condition' },
  { label: 'Spells', href: '#/rules/spell' },
  { label: 'Feats', href: '#/rules/feat' },
  { label: 'Monsters', href: '#/rules/monster' },
  { label: 'Magic items', href: '#/rules/item' },
  { label: 'Combat', href: '#/srd/d/combat-i-basics' },
  { label: 'Special attacks', href: '#/srd/d/combat-ii-movement-modifiers-and-special-actions' },
  { label: 'Grapple', href: '#/srd/e/combat-ii-movement-modifiers-and-special-actions/grapple' },
  { label: 'Faerûn', href: wikiHref('Faerûn') },
  { label: 'Faerûnian pantheon', href: wikiHref('Faerûnian pantheon') },
];

const KEY = 'jump-shortcuts';
const EVENT = 'shortcuts-changed';

export function getShortcuts(): Shortcut[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((s) => s && typeof s.label === 'string' && typeof s.href === 'string');
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_SHORTCUTS;
}

export function saveShortcuts(list: Shortcut[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: changes last until the app closes */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resetShortcuts() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export const isPinned = (href: string) => getShortcuts().some((s) => s.href === href);
export const pin = (s: Shortcut) => !isPinned(s.href) && saveShortcuts([...getShortcuts(), s]);
export const unpin = (href: string) => saveShortcuts(getShortcuts().filter((s) => s.href !== href));

/** Re-render when the shortcuts change (from any screen). */
export function onShortcutsChanged(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
