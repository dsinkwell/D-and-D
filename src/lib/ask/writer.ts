// Native app only: written answers from the Ask passages, by Apple's on-device model
// (ios/App/App/WriterPlugin.swift) or, on devices without Apple Intelligence, by a small open
// model run with llama.cpp (ios/App/App/LocalWriterPlugin.swift). The web app has neither.
import { registerPlugin } from '@capacitor/core';
import { isNative } from '../platform';
import { buildPrompt, promptFrom, type BuiltPrompt, type Convo } from './prompt';
import type { Direct } from './direct';
import type { Passage } from './engine';

interface WriterPlugin {
  availability(): Promise<{ available: boolean; reason?: string }>;
  prewarm(o: { instructions: string }): Promise<void>;
  write(o: { id: string; instructions: string; prompt: string; maxTokens: number }): Promise<{ text: string }>;
  addListener(event: 'writer', fn: (d: { id: string; text: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

// Note: a Capacitor plugin object must never be the result of a promise. It answers every
// property as a native method, so `await`ing it calls a native "then" that never replies.
// That bug made the availability check hang; create it synchronously instead.
let plugin: WriterPlugin | null = null;
const getPlugin = (): WriterPlugin => (plugin ??= registerPlugin<WriterPlugin>('Writer'));

export interface LocalModel {
  id: string;
  name: string;
  mb: number;
  downloaded: boolean;
  fits: boolean;
}
export interface LocalStatus {
  capable: boolean;
  memoryGB: number;
  models: LocalModel[];
  downloading: string | null;
}
interface LocalWriterPlugin {
  status(): Promise<LocalStatus>;
  download(o: { model: string }): Promise<void>;
  cancelDownload(): Promise<void>;
  remove(o: { model: string }): Promise<void>;
  write(o: { id: string; model: string; instructions: string; prompt: string; maxTokens: number }): Promise<{ text: string; promptTokens: number; tokens: number; loadMs: number }>;
  addListener(event: 'localWriter', fn: (d: { id: string; text: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: 'localDownload', fn: (d: { model: string; received: number; total: number }) => void): Promise<{ remove: () => Promise<void> }>;
}
let local: LocalWriterPlugin | null = null;
const getLocal = (): LocalWriterPlugin => (local ??= registerPlugin<LocalWriterPlugin>('LocalWriter'));

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
const NO_LOCAL: LocalStatus = { capable: false, memoryGB: 0, models: [], downloading: null };

/** Open-model status: can this device run one, which are downloaded. */
export function localStatus(): Promise<LocalStatus> {
  if (!isNative()) return Promise.resolve(NO_LOCAL);
  return withTimeout(Promise.resolve().then(() => getLocal().status()), 4000, NO_LOCAL).catch(() => NO_LOCAL);
}

export async function downloadLocalModel(model: string, onProgress: (received: number, total: number) => void) {
  const w = getLocal();
  const sub = await w.addListener('localDownload', (d) => d.model === model && onProgress(d.received, d.total));
  try {
    await w.download({ model });
  } finally {
    await sub.remove();
  }
}
export const cancelLocalDownload = () => getLocal().cancelDownload();
export const removeLocalModel = (model: string) => getLocal().remove({ model });

// Preferences (per device): which downloaded open model to use, and a testing switch to use it
// even where Apple Intelligence is available.
const pref = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const setPref = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};
export const preferOpen = () => pref('write-prefer-open') === '1';
export const setPreferOpen = (on: boolean) => setPref('write-prefer-open', on ? '1' : null);
export const localChoice = () => pref('write-local-model');
export const setLocalChoice = (id: string) => setPref('write-local-model', id);

export type Engine = { kind: 'apple' } | { kind: 'local'; model: string; name: string };
export const engineLabel = (e: Engine) => (e.kind === 'apple' ? 'Apple Intelligence' : `${e.name} (open model)`);

/**
 * Which writer to use on this device, or none (the normal Ask). `hint` is set when a device
 * without Apple Intelligence could download an open model.
 */
export async function chooseEngine(): Promise<{ engine: Engine | null; hint?: string }> {
  if (!isNative()) return { engine: null };
  const [apple, st] = await Promise.all([writerAvailability(), localStatus()]);
  const ready = st.models.filter((m) => m.downloaded && m.fits);
  const pick = ready.find((m) => m.id === localChoice()) || ready[0];
  const localEngine: Engine | null = pick ? { kind: 'local', model: pick.id, name: pick.name } : null;
  if (apple.available && !(preferOpen() && localEngine)) return { engine: { kind: 'apple' } };
  if (localEngine) return { engine: localEngine };
  if (st.capable) return { engine: null, hint: 'download a writing model in Settings (⚙︎) to get written answers on this device' };
  return { engine: null };
}

let avail: Promise<{ available: boolean; reason?: string }> | null = null;
export function writerAvailability() {
  if (!isNative()) return Promise.resolve({ available: false, reason: 'web' });
  // A plugin call the native side doesn't recognise never answers, so don't wait forever.
  const C = (window as any).Capacitor;
  const plugins = () => (C?.PluginHeaders || []).map((h: { name: string }) => h.name).join(', ') || 'none';
  const timeout = new Promise<{ available: boolean; reason: string }>((res) =>
    setTimeout(() => res({ available: false, reason: `no reply from the app's Writer plugin (registered: ${plugins()}; Writer available: ${C?.isPluginAvailable?.('Writer')})` }), 4000),
  );
  avail ??= Promise.race([Promise.resolve().then(() => getPlugin().availability()), timeout]).catch((e) => ({
    available: false,
    reason: `${String(e?.message || e)} (registered: ${plugins()})`,
  }));
  return avail;
}

export async function prewarmWriter() {
  if ((await writerAvailability()).available) getPlugin().prewarm({ instructions: (await import('./prompt')).INSTRUCTIONS }).catch(() => {});
}

export interface Written {
  text: string;
  built: BuiltPrompt;
  firstMs: number;
  totalMs: number;
  engine: Engine;
}

/** Have the chosen on-device model write the answer; onText gets the text so far. */
export async function writeAnswer(
  q: string,
  onText: (text: string) => void,
  onSources?: (b: BuiltPrompt) => void,
  found?: { direct: Direct | null; passages: Passage[] }, // results the Ask search already has
  engine: Engine = { kind: 'apple' },
  convo?: Convo, // a follow-up: q is the rebuilt question; the prompt also gets the earlier turns
): Promise<Written> {
  // small open models are easily led off by extra sources: give them at most 2 (Apple: 3)
  const n = engine.kind === 'local' ? 2 : 3;
  // Apple's model has room for longer excerpts (the deciding sentence of a long rule, e.g. the
  // +2 on a charge, is often past the first 900 characters)
  const excerpt = engine.kind === 'local' ? 900 : 1600;
  const built = found ? await promptFrom(q, found.direct, found.passages, n, excerpt, 0, convo) : await buildPrompt(q, n, excerpt, convo);
  onSources?.(built);
  const r = await runWriter(built.instructions, built.prompt, engine, onText, 300);
  return { ...r, built, engine };
}

/** One call to the chosen on-device model; onText gets the text so far. */
async function runWriter(instructions: string, prompt: string, engine: Engine, onText: (text: string) => void, maxTokens: number) {
  const id = Math.random().toString(36).slice(2);
  const t0 = performance.now();
  let firstMs = 0;
  const onEvent = (d: { id: string; text: string }) => {
    if (d.id !== id) return;
    if (!firstMs) firstMs = Math.round(performance.now() - t0);
    onText(d.text);
  };
  const args = { id, instructions, prompt, maxTokens };
  if (engine.kind === 'local') {
    const w = getLocal(); // not awaited: see note above
    const sub = await w.addListener('localWriter', onEvent);
    try {
      const r = await w.write({ ...args, model: engine.model });
      return { text: r.text as string, firstMs, totalMs: Math.round(performance.now() - t0) };
    } finally {
      await sub.remove();
    }
  }
  const w = getPlugin(); // not awaited: see note above
  const sub = await w.addListener('writer', onEvent);
  try {
    const r = await w.write(args);
    return { text: r.text as string, firstMs, totalMs: Math.round(performance.now() - t0) };
  } finally {
    await sub.remove();
  }
}

// "Explain this" on an entry: a plain-English explanation of the entry's own text.
export const EXPLAIN_INSTRUCTIONS = [
  'You explain Dungeons & Dragons 3.5 and Forgotten Realms entries in plain English, using only the text you are given.',
  'First say in one sentence what it is and what it does.',
  'Then explain how it works in play: when you would use it, what it requires or costs, and the numbers that matter (range, duration, saving throw, bonuses, prerequisites, hit dice).',
  'Explain game terms briefly in everyday words. Write 3 to 6 short sentences.',
  'Do not add rules, facts or advice that are not in the text. If the text is lore rather than rules, summarise who or what it is and why it matters.',
].join(' ');

/** The prompt for "Explain this": the entry's text, trimmed to what the model has room for. */
export function explainPrompt(title: string, label: string, text: string, engine: Engine) {
  const room = engine.kind === 'local' ? 1800 : 4000;
  // footnote marks and wiki boilerplate only take the model's room
  const body = text
    .replace(/\u00a0/g, ' ')
    .replace(/\[\s*\d+\s*\]/g, '')
    .replace(/\bThis\s+is\s+an?\s+(?:Good|Featured)\s+Article\s*!?/gi, '')
    .replace(/[—-]\s*quick facts/gi, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = body.length > room ? `${body.slice(0, room).replace(/\s\S*$/, '')} …` : body;
  return `Source [${label}] ${title}:\n${cut}\n\nExplain “${title}” in plain English for a player at the table.`;
}

export async function explainEntry(title: string, label: string, text: string, engine: Engine, onText: (text: string) => void) {
  const prompt = explainPrompt(title, label, text, engine);
  const r = await runWriter(EXPLAIN_INSTRUCTIONS, prompt, engine, onText, 350);
  return { ...r, prompt };
}

// "Write answers automatically" (native app): on unless turned off on the About page.
const AUTO = 'ask-autowrite';
export const autoWrite = () => {
  try {
    return localStorage.getItem(AUTO) !== '0';
  } catch {
    return true;
  }
};
export const setAutoWrite = (on: boolean) => {
  try {
    localStorage.setItem(AUTO, on ? '1' : '0');
  } catch {
    /* private mode */
  }
};
