/*
 * The SVG painter: a Book (format.js) drawn as one SVG document per page.
 *
 * The desktop previews these pages as they are and prints them to PDF through Chromium, so this
 * is the desktop's whole renderer; Android's painter draws the same items onto a Canvas. Neither
 * makes a layout decision - if a page looks wrong, the fault is in the composer, and it is wrong
 * on both.
 *
 * One liberty is allowed, and fitText takes it: a line wider than the width the composer measured
 * it at is shrunk to fit. The composer measures from advance tables and Chromium shapes with
 * HarfBuzz, so a Devanagari conjunct can differ by a few per cent; shrinking by that much is
 * invisible, and overflowing a card is not.
 *
 * Format 2's symbols are expanded inline rather than drawn as <use href="#id">. A page has to be a
 * document on its own: the desktop joins every page into one file to print it, and a symbol that
 * kept its id would then meet a copy of itself on the next page. Expanding costs some markup and
 * buys a page that can be previewed, printed or saved alone.
 */

import { FORMAT, FORMAT_MAX, MAX_SYMBOL_DEPTH } from './format.js';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param book      a Book
 * @param index     which page
 * @param resolve   { photo(id) -> href or null, font(key) -> CSS font-family, idPrefix }
 */
export function paintPage(book, index, resolve) {
  if (book.format !== FORMAT && book.format !== FORMAT_MAX) throw new Error(`svg: cannot paint book format ${book.format}`);
  const page = book.pages[index];
  const prefix = resolve.idPrefix ?? `p${index}-`;
  const state = { defs: new Map(), clips: [], n: 0, depth: 0, prefix, book, resolve };
  const body = page.items.map((it) => item(it, state)).join('');
  const defs = [...state.defs.values()].join('') + state.clips.join('');
  const { w, h } = book.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}pt" height="${h}pt" role="img" aria-label="${esc(`Page ${index + 1} of ${book.pages.length}: ${page.label}`)}">`
    + (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>';
}

function fillAttr(fill, state) {
  if (fill === undefined) return 'none';
  if (typeof fill === 'string') return fill;
  const id = state.prefix + fill.ref;
  if (!state.defs.has(id)) state.defs.set(id, gradient(id, own(state.book.defs, fill.ref, 'gradient')));
  return `url(#${id})`;
}

function gradient(id, g) {
  const stops = g.stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined || a === 1 ? '' : ` stop-opacity="${a}"`}/>`).join('');
  if (g.units === 'item') {
    // Relative to the circle it fills: the centre offset and radius are in units of its radius.
    return `<radialGradient id="${id}" gradientUnits="objectBoundingBox" cx="${0.5 + g.cx / 2}" cy="${0.5 + g.cy / 2}" r="${g.r / 2}">${stops}</radialGradient>`;
  }
  if (g.type === 'radial') return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${g.cx}" cy="${g.cy}" r="${g.r}">${stops}</radialGradient>`;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">${stops}</linearGradient>`;
}

function stroke(it) {
  if (!it.stroke) return '';
  let s = ` stroke="${it.stroke}" stroke-width="${it.sw}"`;
  if (it.dash) s += ` stroke-dasharray="${it.dash.join(' ')}"`;
  if (it.cap) s += ` stroke-linecap="${it.cap}"`;
  if (it.join) s += ` stroke-linejoin="${it.join}"`;
  return s;
}

/** A named thing the book carries - never one the Object prototype lends it (`constructor`). */
function own(map, ref, kind) {
  if (!map || typeof map !== 'object' || typeof ref !== 'string' || !Object.hasOwn(map, ref)) throw new Error(`svg: unknown ${kind} ${ref}`);
  return map[ref];
}

const opacity = (it) => (it.op !== undefined ? ` opacity="${it.op}"` : '');

const transform = (it) => (it.tf ? ` transform="matrix(${it.tf.join(' ')})"` : '');

/** A clip shape, kept in the page's own defs under an id nothing else on the page can take. */
function clipPath(shape, state) {
  const id = `${state.prefix}clip${state.n++}`;
  state.clips.push(`<clipPath id="${id}">${shape}</clipPath>`);
  return id;
}

/*
 * Silhouette mode (Ankit's rule, 2026-09-21): a paper shadow is the same shape as the art it falls
 * from, offset. So every fill and every stroke the symbol draws - down through its groups, its
 * gradient fills and any symbol it uses - takes the use's one colour, and nothing else changes:
 * a stroke keeps its width, dash, cap and join, a stroke-only item stays unfilled (an open string
 * casts a line, a ring casts a ring), a fill-only item stays unstroked, and an item's or group's
 * own opacity stays as it was. The use's own `op` is applied once, to the whole silhouette, by
 * the <g> expand() wraps it in.
 */
