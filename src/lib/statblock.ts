// Turns an entry's HTML (from the SRD or a rulebook) into the compact reference layout:
// one stat per line with a coloured label, an ability-score grid, an italic subtitle line
// ("Medium Humanoid (Goblinoid)", "Evocation [Fire]") and highlighted special abilities.

const ABILITIES = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'] as const;
const LABEL = /^\s*<(b|strong)>\s*([^<]{1,48}?)\s*:?\s*<\/\1>\s*:?\s*/i;
const SUBTITLE_KINDS = new Set(['spell', 'power', 'monster']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

function mod(v: number) {
  const m = Math.floor((v - 10) / 2);
  return m >= 0 ? `+${m}` : `−${-m}`;
}

/** "Str 25, Dex 10, Con 23, Int 16, Wis 15, Cha 19" → the STR … CHA grid (null if not ability scores). */
export function abilityGrid(text: string): string | null {
  const found = new Map<string, string>();
  for (const m of text.matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\s+(\d{1,2}|—|–|-)/g)) if (!found.has(m[1])) found.set(m[1], m[2]);
  if (found.size < 5) return null;
  const head = ABILITIES.map((a) => `<th>${a.toUpperCase()}</th>`).join('');
  const vals = ABILITIES.map((a) => {
    const v = found.get(a);
    if (!v || !/^\d+$/.test(v)) return `<td>—</td>`;
    return `<td>${v} (${mod(Number(v))})</td>`;
  }).join('');
  return `<table class="ability-grid"><tr>${head}</tr><tr>${vals}</tr></table>`;
}

function statLine(segment: string): string {
  const t = textOf(segment);
  if (/^(Abilities\s*:)?\s*Str\s+(\d|—|–|-)/.test(t)) {
    const grid = abilityGrid(t);
    if (grid) return grid;
  }
  const m = segment.match(LABEL);
  if (!m) return `<div class="stat">${segment}</div>`;
  const rest = segment.slice(m[0].length);
  return `<div class="stat"><span class="lbl">${esc(m[2])}</span> ${rest}</div>`;
}

export function formatEntry(html: string, kind: string): string {
  if (typeof DOMParser === 'undefined' || !html) return html;
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root')!;

  // SRD stat blocks are two-column tables ("Hit Dice:" | "3d8+3 (16 hp)"): make them stat lines.
  for (const t of Array.from(root.querySelectorAll('table'))) {
    const rows = Array.from(t.querySelectorAll('tr'));
    const two = rows.filter((r) => r.children.length === 2);
    const labelled = two.filter((r) => /:\s*$/.test(r.children[0].textContent || ''));
    if (rows.length >= 4 && two.length === rows.length && labelled.length >= rows.length * 0.6) {
      const out = rows
        .map((r) => {
          const label = (r.children[0].textContent || '').trim().replace(/:\s*$/, '');
          const value = r.children[1].innerHTML.trim();
          if (label === 'Abilities') return abilityGrid(textOf(value)) || `<div class="stat"><span class="lbl">${esc(label)}</span> ${value}</div>`;
          return `<div class="stat"><span class="lbl">${esc(label)}</span> ${value}</div>`;
        })
        .join('');
      const holder = doc.createElement('div');
      holder.className = 'statblock';
      holder.innerHTML = out;
      t.replaceWith(holder);
    }
  }

  const paras = Array.from(root.children).filter((el) => el.tagName === 'P') as HTMLElement[];
  paras.forEach((p, i) => {
    const inner = p.innerHTML;
    const text = textOf(inner);
    // subtitle: the short type/school line right under the title
    if (i === 0 && SUBTITLE_KINDS.has(kind) && text.length < 90 && !/:/.test(text.slice(0, 30)) && p === root.firstElementChild) {
      p.className = 'ref-subtitle';
      p.innerHTML = esc(text);
      return;
    }
    // special abilities: "Frightful Presence (Ex):", "Spell-Like Abilities:"
    const ab = inner.match(/^\s*<(b|strong|i|em)>\s*([^<]{2,60}?\((Ex|Su|Sp)\)[^<]{0,4}?)\s*<\/\1>\s*/);
    if (ab) {
      p.innerHTML = `<span class="ability-name">${esc(ab[2].replace(/\s*:\s*$/, ''))}.</span> ${inner.slice(ab[0].length)}`;
      return;
    }
    // stat lines: a paragraph of "Label: value" lines separated by <br>, or a bare ability line
    const segments = inner.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
    const labelled = segments.filter((s) => LABEL.test(s)).length;
    const abilityOnly = segments.length === 1 && /^(Abilities\s*:)?\s*Str\s+(\d|—|–|-)/.test(text);
    if ((segments.length >= 2 && labelled >= Math.max(2, segments.length * 0.5)) || abilityOnly) {
      const holder = doc.createElement('div');
      holder.className = 'statblock';
      // "Evocation [Fire]" / "Medium Humanoid (Goblinoid)" set as the first line of the stat block
      let lead = '';
      if (i === 0 && SUBTITLE_KINDS.has(kind) && !LABEL.test(segments[0]) && textOf(segments[0]).length < 90 && !abilityOnly) {
        lead = `<p class="ref-subtitle">${esc(textOf(segments[0]))}</p>`;
        segments.shift();
      }
      holder.innerHTML = segments.map(statLine).join('');
      p.replaceWith(holder);
      if (lead) holder.insertAdjacentHTML('beforebegin', lead);
    }
  });
  return root.innerHTML;
}
