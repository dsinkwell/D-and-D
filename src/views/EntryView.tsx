import { useEffect, useMemo, useState } from 'react';
import { BookmarkButton, Header, Icon, Loading, Notice, ShareButton, PinButton } from '../components';
import { formatEntry } from '../lib/statblock';
import { recordVisit } from '../lib/bookmarks';
import { CATEGORY_LABEL, Doc, Entry, getEntry, loadDoc } from '../lib/srd';
import { wikiHref } from '../lib/router';
import { findWikiTitle } from '../lib/wiki';
import { bookEntryHref, BookHit, findInBooks } from '../lib/books';
import { useAutolinked } from '../lib/autolink';
import { AddSpellToCharacter } from './CharacterViews';
import { AddToList } from './ListViews';
import { ReplacedBanner } from './HomebrewViews';

/** Plausible wiki titles for an SRD entry ("Dwarves" -> "Dwarf", "Magic Fang, Greater" -> "Greater magic fang"). */
function wikiCandidates(e: Entry): string[] {
  const out = new Set<string>([e.t, ...(e.al || [])]);
  const t = e.t;
  if (/ves$/.test(t)) out.add(t.replace(/ves$/, 'f'));
  if (/ies$/.test(t)) out.add(t.replace(/ies$/, 'y'));
  if (/s$/.test(t) && !/ss$/.test(t)) out.add(t.replace(/s$/, ''));
  const m = t.match(/^(.+?), (.+)$/);
  if (m) out.add(`${m[2]} ${m[1]}`);
  return [...out].map((x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());
}

export default function EntryView({ id }: { id: string }) {
  const [entry, setEntry] = useState<Entry | null | undefined>(undefined);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lore, setLore] = useState<string | null>(null);
  const [inBooks, setInBooks] = useState<BookHit[]>([]);

  useEffect(() => {
    setLore(null);
    if (!entry || entry.c === 'rule') return;
    let live = true;
    findWikiTitle(wikiCandidates(entry)).then((t) => live && setLore(t));
    setInBooks([]);
    findInBooks(entry.t).then((h) => live && setInBooks(h)).catch(() => {});
    return () => {
      live = false;
    };
  }, [entry]);

  useEffect(() => {
    let live = true;
    setDoc(null);
    getEntry(id)
      .then(async (e) => {
        if (!live) return;
        setEntry(e ?? null);
        if (e) {
          const d = await loadDoc(e.d);
          if (live) setDoc(d);
          recordVisit({ key: `srd:${e.i}`, source: 'srd', title: e.t, subtitle: `${CATEGORY_LABEL[e.c]} · ${d.title}`, href: `#/srd/e/${e.i}` });
        }
      })
      .catch((x) => setErr(String(x)));
    return () => {
      live = false;
    };
  }, [id]);

  const body = useMemo(() => {
    if (!entry || !doc || entry.i !== id) return '';
    let blocks = doc.blocks.slice(entry.s, entry.e);
    // the heading is shown in the page header already
    if (/^<h\d/.test(blocks[0])) blocks = blocks.slice(1);
    return entry.c !== 'rule' ? formatEntry(blocks.join('\n'), entry.c) : blocks.join('\n');
  }, [entry, doc, id]);
  const linked = useAutolinked(body, { selfHref: `#/srd/e/${id}`, selfTitle: entry?.t });

  if (err) return <Notice kind="error">{err}</Notice>;
  if (entry === null) return <Notice kind="error">That rules entry could not be found.</Notice>;
  if (!entry || !doc) return <Loading />;

  const isRef = entry.c !== 'rule';
  const label = CATEGORY_LABEL[entry.c];
  return (
    <article className="page entry">
      <Header
        title={isRef ? `${label}: ${entry.t}` : entry.t}
        actions={
          <>
            <a className="icon-btn" href={`#/srd/d/${entry.d}?at=${entry.a}`} title="Open in full chapter" aria-label="Open in full chapter">
              <Icon name="chapter" />
            </a>
            <BookmarkButton mark={{ key: `srd:${entry.i}`, source: 'srd', title: entry.t, subtitle: `${label} · SRD`, href: `#/srd/e/${entry.i}`, kind: entry.c }} />
            <PinButton label={entry.t} href={`#/srd/e/${entry.i}`} />
            <ShareButton title={entry.t} />
          </>
        }
      />
      <div className="entry-head">
        <h1 className="entry-title">{entry.t}</h1>
        <div className="entry-source">
          SRD · {doc.title}
          {entry.p ? ` › ${entry.p}` : ''}
        </div>
      </div>
      <ReplacedBanner title={entry.t} />
      <div className="entry-adds">
        {entry.c === 'spell' && <AddSpellToCharacter title={entry.t} />}
        <AddToList item={{ key: `srd:${entry.i}`, title: entry.t, href: `#/srd/e/${entry.i}`, subtitle: `${label} · SRD` }} />
      </div>
      {inBooks.length > 0 && (
        <div className="crosslinks">
          <span className="muted small">In your books:</span>
          {inBooks.map((h) => (
            <a key={h.entry.id} className="pill small" href={bookEntryHref(h.entry)}>
              <span className="cat cat-book">{h.bookShort}</span> p. {h.entry.page}
            </a>
          ))}
        </div>
      )}
      {lore && (
        <div className="crosslinks">
          <span className="muted small">In the Realms:</span>
          <a className="pill small" href={wikiHref(lore)}>
            <span className="cat cat-wiki">Wiki</span> {lore}
          </a>
        </div>
      )}
      <div
        className={`content srd ${isRef ? 'ref' : ''} cat-body-${entry.c}`}
        dangerouslySetInnerHTML={{ __html: linked }}
      />
      <footer className="source-note">
        Source: System Reference Document v3.5 (Open Game License). <a href={`#/srd/d/${entry.d}?at=${entry.a}`}>Read in chapter context →</a>
      </footer>
    </article>
  );
}
