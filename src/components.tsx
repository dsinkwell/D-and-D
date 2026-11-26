import { ReactNode, useEffect, useState } from 'react';
import { Mark, toggleBookmark, useIsBookmarked } from './lib/bookmarks';

export function Header({ title, subtitle, back = true, actions }: { title: ReactNode; subtitle?: ReactNode; back?: boolean; actions?: ReactNode }) {
  return (
    <header className="page-header">
      {back && (
        <button className="icon-btn back" aria-label="Back" onClick={() => (history.length > 1 ? history.back() : (location.hash = '#/'))}>
          <Icon name="back" />
        </button>
      )}
      <div className="page-title">
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}

export function BookmarkButton({ mark }: { mark: Omit<Mark, 'at'> }) {
  const on = useIsBookmarked(mark.key);
  return (
    <button className={`icon-btn ${on ? 'active' : ''}`} aria-pressed={on} aria-label={on ? 'Remove bookmark' : 'Bookmark'} title={on ? 'Remove bookmark' : 'Bookmark'} onClick={() => toggleBookmark(mark)}>
      <Icon name={on ? 'star-filled' : 'star'} />
    </button>
  );
}

/** A star in a list row: bookmark without opening the entry. */
export function StarToggle({ mark }: { mark: Omit<Mark, 'at'> }) {
  const on = useIsBookmarked(mark.key);
  return (
    <button
      className={`star-btn ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={on ? `Remove bookmark ${mark.title}` : `Bookmark ${mark.title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleBookmark(mark);
      }}
    >
      <Icon name={on ? 'star-filled' : 'star'} size={21} />
    </button>
  );
}

/** Share the current page (iOS share sheet), or copy its link. */
export function ShareButton({ title }: { title: string }) {
  return (
    <button
      className="icon-btn"
      aria-label="Share"
      title="Share"
      onClick={async () => {
        const url = location.href;
        try {
          if (navigator.share) await navigator.share({ title, url });
          else {
            await navigator.clipboard.writeText(url);
            alert('Link copied');
          }
        } catch {
          /* cancelled */
        }
      }}
    >
      <Icon name="share" />
    </button>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(t);
  }, []);
  return show ? <div className="loading">{label}</div> : null;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'warn'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export function SourceBadge({ source }: { source: 'srd' | 'wiki' | 'book' }) {
  const label = source === 'srd' ? 'SRD' : source === 'wiki' ? 'Wiki' : 'Book';
  return <span className={`badge badge-${source}`}>{label}</span>;
}

const PATHS: Record<string, string> = {
  search: 'M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.24 4.24-1.4 1.4-4.24-4.24A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  rules: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5a.5.5 0 0 0 0 1H20v2H6.5A2.5 2.5 0 0 1 4 19.5v-15zM6 16.04V4.5a.5.5 0 0 1 .5-.5H18v12H6.5c-.17 0-.34.01-.5.04zM9 6h6v2H9V6z',
  realms: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm6.9 7a8 8 0 0 0-4.3-4.6c.6 1.3 1 2.9 1.2 4.6h3.1zM12 4c-.8 1-1.6 2.8-1.9 5h3.8C13.6 6.8 12.8 5 12 4zM9.4 4.4A8 8 0 0 0 5.1 9h3.1c.2-1.7.6-3.3 1.2-4.6zM4.3 11a8 8 0 0 0 0 2h3.8a20 20 0 0 1 0-2H4.3zm1 4a8 8 0 0 0 4.1 4.6c-.6-1.3-1-2.9-1.2-4.6H5.2zm4.8 0c.3 2.2 1.1 4 1.9 5 .8-1 1.6-2.8 1.9-5H10zm4.6 4.6a8 8 0 0 0 4.1-4.6h-3c-.2 1.7-.5 3.3-1.1 4.6zm4.9-6.6a8 8 0 0 0 0-2h-3.7a20 20 0 0 1 0 2h3.7zm-5.7 0a18 18 0 0 0 0-2h-4a18 18 0 0 0 0 2h4z',
  library: 'M3 3h4v18H3V3zm6 0h4v18H9V3zm6.6 1.3 3.9-1 4.4 17.4-3.9 1-4.4-17.4zM5 5v14V5zm6 0v14V5z',
  saved: 'M6 2h12a1 1 0 0 1 1 1v19l-7-4.5L5 22V3a1 1 0 0 1 1-1zm1 2v14.3l5-3.2 5 3.2V4H7z',
  about: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 6h2v7h-2v-7zm0-3h2v2h-2V7z',
  back: 'M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12 14 3.2l1.4 1.4z',
  star: 'm12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9L12 2.5zm0 4.5-1.6 3.4-3.7.5 2.7 2.6-.7 3.7 3.3-1.8 3.3 1.8-.7-3.7 2.7-2.6-3.7-.5L12 7z',
  'star-filled': 'm12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9L12 2.5z',
  external: 'M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  chapter: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z',
  refresh: 'M12 4a8 8 0 0 1 7.4 5H17v2h6V5h-2v2.4A10 10 0 1 0 22 12h-2a8 8 0 1 1-8-8z',
  trash: 'M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 12H7L6 9zm3 2v8h2v-8H9zm4 0v8h2v-8h-2z',
  download: 'M11 3h2v9.6l3.3-3.3 1.4 1.4L12 16.4l-5.7-5.7 1.4-1.4 3.3 3.3V3zM4 19h16v2H4v-2z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z',
  minus: 'M4 11h16v2H4z',
  prev: 'M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12 14 3.2l1.4 1.4z',
  next: 'M8.6 19.4 16 12 8.6 4.6 10 3.2l8.8 8.8-8.8 8.8-1.4-1.4z',
  share: 'M12 2.6 16.7 7.3l-1.4 1.4L13 6.4V15h-2V6.4L8.7 8.7 7.3 7.3 12 2.6zM5 11h3v2H6v7h12v-7h-2v-2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z',
  ask: 'M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7.6L7 22v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v11h5v2.3L11.8 16H20V5H4zm7.2 7.6h1.7v1.7h-1.7v-1.7zM12 6.3c1.7 0 3 1.1 3 2.6 0 1.1-.7 1.7-1.3 2.1-.5.3-.8.6-.8 1.1h-1.7c0-1.1.6-1.7 1.2-2.1.5-.3.9-.6.9-1.1 0-.5-.6-1-1.3-1-.8 0-1.3.5-1.4 1.1H8.9c.1-1.6 1.4-2.7 3.1-2.7z',
  close: 'm6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5z',
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d={PATHS[name] || ''} fillRule="evenodd" />
    </svg>
  );
}

/** Debounce a changing value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const u = () => setOn(navigator.onLine);
    window.addEventListener('online', u);
    window.addEventListener('offline', u);
    return () => {
      window.removeEventListener('online', u);
      window.removeEventListener('offline', u);
    };
  }, []);
  return on;
}
