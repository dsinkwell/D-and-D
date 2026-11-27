import { useEffect, useState } from 'react';
import { Icon, Notice } from './components';
import { DbName, installDb, InstallProgress, remoteManifest, RemoteManifest, removeDb, useDbStatus } from './lib/db';
import { formatBytes } from './lib/storage';
import { whileBusy } from './lib/busy';

/** "20261126T0410" -> Date */
export function versionDate(v?: string | null): Date | null {
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : null;
}
const fmtDate = (v?: string | null) => versionDate(v)?.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) ?? v ?? '';

const LABEL: Record<DbName, { title: string; what: (m: RemoteManifest | null) => string }> = {
  wiki: {
    title: 'Offline Forgotten Realms Wiki',
    what: (m) => (m?.articles ? `${Number(m.articles).toLocaleString()} articles` : 'Every article'),
  },
  books: {
    title: 'Your group’s rulebooks',
    what: (m) => (m?.bookCount ? `${m.bookCount} books` : 'Built-in books'),
  },
};

export function OfflineDataCard({ name, compact = false, passphrase, onInstalled, autoStart = false }: { name: DbName; compact?: boolean; passphrase?: string; onInstalled?: () => void; autoStart?: boolean }) {
  const status = useDbStatus();
  const [remote, setRemote] = useState<RemoteManifest | null | undefined>(undefined);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const needsPass = !!remote?.encryption && !passphrase;

  useEffect(() => {
    remoteManifest(name).then(setRemote);
  }, [name]);

  const installed = status?.installed[name];
  const updateAvailable = !!(installed && remote && remote.version > installed);
  const label = LABEL[name];

  const install = async () => {
    setErr(null);
    setProgress({ received: 0, total: remote?.downloadBytes || 0, part: 0, parts: remote?.parts.length || 0 });
    try {
      await whileBusy(`install:${name}`, () => installDb(name, setProgress, passphrase || pass || undefined));
      onInstalled?.();
    } catch (e: any) {
      const msg = String(e?.message || e);
      setErr(
        msg === 'WRONG_PASSPHRASE'
          ? 'That passphrase is not right.'
          : msg === 'PASSPHRASE_REQUIRED'
            ? 'Enter your group’s passphrase first.'
            : /quota|space|QuotaExceeded/i.test(msg)
              ? 'Not enough storage space on this device.'
              : `Download failed: ${msg}. Check your connection and try again — it resumes from the start of the current part.`,
      );
    } finally {
      setProgress(null);
    }
  };

  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (autoStart && !started && remote && status && !status.installed[name]) {
      setStarted(true);
      install();
    }
  }, [autoStart, started, remote, status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status && !status.supported) {
    return (
      <Notice kind="warn">
        This browser can’t store the offline {name === 'wiki' ? 'wiki' : 'books'} ({status.error}). Use Safari on iOS/iPadOS 16.4+ or macOS 13.3+, or a current Chrome/Edge.
      </Notice>
    );
  }
  if (remote === null && !installed) {
    return compact ? null : <p className="muted small">The offline {name === 'wiki' ? 'wiki' : 'books'} data hasn’t been published to this site yet.</p>;
  }
  if (compact && installed && !updateAvailable) return null;

  const pct = progress && progress.total ? Math.min(100, (100 * progress.received) / progress.total) : 0;

  return (
    <section className={`card offline-card ${compact ? 'compact' : ''}`}>
      <div className="offline-head">
        <Icon name="download" />
        <div>
          <h2>{label.title}</h2>
          <div className="muted small">
            {installed ? (
              <>
                On this device · updated {fmtDate(installed)}
                {updateAvailable && <> · <b>newer version from {fmtDate(remote!.version)} available</b></>}
              </>
            ) : remote ? (
              <>
                {label.what(remote)} · {formatBytes(remote.downloadBytes)} download · works with no connection afterwards
              </>
            ) : (
              'Checking…'
            )}
          </div>
        </div>
      </div>
      {progress ? (
        <div className="progress">
          <div className="progress-bar">
            <div style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <span>
            {formatBytes(progress.received)} of {formatBytes(progress.total)} · keep this screen open
          </span>
        </div>
      ) : (
        <div className="button-row">
          {!installed && remote && (
            <button className="btn primary" onClick={install}>
              Download ({formatBytes(remote.downloadBytes)})
            </button>
          )}
          {updateAvailable && needsPass && (
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Group passphrase"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              aria-label="Group passphrase"
            />
          )}
          {updateAvailable && (
            <button className="btn primary" onClick={install} disabled={needsPass && !pass}>
              Update ({formatBytes(remote!.downloadBytes)})
            </button>
          )}
          {installed && !compact && (
            <button
              className="btn subtle"
              onClick={() => {
                if (confirm(`Remove the ${label.title.toLowerCase()} from this device?`)) removeDb(name);
              }}
            >
              Remove from this device
            </button>
          )}
        </div>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </section>
  );
}
