// The prompt for written answers: the Ask search's exact answer (if any) and best passages,
// trimmed to the sentences around the match, plus instructions. Shared by the native app's
// "Write an answer" (Apple's on-device model) and the web test page (#/lab).
import { ask, type Passage } from './engine';
import { directAnswer } from './direct';
import { highlight, textOf } from './highlight';

export const INSTRUCTIONS =
  'You answer questions about Dungeons & Dragons 3.5 and the Forgotten Realms. Use only the sources you are given. ' +
  'Answer in 2 to 4 plain sentences. Name the source you used in brackets, like [PHB p. 57]. ' +
  'If the sources do not answer the question, say so.';

export interface BuiltPrompt {
  instructions: string;
  prompt: string; // sources + question
  sources: Passage[];
  searchMs: number;
}

export async function buildPrompt(q: string, nSources = 4, excerpt = 520): Promise<BuiltPrompt> {
  const t0 = performance.now();
  const [direct, found] = await Promise.all([directAnswer(q).catch(() => null), ask(q, nSources + 2)]);
  const sources = found.passages.slice(0, nSources);
  const lines: string[] = [];
  if (direct) lines.push(`[${direct.source}] ${direct.title}: ${textOf(direct.html)}`);
  for (const p of sources) {
    const ex = textOf(highlight(p.html, q, excerpt, p.title).excerpt.replace(/<\/?mark>/g, ''));
    lines.push(`[${p.label}] ${p.title}: ${ex}`);
  }
  return {
    instructions: INSTRUCTIONS,
    prompt: `Sources:\n${lines.join('\n\n')}\n\nQuestion: ${q}`,
    sources,
    searchMs: Math.round(performance.now() - t0),
  };
}
