// Native app only: Apple's on-device model writes a short answer from the Ask passages
// (ios/App/App/WriterPlugin.swift). On the web this reports "not available".
import { isNative } from '../platform';
import { buildPrompt, type BuiltPrompt } from './prompt';

interface WriterPlugin {
  availability(): Promise<{ available: boolean; reason?: string }>;
  prewarm(o: { instructions: string }): Promise<void>;
  write(o: { id: string; instructions: string; prompt: string; maxTokens: number }): Promise<{ text: string }>;
  addListener(event: 'writer', fn: (d: { id: string; text: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

let plugin: Promise<WriterPlugin> | null = null;
const getPlugin = () => (plugin ??= import('@capacitor/core').then(({ registerPlugin }) => registerPlugin<WriterPlugin>('Writer')));

let avail: Promise<{ available: boolean; reason?: string }> | null = null;
export function writerAvailability() {
  if (!isNative()) return Promise.resolve({ available: false, reason: 'web' });
  avail ??= getPlugin()
    .then((w) => w.availability())
    .catch((e) => ({ available: false, reason: String(e?.message || e) }));
  return avail;
}

export async function prewarmWriter() {
  if ((await writerAvailability()).available) (await getPlugin()).prewarm({ instructions: (await import('./prompt')).INSTRUCTIONS }).catch(() => {});
}

export interface Written {
  text: string;
  built: BuiltPrompt;
  firstMs: number;
  totalMs: number;
}

/** Search, then have the on-device model write the answer; onText gets the text so far. */
export async function writeAnswer(q: string, onText: (text: string) => void, onSources?: (b: BuiltPrompt) => void): Promise<Written> {
  const w = await getPlugin();
  const built = await buildPrompt(q);
  onSources?.(built);
  const id = Math.random().toString(36).slice(2);
  const t0 = performance.now();
  let firstMs = 0;
  const sub = await w.addListener('writer', (d) => {
    if (d.id !== id) return;
    if (!firstMs) firstMs = Math.round(performance.now() - t0);
    onText(d.text);
  });
  try {
    const r = await w.write({ id, instructions: built.instructions, prompt: built.prompt, maxTokens: 300 });
    return { text: r.text, built, firstMs, totalMs: Math.round(performance.now() - t0) };
  } finally {
    await sub.remove();
  }
}
