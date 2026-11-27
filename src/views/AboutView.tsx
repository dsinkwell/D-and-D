import { useEffect, useState } from 'react';
import { Header, Notice, useOnline } from '../components';
import { formatBytes, storageEstimate } from '../lib/storage';
import { OfflineDataCard } from '../OfflineData';
import { runDiagnostics, type Check } from '../lib/diagnostics';
import { AskModelSettings } from './AskView';
import WritingSettings from './WritingSettings';
import AskQuality from './AskQuality';
import { clearSaved, countSaved, DEFAULT_WIKI, getWikiSettings, saveWikiSettings, searchWiki } from '../lib/wiki';

export default function AboutView() {
  const online = useOnline();
  const [settings, setSettings] = useState(getWikiSettings);
  const [saved, setSaved] = useState<number | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [test, setTest] = useState<string | null>(null);

  useEffect(() => {
    countSaved().then(setSaved);
    storageEstimate().then((e) => e && setUsage(`${formatBytes(e.usage)} used · about ${formatBytes(e.quota)} available`));
  }, []);

  const testWiki = async () => {
    setTest('Testing…');
    try {
      const r = await searchWiki('Waterdeep');
      setTest(r.length ? `✓ Connected — found “${r[0].title}”.` : 'Connected, but the search returned nothing.');
    } catch (e: any) {
      setTest(`✗ ${e.message}`);
    }
  };

  return (
    <div className="page about">
      <Header title="About & Settings" back={false} />

      <Diagnostics />
      <AskQuality />

      <section className="card">
        <h2>Install on your devices</h2>
        <ul>
          <li>
            <b>iPhone / iPad:</b> open this page in Safari → tap <b>Share</b> → <b>Add to Home Screen</b>.
          </li>
          <li>
            <b>Mac:</b> in Safari choose <b>File → Add to Dock</b> (macOS Sonoma or later). In Chrome/Edge use the install icon in the address bar.
          </li>
          <li>
            The rules work fully offline once installed. Wiki articles are saved as you read them. Imported books and bookmarks stay on each device (use
            Export/Import under Saved to copy bookmarks).
          </li>
        </ul>
        <p className="muted small">Status: {online ? 'online' : 'offline'} {usage && `· ${usage}`}</p>
      </section>

      <OfflineDataCard name="wiki" />
      <AskModelSettings />
      <WritingSettings />

      <section className="card">
        <h2>Live wiki connection</h2>
        <p>
          Articles opened online and saved on this device: <b>{saved ?? '…'}</b>{' '}
          {!!saved && (
            <button
              className="btn subtle"
              onClick={() => {
                if (confirm('Delete all saved wiki articles from this device?')) clearSaved().then(() => setSaved(0));
              }}
            >
              Clear saved articles
            </button>
          )}
        </p>
        <label className="field">
          <span>Wiki API endpoint</span>
          <input value={settings.api} onChange={(e) => setSettings({ ...settings, api: e.target.value.trim() })} />
        </label>
        <label className="field">
          <span>Optional CORS proxy prefix (leave blank normally)</span>
          <input placeholder="https://your-proxy.example/?url=" value={settings.proxy} onChange={(e) => setSettings({ ...settings, proxy: e.target.value.trim() })} />
        </label>
        <div className="button-row">
          <button className="btn primary" onClick={() => (saveWikiSettings(settings), testWiki())}>
            Save &amp; test connection
          </button>
          <button className="btn subtle" onClick={() => (setSettings(DEFAULT_WIKI), saveWikiSettings(DEFAULT_WIKI))}>
            Reset to default
          </button>
        </div>
        {test && <Notice kind={test.startsWith('✓') ? 'info' : test.startsWith('✗') ? 'error' : 'info'}>{test}</Notice>}
      </section>

      <section className="card">
        <h2>Content &amp; licenses</h2>
        <p>
          <b>Rules:</b> the Revised (v3.5) System Reference Document © 2000–2003 Wizards of the Coast, Inc., used under the Open Game License v1.0a.{' '}
          <a href="#/srd/d/legal-information">Read the full Open Game License and Section 15 notice</a>. Markdown conversion by the{' '}
          <a href="https://github.com/olimot/srd-v3.5-md" target="_blank" rel="noopener noreferrer">
            srd-v3.5-md
          </a>{' '}
          project.
        </p>
        <p>
          <b>Realms:</b> articles are loaded from the{' '}
          <a href="https://forgottenrealms.fandom.com/" target="_blank" rel="noopener noreferrer">
            Forgotten Realms Wiki
          </a>{' '}
          at Fandom; text is available under{' '}
          <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">
            CC BY-SA
          </a>
          . Each article links to its original page and author history.
        </p>
        <p>
          <b>My Books:</b> PDFs you import are your own copies. They are stored only in this app’s private storage on this device and are never uploaded or
          shared.
        </p>
        <p className="muted small">
          Dungeons &amp; Dragons, D&amp;D, and Forgotten Realms are trademarks of Wizards of the Coast. This is an unofficial personal reference tool and is not
          affiliated with or endorsed by Wizards of the Coast or Fandom.
        </p>
      </section>
    </div>
  );
}

function Diagnostics() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [copied, setCopied] = useState(false);
  const run = () => {
    setChecks(null);
    runDiagnostics().then(setChecks);
  };
  const text = () => (checks || []).map((c) => `${c.ok ? 'OK  ' : 'FAIL'} ${c.name}: ${c.detail}`).join('\n');
  return (
    <section className="card">
      <h2>Diagnostics</h2>
      {!checks ? (
        <button className="btn" onClick={run}>
          Run checks
        </button>
      ) : (
        <>
          <ul className="diag">
            {checks.map((c) => (
              <li key={c.name} className={c.ok ? 'ok' : 'fail'}>
                <b>{c.ok ? '✓' : '✗'} {c.name}</b> <span className="muted">{c.detail}</span>
              </li>
            ))}
          </ul>
          <button
            className="btn"
            onClick={() =>
              navigator.clipboard.writeText(text()).then(
                () => (setCopied(true), setTimeout(() => setCopied(false), 2000)),
                () => {},
              )
            }
          >
            {copied ? 'Copied' : 'Copy results'}
          </button>{' '}
          <button className="btn subtle" onClick={run}>
            Run again
          </button>
        </>
      )}
    </section>
  );
}
