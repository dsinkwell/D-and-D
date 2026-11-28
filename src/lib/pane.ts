// Two panes on wide screens (iPad landscape, Mac): a list (search results, a category, a book's
// contents…) stays on the left while the entry it opened shows on the right. The list view in
// the left pane must not rewrite the URL (that would replace the entry), so it reports changes
// to its own state (search text, filters) through this context instead.
import { createContext, useContext, useEffect, useState } from 'react';
import { navigate, Route } from './router';

export const SPLIT_QUERY = '(min-width: 1100px)';

export const PaneContext = createContext<{ embedded: boolean; setList?: (hash: string) => void }>({ embedded: false });
export const usePane = () => useContext(PaneContext);

/** For a list view's own state changes: in the left pane only that pane changes; otherwise the URL (replaced). */
export function useListNavigate() {
  const pane = usePane();
  return (to: string) => {
    const hash = to.replace(/^#/, '');
    if (pane.embedded && pane.setList) pane.setList(hash);
    else navigate(hash, true);
  };
}

export type PaneKind = 'list' | 'detail' | 'other';

/** Lists stay in the left pane; details open beside them. */
export function paneKind(r: Route): PaneKind {
  const [s, ...rest] = r.parts;
  switch (s) {
    case undefined:
    case 'search':
    case 'ask':
    case 'saved':
      return 'list';
    case 'rules':
      return rest[0] ? 'list' : 'other';
    case 'wiki':
      return rest.length ? 'detail' : 'list';
    case 'book':
      return rest[1] ? 'detail' : 'list';
    case 'list':
      return 'list';
    case 'srd':
      return 'detail';
    case 'homebrew':
      return rest[0] && rest[0] !== 'new' && rest[1] !== 'edit' ? 'detail' : 'other';
    default:
      return 'other';
  }
}

export function useMediaQuery(q: string) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    f();
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}
