// About → iCloud sync (native app): on/off, whether iCloud answers, when it last synced, and how
// much of iCloud's 1 MB for this app is used.
import { useEffect, useState } from 'react';
import { isNative } from '../lib/platform';
import { onSyncState, setSyncOn, syncNow, syncState, type SyncState } from '../lib/cloud';

export default function CloudSyncCard() {
  const [s, setS] = useState<SyncState>(syncState);
  const [busy, setBusy] = useState(false);
  useEffect(() => onSyncState(setS), []);
  if (!isNative()) {
    return (
      <section className="card">
        <h2>Your devices</h2>
        <p className="muted small">
          In the FR Reference app (iPhone, iPad, Mac) your characters, lists, homebrew, bookmarks and Jump to buttons sync through iCloud. In the web app they stay on this device:
          use Share and Saved → Import to move them.
        </p>
      </section>
    );
  }
  const kb = s.bytes != null ? Math.round(s.bytes / 1024) : null;
  return (
    <section className="card">
      <h2>iCloud sync</h2>
      <label className="switch-row">
        <input type="checkbox" checked={s.on} onChange={(e) => setSyncOn(e.target.checked)} /> Sync my characters, lists, homebrew, bookmarks and Jump to buttons between my devices
      </label>
      <ul className="diag">
        <li className={s.available ? 'ok' : 'fail'}>
          <b>{s.available ? '✓' : '✗'} iCloud</b>{' '}
          <span className="muted">
            {!s.available ? s.error || 'not available' : s.signedIn === false ? 'this device is not signed in to iCloud (Settings → your name)' : 'answering'}
          </span>
        </li>
        {s.lastSync && (
          <li className="ok">
            <b>Last synced</b> <span className="muted">{new Date(s.lastSync).toLocaleString()}</span>
          </li>
        )}
        {kb != null && (
          <li className={s.quotaFull || kb > 900 ? 'fail' : 'ok'}>
            <b>Space used</b>{' '}
            <span className="muted">
              {kb} KB of 1,024 KB{s.keys != null ? ` · ${s.keys} of 1,024 items` : ''}
              {s.quotaFull ? ' — full: new changes stay on this device' : ''}
            </span>
          </li>
        )}
        {s.error && s.available && (
          <li className="fail">
            <b>Problem</b> <span className="muted">{s.error}</span>
          </li>
        )}
      </ul>
      <button
        className="btn subtle"
        disabled={!s.on || !s.available || busy}
        onClick={async () => {
          setBusy(true);
          await syncNow();
          setBusy(false);
        }}
      >
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
    </section>
  );
}
