// Lists (Saved → Lists, #/list/<id>): named collections of pages — "Party loot", "Shopping",
// "Session 12 monsters" — each item with an optional note. Kept in the user-data store, so they
// can be shared as files like characters and homebrew.
import { useState } from 'react';
import { Header, Icon, Loading, Notice } from '../components';
import { createRecord, deleteRecord, updateRecord, useRecord, useRecords, type UserRecord } from '../lib/userdata';
import { navigate } from '../lib/router';

export interface ListItem {
  key: string;
  title: string;
  href: string;
  subtitle?: string;
  note?: string;
  qty?: number;
}
export interface ListData {
  items: ListItem[];
}

/** "Add to list…" on a page: pick a list (or make one) and add the page to it. */
export function AddToList({ item }: { item: Omit<ListItem, 'note' | 'qty'> }) {
  const lists = useRecords<ListData>('list');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const add = async (id: string, listName: string) => {
    await updateRecord<ListData>(id, (d) => {
      const hit = d.items.find((x) => x.key === item.key);
      if (hit) hit.qty = (hit.qty || 1) + 1;
      else d.items.push({ ...item });
    });
    setDone(`Added to ${listName}.`);
    setOpen(false);
  };
  return (
    <div className="add-to-list">
      <button className="btn subtle small" onClick={() => (setOpen(!open), setDone(null))}>
        Add to a list…
      </button>
      {done && <span className="muted small"> {done}</span>}
      {open && (
        <ul className="list compact">
          {lists.map((l) => (
            <li key={l.id}>
              <button className="row linklike" onClick={() => add(l.id, l.name)}>
                {l.name} <span className="muted small">({l.data.items.length})</span>
              </button>
            </li>
          ))}
          <li>
            <form
              className="char-fields"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                const r = await createRecord<ListData>('list', name.trim(), { items: [] });
                await add(r.id, r.name);
                setName('');
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list (e.g. Party loot)" aria-label="New list name" />
              <button className="btn small" type="submit" disabled={!name.trim()}>
                Create
              </button>
            </form>
          </li>
        </ul>
      )}
    </div>
  );
}

/** Lists, on the Saved page. */
export function ListsSection() {
  const lists = useRecords<ListData>('list');
  if (!lists.length) return null;
  return (
    <section>
      <h2 className="section-bar">Lists</h2>
      <ul className="list">
        {lists.map((l) => (
          <li key={l.id}>
            <a className="row" href={`#/list/${l.id}`}>
              <div className="row-main">
                <div className="row-title">{l.name}</div>
                <div className="muted small">
                  {l.data.items.length} {l.data.items.length === 1 ? 'item' : 'items'}
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ListView({ id }: { id: string }) {
  const rec = useRecord<ListData>(id);
  const [renaming, setRenaming] = useState(false);
  if (rec === null) return <Loading />;
  if (!rec) return <Notice kind="error">That list isn’t on this device.</Notice>;
  const change = (f: (d: ListData) => void) => updateRecord<ListData>(id, f);
  return (
    <div className="page">
      <Header
        title={rec.name}
        actions={
          <>
            <ShareRecordsButton records={[rec]} title={rec.name} />
            <button className="btn subtle" onClick={() => setRenaming(!renaming)}>
              Rename
            </button>
          </>
        }
      />
      {renaming && (
        <form
          className="char-fields"
          onSubmit={(e) => {
            e.preventDefault();
            const v = (e.currentTarget.elements.namedItem('n') as HTMLInputElement).value.trim();
            if (v) updateRecord(id, () => {}, v);
            setRenaming(false);
          }}
        >
          <input name="n" defaultValue={rec.name} aria-label="New name" autoFocus />
          <button className="btn primary" type="submit">
            Save
          </button>
        </form>
      )}
      {!rec.data.items.length && <p className="muted">Empty. Use “Add to a list…” on any spell, item, monster, book section or wiki page.</p>}
      <ul className="list list-items">
        {rec.data.items.map((it, i) => (
          <li key={it.key}>
            <div className="list-item-main">
              <a href={it.href}>{it.title}</a>
              {(it.qty || 1) > 1 && <span className="pill small">×{it.qty}</span>}
              {it.subtitle && <span className="muted small"> {it.subtitle}</span>}
              <input
                className="list-note"
                value={it.note || ''}
                placeholder="Note (who has it, charges left…)"
                onChange={(e) => change((d) => void (d.items[i].note = e.target.value))}
                aria-label={`Note for ${it.title}`}
              />
            </div>
            <div className="list-item-actions">
              <button className="icon-btn small-icon" onClick={() => change((d) => void (d.items[i].qty = Math.max(1, (d.items[i].qty || 1) - 1)))} aria-label="One fewer">
                <Icon name="minus" size={16} />
              </button>
              <button className="icon-btn small-icon" onClick={() => change((d) => void (d.items[i].qty = (d.items[i].qty || 1) + 1))} aria-label="One more">
                <Icon name="plus" size={16} />
              </button>
              <button className="icon-btn small-icon" onClick={() => change((d) => void d.items.splice(i, 1))} aria-label={`Remove ${it.title}`}>
                <Icon name="close" size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="row-buttons">
        <button
          className="btn subtle danger-text"
          onClick={() => {
            if (confirm(`Delete the list “${rec.name}” from this device?`)) {
              deleteRecord(id);
              navigate('#/saved', true);
            }
          }}
        >
          Delete list
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sharing (used by characters, lists, homebrew)

/** "Share" for user records: a .frref.json file through the share sheet (or a download). */
export function ShareRecordsButton({ records, title, label = 'Share' }: { records: UserRecord[]; title: string; label?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    const { myName, setMyName, shareRecords } = await import('../lib/share');
    if (!myName()) {
      const n = prompt('Your name, shown to the people you share with (optional):', '');
      if (n !== null) setMyName(n || '');
    }
    const r = await shareRecords(records, title);
    setMsg(r === 'downloaded' ? 'Saved as a file — send it to the others; they open it with Saved → Import.' : r === 'shared' ? 'Sent.' : null);
  };
  return (
    <>
      <button className="btn subtle" onClick={run} disabled={!records.length}>
        {label}
      </button>
      {msg && <span className="muted small share-msg">{msg}</span>}
    </>
  );
}
