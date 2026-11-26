import { useEffect, useState } from 'react';

// Tiny hash router: works on any static host and inside an installed home-screen app.
export interface Route {
  path: string; // e.g. "/srd/e/spells-f-g/fireball"
  parts: string[]; // decoded path segments
  query: URLSearchParams;
  hash: string; // the raw hash, used as a key
}

export function parseHash(hash = window.location.hash): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  const path = p || '/';
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { path, parts, query: new URLSearchParams(q), hash: raw };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(to: string, replace = false) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (replace) window.history.replaceState(null, '', target);
  else window.location.hash = target.slice(1);
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export const href = (path: string, query?: Record<string, string | number | undefined>) => {
  const q = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `#${path}${q ? `?${q}` : ''}`;
};

export const wikiHref = (title: string) => `#/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
