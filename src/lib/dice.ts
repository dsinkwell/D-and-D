// Dice rolling for the dice tray (src/DiceTray.tsx) and the tap-to-roll numbers in rules text
// (src/lib/rollers.ts). Rolls use the device's secure random generator.
//
// Expressions: "1d6+5", "3d8 + 9", "d20+12", "2d6-1", "d%", "1d8+1d6+3".
// A roll of a single d20 plus modifiers can be made with advantage (2d20, keep the higher, the
// group's house rule) or disadvantage (keep the lower).
import { useSyncExternalStore } from 'react';

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface DiceTerm {
  sign: 1 | -1;
  count: number;
  sides: number;
  rolls: number[];
  dropped?: number[]; // advantage/disadvantage: the d20 not kept
}

export interface Roll {
  id: string;
  at: number;
  label: string; // "Owlbear · Claw attack"
  expr: string; // normalised: "1d20+9"
  mode: RollMode;
  terms: DiceTerm[];
  mod: number;
  total: number;
  nat?: number; // the kept d20 of a d20 roll (for natural 20 / natural 1)
}

const MINUS = /[−–—]/g;

interface Parsed {
  dice: { sign: 1 | -1; count: number; sides: number }[];
  mod: number;
}

/** Parse "2d6+3" into dice and a modifier; null if it isn't a dice expression. */
export function parseDice(input: string): Parsed | null {
  const s = input.replace(MINUS, '-').replace(/\s+/g, '').toLowerCase();
  if (!s || !/^[+-]?(\d*d(\d+|%)|\d+)([+-](\d*d(\d+|%)|\d+))*$/.test(s)) return null;
  const out: Parsed = { dice: [], mod: 0 };
  for (const m of s.matchAll(/([+-]?)(\d*)d(\d+|%)|([+-]?)(\d+)/g)) {
    if (m[3] !== undefined) {
      const count = m[2] ? Number(m[2]) : 1;
      const sides = m[3] === '%' ? 100 : Number(m[3]);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
      out.dice.push({ sign: m[1] === '-' ? -1 : 1, count, sides });
    } else {
      out.mod += (m[4] === '-' ? -1 : 1) * Number(m[5]);
    }
  }
  return out.dice.length || out.mod ? out : null;
}

/** "1d20+9" style text for a parsed expression. */
function exprText(p: Parsed): string {
  let s = p.dice.map((d, i) => `${d.sign < 0 ? '-' : i ? '+' : ''}${d.count}d${d.sides}`).join('');
  if (p.mod) s += `${p.mod > 0 && s ? '+' : p.mod < 0 ? '-' : ''}${Math.abs(p.mod)}`;
  return s;
}

/** Is this a single d20 plus modifiers (so advantage applies)? */
export function isD20(expr: string): boolean {
  const p = parseDice(expr);
  return !!p && p.dice.length === 1 && p.dice[0].count === 1 && p.dice[0].sides === 20 && p.dice[0].sign === 1;
}

function die(sides: number): number {
  const buf = new Uint32Array(1);
  // rejection sampling: no bias toward low numbers
  const limit = Math.floor(0x100000000 / sides) * sides;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return (buf[0] % sides) + 1;
}

export function roll(expr: string, label = '', mode: RollMode = 'normal'): Roll | null {
  const p = parseDice(expr);
  if (!p) return null;
  const d20 = isD20(expr);
  if (!d20) mode = 'normal';
  let total = p.mod;
  let nat: number | undefined;
  const terms: DiceTerm[] = p.dice.map((d) => {
    const t: DiceTerm = { ...d, rolls: Array.from({ length: d.count }, () => die(d.sides)) };
    if (d20 && mode !== 'normal') {
      const other = die(20);
      const keep = mode === 'advantage' ? Math.max(t.rolls[0], other) : Math.min(t.rolls[0], other);
      t.dropped = [keep === t.rolls[0] ? other : t.rolls[0]];
      t.rolls = [keep];
    }
    total += d.sign * t.rolls.reduce((a, b) => a + b, 0);
    return t;
  });
  if (d20) nat = terms[0].rolls[0];
  const r: Roll = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), label, expr: exprText(p), mode, terms, mod: p.mod, total, nat };
  push(r);
  return r;
}

// ------------------------------------------------------------------ store (history + tray state)

const HISTORY_KEY = 'rc.dice.history';
const MAX = 30;

interface State {
  history: Roll[]; // newest first
  open: boolean;
  nextMode: RollMode; // applies to the next d20 roll, then returns to normal
}

function load(): Roll[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(v) ? v.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

let state: State = { history: load(), open: false, nextMode: 'normal' };
const subs = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
function push(r: Roll) {
  const history = [r, ...state.history].slice(0, MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* private mode: history lasts for this visit only */
  }
  set({ history, open: true });
}

export const diceStore = {
  get: () => state,
  subscribe: (f: () => void) => {
    subs.add(f);
    return () => subs.delete(f);
  },
  setOpen: (open: boolean) => set({ open }),
  setNextMode: (nextMode: RollMode) => set({ nextMode }),
  clear: () => {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* ignore */
    }
    set({ history: [] });
  },
  /** Roll using the tray's "next roll" mode (which then resets). */
  roll: (expr: string, label = '', mode?: RollMode) => {
    const m = mode ?? state.nextMode;
    const r = roll(expr, label, m);
    if (r && isD20(expr) && state.nextMode !== 'normal') set({ nextMode: 'normal' });
    return r;
  },
};

export function useDice(): State {
  return useSyncExternalStore(diceStore.subscribe, diceStore.get, diceStore.get);
}