function silhouette(it, colour) {
  if (it.t === 'group') return { ...it, items: (it.items ?? []).map((c) => silhouette(c, colour)) };
  if (it.t === 'use') return { ...it, fill: colour };   // a nested use casts in the same colour
  const o = { ...it };
  if (o.fill !== undefined) o.fill = colour;
  if (o.stroke !== undefined) o.stroke = colour;
  return o;
}

function expand(it, state) {
  const symbol = own(state.book.symbols, it.ref, 'symbol');
  if (!Array.isArray(symbol?.items)) throw new Error(`svg: unknown symbol ${it.ref}`);
  // The same limit validateBook holds a book to, so a book that validates always paints and a
  // cycle that slipped past validation stops here instead of hanging the preview.
  if (state.depth >= MAX_SYMBOL_DEPTH) throw new Error(`svg: symbol ${it.ref} is used more than ${MAX_SYMBOL_DEPTH} deep`);
  state.depth++;
  const items = it.fill === undefined ? symbol.items : symbol.items.map((c) => silhouette(c, it.fill));
  const body = items.map((c) => item(c, state)).join('');
  state.depth--;
  // The use's opacity is one group alpha on this wrapper, never pushed down to the items: shapes
  // that overlap inside a dimmed lamp, or inside its shadow, must not darken where they meet.
  // Android must draw it the same way, through saveLayerAlpha (#246).
  return `<g${transform(it)}${opacity(it)}>${body}</g>`;
}

function item(it, state) {
  switch (it.t) {
    case 'rect':
      return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"${it.r ? ` rx="${it.r}"` : ''} fill="${fillAttr(it.fill, state)}"${stroke(it)}${opacity(it)}/>`;
    case 'circle':
      return `<circle cx="${it.cx}" cy="${it.cy}" r="${it.r}" fill="${fillAttr(it.fill, state)}"${stroke(it)}${opacity(it)}/>`;
    case 'path':
      return `<path d="${it.d}" fill="${fillAttr(it.fill, state)}"${it.rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${stroke(it)}${opacity(it)}/>`;
    case 'text': {
      const anchor = it.align === 'middle' ? ' text-anchor="middle"' : it.align === 'end' ? ' text-anchor="end"' : '';
      const family = esc(state.resolve.font(state.book.fonts[it.font]));
      return `<text x="${it.x}" y="${it.y}" font-family="${family}" font-size="${it.size}" fill="${fillAttr(it.fill, state)}"${anchor}${it.w !== undefined ? ` data-w="${it.w}"` : ''}${opacity(it)}>${esc(it.s)}</text>`;
    }
    case 'image': {
      const href = state.resolve.photo(it.id);
      if (!href) return '';   // a photograph the archive has lost: the portrait's ring still stands
      const shape = it.clip === 'circle'
        ? `<circle cx="${it.x + it.w / 2}" cy="${it.y + it.h / 2}" r="${Math.min(it.w, it.h) / 2}"/>`
        : `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"/>`;
      const id = clipPath(shape, state);
      return `<image href="${esc(href)}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"${opacity(it)}/>`;
    }
    case 'group': {
      const tf = transform(it);
      const clip = it.clip === undefined ? '' : ` clip-path="url(#${clipPath(`<path d="${esc(it.clip)}"/>`, state)})"`;
      const body = it.items.map((c) => item(c, state)).join('');
      // A clip is in the group's own coordinates, so where there is a transform the clip goes
      // inside it, on a group of its own. That is the order a Canvas painter takes: save, concat,
      // clipPath, draw. Without a transform the two coordinate systems are the same one group.
      return tf && clip ? `<g${tf}${opacity(it)}><g${clip}>${body}</g></g>` : `<g${tf}${clip}${opacity(it)}>${body}</g>`;
    }
    case 'use':
      return expand(it, state);
    default:
      throw new Error(`svg: unknown item type ${it.t}`);
  }
}

/**
 * Shrinks, never grows, any line that Chromium measures wider than the composer did. Run it in a
 * document where the fonts have loaded (document.fonts.ready), or it measures the fallback face.
 * Returns how many lines it had to touch, which the tests watch: for Latin text it should be none.
 */
export function fitText(root) {
  let corrected = 0;
  for (const el of root.querySelectorAll('text[data-w]')) {
    const want = Number(el.getAttribute('data-w'));
    const got = el.getComputedTextLength();
    if (want > 0 && got > want * 1.005) {
      const size = Number(el.getAttribute('font-size'));
      el.setAttribute('font-size', String(Math.round(size * (want / got) * 100) / 100));
      corrected++;
    }
  }
  return corrected;
}
