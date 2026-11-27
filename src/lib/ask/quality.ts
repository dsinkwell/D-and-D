// Runs the Ask quality test set (quality-questions.ts) through the same code the Ask page uses
// and scores each level: exact answers, list answers, which sources reach the writing model,
// whether the deciding sentence is in what the model is given, and (in the native app, when
// asked) the written answer itself.
import { isInstalled } from '../db';
import { ask } from './engine';
import { directAnswer, listAnswer } from './direct';
import { promptFrom } from './prompt';
import { textOf } from './highlight';
import { engineLabel, writeAnswer, type Engine } from './writer';
import { QUESTIONS, type QualityQuestion } from './quality-questions';

export type Level = 'direct' | 'list' | 'sources' | 'prompt' | 'answer';
export const LEVELS: Level[] = ['direct', 'list', 'sources', 'prompt', 'answer'];
export const LEVEL_LABEL: Record<Level, string> = {
  direct: 'Exact answers',
  list: 'List answers',
  sources: 'Right source chosen',
  prompt: 'Deciding text given to the model',
  answer: 'Written answer correct',
};

export interface Check {
  level: Level;
  ok: boolean;
  detail: string;
}

export interface QResult {
  id: string;
  q: string;
  topic: string;
  skipped?: string;
  checks: Check[];
  sources: string[]; // what the writing model was given
  answer?: string;
  ms: number;
}

export interface RunOptions {
  /** Write answers with this engine (native app only); search levels only when absent. */
  engine?: Engine | null;
  only?: string[];
  onProgress?: (done: number, total: number, last?: QResult) => void;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const rx = (p: string) => new RegExp(p, 'i');
const sameTitle = (have: string, want: string) => {
  const h = norm(have);
  const w = norm(want);
  return h === w || h.startsWith(`${w} `);
};

export async function runQuality(opts: RunOptions = {}): Promise<QResult[]> {
  const have = { books: await isInstalled('books').catch(() => false), wiki: await isInstalled('wiki').catch(() => false) };
  const qs = QUESTIONS.filter((x) => !opts.only || opts.only.includes(x.id));
  const out: QResult[] = [];
  for (const item of qs) {
    const r = await runOne(item, have, opts.engine || null);
    out.push(r);
    opts.onProgress?.(out.length, qs.length, r);
  }
  return out;
}

async function runOne(item: QualityQuestion, have: { books: boolean; wiki: boolean }, engine: Engine | null): Promise<QResult> {
  const res: QResult = { id: item.id, q: item.q, topic: item.topic, checks: [], sources: [], ms: 0 };
  const missing = (item.needs || []).filter((n) => !have[n]);
  if (missing.length) {
    res.skipped = `needs the ${missing.join(' and ')} download`;
    return res;
  }
  const t0 = performance.now();
  try {
    const [direct, list, found] = await Promise.all([
      item.direct ? directAnswer(item.q).catch(() => null) : null,
      item.list ? listAnswer(item.q).catch(() => null) : null,
      item.sources || item.prompt || item.answer ? ask(item.q, 6) : null,
    ]);

    if (item.direct) {
      const text = direct ? textOf(direct.html) : '';
      res.checks.push({ level: 'direct', ok: !!direct && rx(item.direct).test(text), detail: direct ? `${text} (${direct.source})` : 'no exact answer' });
    }

    if (item.list) {
      const names = new Set((list?.all || []).map((i) => norm(i.title)));
      const lacking = item.list.include.filter((n) => !names.has(norm(n)));
      const wrong = (item.list.exclude || []).filter((n) => names.has(norm(n)));
      res.checks.push({
        level: 'list',
        ok: !!list && !lacking.length && !wrong.length,
        detail: !list ? 'no list answer' : [`${list.total} items`, lacking.length && `missing ${lacking.join(', ')}`, wrong.length && `wrongly includes ${wrong.join(', ')}`].filter(Boolean).join('; '),
      });
    }

    if (found) {
      // the native app gives Apple's model 3 sources and the small open models 2
      const n = engine?.kind === 'local' ? 2 : 3;
      const excerpt = engine?.kind === 'local' ? 900 : 1600; // as in writer.ts
      const dir = item.direct ? direct : await directAnswer(item.q).catch(() => null);
      const built = await promptFrom(item.q, dir, found.passages, n, excerpt);
      res.sources = [...(dir ? [`${dir.title} (${dir.source})`] : []), ...built.sources.map((p) => `${p.title} (${p.label})`)];
      const titles = [...(dir ? [dir.title] : []), ...built.sources.map((p) => p.title)];
      if (item.sources) {
        const hit = item.sources.find((w) => titles.some((t) => sameTitle(t, w)));
        res.checks.push({ level: 'sources', ok: !!hit, detail: hit ? `has “${hit}”` : `got ${res.sources.join('; ') || 'nothing'}` });
      }
      if (item.prompt) {
        const text = built.prompt;
        const lacking = item.prompt.filter((p) => !rx(p).test(text));
        res.checks.push({ level: 'prompt', ok: !lacking.length, detail: lacking.length ? `missing /${lacking.join('/, /')}/` : 'present' });
      }
      if (item.answer && engine) {
        const w = await writeAnswer(item.q, () => {}, undefined, { direct: dir, passages: found.passages }, engine);
        res.answer = w.text.trim();
        const lacking = item.answer.filter((p) => !rx(p).test(res.answer!));
        res.checks.push({ level: 'answer', ok: !lacking.length, detail: lacking.length ? `missing /${lacking.join('/, /')}/` : 'correct' });
      }
    }
  } catch (e) {
    res.checks.push({ level: 'sources', ok: false, detail: `error: ${String((e as Error)?.message || e)}` });
  }
  res.ms = Math.round(performance.now() - t0);
  return res;
}

export interface Summary {
  levels: { level: Level; pass: number; total: number }[];
  pass: number;
  total: number;
  skipped: number;
}

export function summarize(results: QResult[]): Summary {
  const levels = LEVELS.map((level) => {
    const cs = results.flatMap((r) => r.checks.filter((c) => c.level === level));
    return { level, pass: cs.filter((c) => c.ok).length, total: cs.length };
  }).filter((l) => l.total);
  const all = results.flatMap((r) => r.checks);
  return { levels, pass: all.filter((c) => c.ok).length, total: all.length, skipped: results.filter((r) => r.skipped).length };
}

/** A plain-text report to copy and share. */
export function report(results: QResult[], engine?: Engine | null): string {
  const s = summarize(results);
  const lines = [
    `FR Reference — Ask quality test (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
    `Written answers: ${engine ? engineLabel(engine) : 'not tested'}`,
    `Overall: ${s.pass}/${s.total} checks passed${s.skipped ? `, ${s.skipped} questions skipped` : ''}`,
    ...s.levels.map((l) => `  ${LEVEL_LABEL[l.level]}: ${l.pass}/${l.total}`),
    '',
  ];
  for (const r of results) {
    if (r.skipped) {
      lines.push(`– ${r.id}: skipped (${r.skipped})`);
      continue;
    }
    const bad = r.checks.filter((c) => !c.ok);
    lines.push(`${bad.length ? '✗' : '✓'} ${r.id}: ${r.q}`);
    for (const c of bad) lines.push(`    ${c.level}: ${c.detail}`);
    if (bad.length && r.sources.length && !bad.some((c) => c.level === 'sources')) lines.push(`    sources: ${r.sources.join('; ')}`);
    if (r.answer && bad.some((c) => c.level === 'answer')) lines.push(`    answer: ${r.answer.replace(/\s+/g, ' ')}`);
  }
  return lines.join('\n');
}
