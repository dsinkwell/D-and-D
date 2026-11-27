import { useEffect, useRef, useState } from 'react';
import { BookmarkButton, Header, Loading, Notice, PinButton } from '../components';
import { recordVisit } from '../lib/bookmarks';
import { Doc, loadDoc } from '../lib/srd';

export default function ChapterView({ id, at }: { id: string; at?: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDoc(null);
    loadDoc(id)
      .then((d) => {
        setDoc(d);
        recordVisit({ key: `srd:chapter:${id}`, source: 'srd', title: d.title, subtitle: `Chapter · ${d.group}`, href: `#/srd/d/${id}` });
      })
      .catch(() => setErr('Chapter not found.'));
  }, [id]);

  useEffect(() => {
    if (!doc || !at) return;
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector(`#${CSS.escape(at)}`);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      }
    });
  }, [doc, at]);

  if (err) return <Notice kind="error">{err}</Notice>;
  if (!doc) return <Loading />;

  const jump = (anchor: string) => {
    setTocOpen(false);
    ref.current?.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <article className="page chapter">
      <Header
        title={doc.title}
        subtitle={`${doc.group} · SRD v3.5`}
        actions={
          <>
            <BookmarkButton mark={{ key: `srd:chapter:${id}`, source: 'srd', title: doc.title, subtitle: `Chapter · ${doc.group}`, href: `#/srd/d/${id}` }} />
            <PinButton label={doc.title} href={`#/srd/d/${id}`} />
          </>
        }
      />
      {doc.toc.length > 3 && (
        <details className="toc" open={tocOpen} onToggle={(e) => setTocOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Contents ({doc.toc.filter((t) => t[1] === 2).length} sections)</summary>
          <ul>
            {doc.toc.map(([, level, title, anchor]) => (
              <li key={anchor} className={`toc-l${level}`}>
                <button className="linklike" onClick={() => jump(anchor)}>
                  {title}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div ref={ref} className="content srd" dangerouslySetInnerHTML={{ __html: doc.blocks.filter((b) => !b.startsWith('<h1')).join('\n') }} />
    </article>
  );
}
