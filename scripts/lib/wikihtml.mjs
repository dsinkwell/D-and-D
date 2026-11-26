// Cleans Forgotten Realms Wiki (Fandom/MediaWiki) parser output into compact,
// readable, offline-friendly HTML. Text-only: images and galleries are dropped,
// infoboxes, tables, quotes and references are kept.

import { parseHTML } from 'linkedom';

const ORIGIN = 'https://forgottenrealms.fandom.com';

// Elements removed together with their contents.
const DROP = [
  'script', 'style', 'link', 'meta', 'noscript', 'svg', 'map', 'area', 'img', 'picture', 'video', 'audio', 'iframe', 'figure.pi-image',
  '.mw-editsection', '.navbox', '#toc', '.toc', '.printfooter', '.mw-empty-elt', '.noprint', '.wikia-gallery', '.gallery', '.wikia-gallery-item',
  '.thumb', '.thumbinner', '.info-icon', '.cite-bracket', '.mw-cite-backlink', '.pi-navigation', '.wds-tabs__wrapper', '.DPL-purge',
  '.mbox-image', '.wikia-slideshow', '.article-media', '.reference-text > .mw-cite-backlink', '[style*="display:none"]', '[style*="display: none"]',
];

// Classes worth keeping (everything else is stripped to save space).
const KEEP_CLASS = new Set([
  'portable-infobox', 'pi-title', 'pi-header', 'pi-data', 'pi-data-label', 'pi-data-value', 'pi-group', 'pi-item', 'pi-horizontal-group',
  'pi-smart-group', 'pi-smart-data-label', 'pi-smart-data-value', 'pi-caption',
  'references', 'reference', 'reference-text', 'redlink', 'frquote', 'quotetext', 'quotesource', 'wikitable', 'spelltable',
  'border-box', 'block-indent', 'mw-headline',
]);

const KEEP_ATTR = new Set(['href', 'id', 'colspan', 'rowspan', 'class', 'title', 'data-frag', 'start']);

// Title -> in-app link (resolved on the client to #/wiki/<title>).
const wikiPath = (title) => `#/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

export function cleanArticleHtml(raw) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${raw}</div></body></html>`);
  const root = document.getElementById('root');

  for (const sel of DROP) {
    try {
      root.querySelectorAll(sel).forEach((el) => el.remove());
    } catch {
      /* selector unsupported by parser — skip */
    }
  }

  // Unwrap containers that only add markup weight.
  root.querySelectorAll('.mw-parser-output, .mw-content-ltr, .border-box-contentarea, .border-box-content').forEach((el) => {
    if (el.classList?.contains('portable-infobox')) return;
    el.replaceWith(...el.childNodes);
  });

  // Links
  root.querySelectorAll('a').forEach((a) => {
    let h = a.getAttribute('href') || '';
    if (h.startsWith(ORIGIN)) h = h.slice(ORIGIN.length);
    if (!h) {
      a.replaceWith(...a.childNodes);
      return;
    }
    if (h.startsWith('#')) {
      a.setAttribute('data-frag', decodeURIComponent(h.slice(1)));
      a.setAttribute('href', '#');
    } else if (/redlink=1|action=edit/.test(h)) {
      const span = document.createElement('span');
      span.setAttribute('class', 'redlink');
      span.textContent = a.textContent;
      a.replaceWith(span);
      return;
    } else {
      const m = h.match(/^\/wiki\/([^?#]+)(#.*)?$/);
      if (m) {
        let title;
        try {
          title = decodeURIComponent(m[1]).replace(/_/g, ' ');
        } catch {
          title = m[1].replace(/_/g, ' ');
        }
        const ns = title.includes(':') ? title.split(':')[0] : '';
        if (!ns || ns === 'Category') a.setAttribute('href', wikiPath(title));
        else if (ns === 'File' || ns === 'Image') {
          a.replaceWith(...a.childNodes);
          return;
        } else a.setAttribute('href', ORIGIN + h);
      } else if (h.startsWith('/')) a.setAttribute('href', ORIGIN + h);
    }
    a.removeAttribute('title');
  });

  // Shorten footnote ids: cite_note-SCAG5e-p21,35-1 -> n1 (references are a large share of markup).
  const noteIds = new Map();
  const shortId = (long) => {
    if (!noteIds.has(long)) noteIds.set(long, `n${noteIds.size + 1}`);
    return noteIds.get(long);
  };
  root.querySelectorAll('[data-frag^="cite_note"]').forEach((a) => a.setAttribute('data-frag', shortId(a.getAttribute('data-frag'))));
  root.querySelectorAll('[id^="cite_note"]').forEach((el) => el.setAttribute('id', shortId(el.getAttribute('id'))));
  root.querySelectorAll('[id^="cite_ref"]').forEach((el) => el.removeAttribute('id'));

  // Wiki maintenance banners ("This is a Good Article!", etc.).
  root.querySelectorAll('p, div').forEach((el) => {
    if (/^This is a\s*(Good|Featured) Article!?$/i.test(el.textContent.trim())) el.remove();
  });

  // Strip attributes and classes we don't use.
  root.querySelectorAll('*').forEach((el) => {
    for (const { name } of [...el.attributes]) {
      if (!KEEP_ATTR.has(name)) el.removeAttribute(name);
    }
    const cls = el.getAttribute('class');
    if (cls) {
      const kept = cls.split(/\s+/).filter((c) => KEEP_CLASS.has(c) || c.startsWith('type-'));
      if (kept.length) el.setAttribute('class', kept.join(' '));
      else el.removeAttribute('class');
    }
    if (el.tagName !== 'A' && el.hasAttribute('title')) el.removeAttribute('title');
    // ids only matter for headings and footnotes
    const id = el.getAttribute('id');
    if (id && !/^n\d+$/.test(id) && !el.classList?.contains('mw-headline') && !/^H[1-6]$/.test(el.tagName)) el.removeAttribute('id');
  });

  // Remove now-empty wrappers.
  for (let pass = 0; pass < 3; pass++) {
    root.querySelectorAll('div, span, p, section, aside, small, figcaption, li, dd, dl, ul').forEach((el) => {
      if (!el.textContent.trim() && !el.querySelector('br, hr, table')) el.remove();
    });
  }

  let html = root.innerHTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*\n+/g, '\n')
    .replace(/>\s+</g, (m) => (m.includes('\n') ? '>\n<' : '> <'))
    .trim();

  const text = (root.textContent || '').replace(/\s+/g, ' ').trim();
  return { html, text };
}

/** Lead text (before the first heading), for search result snippets. */
export function summaryFrom(html) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  document.querySelectorAll('sup, small, aside, table, dl, ul, ol, .frquote, .border-box').forEach((el) => el.remove());
  let out = '';
  for (const node of document.body.childNodes) {
    if (node.nodeType === 1 && /^H[1-6]$/.test(node.tagName)) {
      if (out.length > 40) break;
      continue;
    }
    if (node.nodeType === 1 && node.tagName === 'DIV') continue;
    out += ' ' + (node.textContent || '');
    if (out.length > 400) break;
  }
  const t = out.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').replace(/\s([,.;:])/g, '$1').trim();
  return t.length > 220 ? t.slice(0, t.lastIndexOf(' ', 220)) + '…' : t;
}
