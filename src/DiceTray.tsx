// The dice tray: opens when a number in rules text is tapped (tap-to-roll) or from the dice
// button. Shows the latest roll with its breakdown, a "next d20" advantage/disadvantage switch,
// quick dice, a box for any expression, and the history (kept on this device).
import { useEffect, useState } from 'react';
import { Icon } from './components';
import { diceStore, isD20, Roll, RollMode, useDice } from './lib/dice';

const QUICK = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const MODE_LABEL: Record<RollMode, string> = { normal: 'Normal', advantage: 'Advantage', disadvantage: 'Disadvantage' };

/** Name of the page (or chapter section) a rolled number sits in. */
function contextTitle(el: Element): string {
  const article = el.closest('article') || document;
  const heads = Array.from(article.querySelectorAll('.content h2, .content h3, .content h4'));
  let section = '';
  for (const h of heads) if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) section = h.textContent || '';
  const title = article.querySelector('.entry-title')?.textContent || '';
  return (section || title).trim();
}

function useRollTaps() {
  useEffect(() => {
    const fire = (el: HTMLElement) => {
      const expr = el.dataset.roll;
      if (!expr) return;
      const where = contextTitle(el);
      const label = [where, el.dataset.label].filter(Boolean).join(' · ');
      diceStore.roll(expr, label);
    };
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('.roll') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      fire(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = (e.target as Element | null)?.closest?.('.roll') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      fire(el);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
}

function Breakdown({ r }: { r: Roll }) {
  const parts: React.ReactNode[] = [];
  r.terms.forEach((t, i) => {
    if (i || t.sign < 0) parts.push(<span key={`s${i}`}> {t.sign < 0 ? '−' : '+'} </span>);
    parts.push(
      <span key={`t${i}`} className="dice-term">
        {t.count}d{t.sides} <b>[{t.rolls.join(', ')}]</b>
        {t.dropped && <s className="muted"> {t.dropped.join(', ')}</s>}
      </span>,
    );
  });
  if (r.mod) parts.push(<span key="m"> {r.mod < 0 ? '−' : '+'} {Math.abs(r.mod)}</span>);
  return <div className="dice-breakdown">{parts}</div>;
}

function Latest({ r }: { r: Roll }) {
  const d20 = isD20(r.expr);
  const crit = d20 && r.nat === 20 ? 'nat20' : d20 && r.nat === 1 ? 'nat1' : '';
  return (
    <div className={`dice-latest ${crit}`} key={r.id}>
      <div className="dice-label">{r.label || r.expr}</div>
      <div className="dice-total-row">
        <span className="dice-total">{r.total}</span>
        <div className="dice-detail">
          <div className="muted small">
            {r.expr}
            {r.mode !== 'normal' && <span className={`dice-mode-tag ${r.mode}`}>{MODE_LABEL[r.mode]}</span>}
            {crit && <span className="dice-crit">{crit === 'nat20' ? 'Natural 20' : 'Natural 1'}</span>}
          </div>
          <Breakdown r={r} />
        </div>
      </div>
      <div className="dice-again">
        <button className="btn subtle small" onClick={() => diceStore.roll(r.expr, r.label, 'normal')}>
          Roll again
        </button>
        {d20 && (
          <>
            <button className="btn subtle small" onClick={() => diceStore.roll(r.expr, r.label, 'advantage')}>
              With advantage
            </button>
            <button className="btn subtle small" onClick={() => diceStore.roll(r.expr, r.label, 'disadvantage')}>
              With disadvantage
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Compact result bar: what a tap on a number in the text opens, so the page stays tappable. */
function CompactBar({ r, nextMode, onExpand }: { r?: Roll; nextMode: RollMode; onExpand: () => void }) {
  const d20 = r && isD20(r.expr);
  const crit = d20 && r!.nat === 20 ? 'nat20' : d20 && r!.nat === 1 ? 'nat1' : '';
  return (
    <section className="dice-tray compact" aria-label="Dice result" aria-live="polite">
      <div className="dice-head">
        <ModeChips nextMode={nextMode} />
        <button className="icon-btn" onClick={onExpand} aria-label="Open the dice tray">
          <Icon name="up" />
        </button>
        <button className="icon-btn" onClick={() => diceStore.setOpen(false)} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      {r && (
        <div className={`dice-total-row ${crit}`} key={r.id}>
          <span className="dice-total">{r.total}</span>
          <div className="dice-detail">
            <div className="dice-label ellipsis">{r.label || r.expr}</div>
            <Breakdown r={r} />
            <div className="muted small">
              {r.mode !== 'normal' && <span className={`dice-mode-tag ${r.mode}`}>{MODE_LABEL[r.mode]}</span>}
              {crit && <span className="dice-crit">{crit === 'nat20' ? 'Natural 20' : 'Natural 1'}</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** "Next d20: Adv. / Dis." — applies to the next d20 roll, then switches back off. */
function ModeChips({ nextMode }: { nextMode: RollMode }) {
  return (
    <div className="dice-modes" role="group" aria-label="Next d20 roll">
      <span className="muted small">Next d20:</span>
      {(['advantage', 'disadvantage'] as RollMode[]).map((m) => (
        <button key={m} aria-pressed={nextMode === m} className={`seg ${nextMode === m ? 'on' : ''}`} onClick={() => diceStore.setNextMode(nextMode === m ? 'normal' : m)}>
          {m === 'advantage' ? 'Adv.' : 'Dis.'}
        </button>
      ))}
    </div>
  );
}

export default function DiceTray() {
  const { open, history, nextMode } = useDice();
  const [expr, setExpr] = useState('');
  const [bad, setBad] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useRollTaps();

  useEffect(() => {
    if (!open) setExpanded(false);
    const root = document.documentElement.classList;
    root.toggle('dice-open', open && !expanded);
    return () => root.remove('dice-open');
  }, [open, expanded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && diceStore.setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        className="dice-fab"
        onClick={() => {
          setExpanded(true);
          diceStore.setOpen(true);
        }}
        aria-label="Dice tray"
        title="Dice"
      >
        <Icon name="dice" />
      </button>
    );
  }

  if (!expanded) return <CompactBar r={history[0]} nextMode={nextMode} onExpand={() => setExpanded(true)} />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = diceStore.roll(expr.trim(), '');
    setBad(!r);
    if (r) setExpr('');
  };

  return (
    <section className="dice-tray" aria-label="Dice tray">
      <div className="dice-head">
        <h2>Dice</h2>
        <ModeChips nextMode={nextMode} />
        <button className="icon-btn" onClick={() => setExpanded(false)} aria-label="Make the dice tray smaller">
          <Icon name="down" />
        </button>
        <button className="icon-btn" onClick={() => diceStore.setOpen(false)} aria-label="Close dice tray">
          <Icon name="close" />
        </button>
      </div>

      {history[0] ? <Latest r={history[0]} /> : <p className="muted small dice-hint">Tap a number in any stat block (attack, save, skill, damage) to roll it, or roll here.</p>}

      <div className="dice-quick">
        {QUICK.map((d) => (
          <button key={d} className="btn subtle small" onClick={() => diceStore.roll(d === 'd100' ? '1d100' : `1${d}`, '')}>
            {d}
          </button>
        ))}
      </div>
      <form className="dice-custom" onSubmit={submit}>
        <input
          value={expr}
          onChange={(e) => {
            setExpr(e.target.value);
            setBad(false);
          }}
          placeholder="e.g. 3d6+2 or d20+7"
          aria-label="Dice to roll"
          aria-invalid={bad}
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="btn primary small" type="submit" disabled={!expr.trim()}>
          Roll
        </button>
      </form>
      {bad && <p className="small dice-bad">Write dice like 2d6+3, d20+5 or 1d8+1d6.</p>}

      {history.length > 1 && (
        <div className="dice-history">
          <button className="linklike small" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide' : 'Show'} history ({history.length - 1})
          </button>
          {showHistory && (
            <>
              <ul>
                {history.slice(1).map((r) => (
                  <li key={r.id}>
                    <button className="dice-hist-row" onClick={() => diceStore.roll(r.expr, r.label, r.mode)} title="Roll again">
                      <span className="dice-hist-label">
                        {r.label || r.expr}
                        <span className="muted small">
                          {' '}
                          {r.expr}
                          {r.mode !== 'normal' ? ` · ${MODE_LABEL[r.mode].toLowerCase()}` : ''}
                        </span>
                      </span>
                      <span className={`dice-hist-total ${isD20(r.expr) && r.nat === 20 ? 'nat20' : isD20(r.expr) && r.nat === 1 ? 'nat1' : ''}`}>{r.total}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button className="linklike small" onClick={() => diceStore.clear()}>
                Clear history
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
