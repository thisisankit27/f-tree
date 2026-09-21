/*
 * composeBook: a family, a template and some options in; a Book out (format.js).
 *
 * This is the one place the book is laid out. The desktop runs it in its renderer; Android runs
 * this same file inside a hidden WebView and paints what it returns. Nothing here may read the
 * clock, the locale, the DOM or the network - see family.js - and it runs synchronously, because a
 * WebView that is not attached to a window never fires an animation frame and throttles timers.
 */

import { formatOf, PAGE, text, circle, image, rect } from './format.js';
import { measure, breakLines, fitSize } from './text.js';
import { readFamily, familyFacts } from './family.js';
import { validateTemplate } from './template.js';
import { METRICS } from './metrics/index.js';
import { resolveFeatured } from './story/featured.js';
import { cover } from './blocks/cover.js';
import { treePage } from './blocks/tree.js';
import { numbersPage } from './blocks/numbers.js';
import { generationPages } from './blocks/generations.js';
import { findYourself } from './blocks/find.js';
import { closingPage } from './blocks/closing.js';

const BLOCKS = {
  cover: (ctx) => [cover(ctx)],
  tree: (ctx) => [treePage(ctx)],
  numbers: (ctx) => [numbersPage(ctx)],
  generations: (ctx) => generationPages(ctx),
  find: (ctx) => findYourself(ctx),
  closing: (ctx) => [closingPage(ctx)],
};

/** Every block a template may name. template.js refuses any other. */
export const BLOCK_NAMES = Object.keys(BLOCKS);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * @param doc       the .ftree document (tree.json), exactly as either shell exports it
 * @param options   { now: 'YYYY-MM-DD', scope, title, photos: bool, livingDates: bool, words: 'en'|'hi',
 *                    featured?: personId, notes?: bool, coverOnly?: bool }
 *                  `featured` and `notes` are generic on every template - see `ctx.featured` and
 *                  `family.js`'s `note` field - but nothing here reads them yet: the story pages
 *                  that will are #256-258. `coverOnly` stops this function short, below.
 * @param template  a template document, validated here (template.js)
 * @param allowance what the policy granted: { maxGenerations?, attribution? } - empty means all
 */
export function composeBook(doc, options, template, allowance = {}) {
  return compose(doc, options, template, allowance, null);
}

/**
 * The same book, plus what the QA harness (#245) checks it against: `{ book, report }`.
 *
 * `book` is byte-for-byte what `composeBook` returns - the report is gathered beside the book,
 * never written into it. `report` is:
 *   - `shown`: `{ [personId]: [page, ...] }`, every page (1-based) that names or portrays someone.
 *     A block records a person with `ctx.show(id)`; `ctx.portrait` does it for every portrait, so a
 *     format-1 book reports its tree and generation pages without any block changing.
 *   - `textBoxes`: `[{ page, x, y, w, h, size, font, kind, op, s }]`, one per `text` item, in page
 *     coordinates after every group transform. The box is the line's ink band: from 0.75 of its
 *     size above the baseline to 0.2 below, across the width it prints at. `size` is the size
 *     it prints at (scaled by any group transform). `kind` is what the page said the line is -
 *     `ctx.line(..., { kind: 'body' | 'name' | 'caption' | ... })` - or null when it said nothing,
 *     as no format-1 block does.
 *   - `artZones`: `[{ page, kind: 'text' | 'face' | 'busy', x, y, w, h }]`, recorded by the art
 *     with `ctx.zone(kind, box)` in page coordinates. Format-1 art records none.
 *   - `minSize`: the smallest printed text size in the book, or null for a book with no text.
 *   - `pages`: `[{ page, label, archetype, variant, people }]`. A story page describes itself with
 *     `ctx.describePage({ archetype, variant, people })`; a format-1 page has nulls there.
 */
export function composeWithReport(doc, options, template, allowance = {}) {
  const rec = { shown: new Map(), zones: [], kinds: new WeakMap(), pages: new Map() };
  const book = compose(doc, options, template, allowance, rec);
  return { book, report: finishReport(book, rec) };
}

function compose(doc, options, template, allowance, rec) {
  const tpl = validateTemplate(template);
  // A format-2 (storybook) template validates here but has no `pages` to walk. Say so, rather
  // than fail on the loop below, until the story planner (#251) draws it.
  if (tpl.format !== 1) throw new Error(`composeBook: "${tpl.id}" is a format-${tpl.format} storybook template, which this composer cannot draw yet`);
  const now = /^(\d{4})-(\d{2})/.exec(options?.now ?? '');
  if (!now) throw new Error('composeBook: options.now must be an ISO date - the composer never reads the clock');

  const family = readFamily(doc, options, allowance);
  const ctx = context(family, options, tpl, allowance, { year: Number(now[1]), month: Number(now[2]) }, rec);
  const pages = [];
  for (const name of pageBlocks(tpl, options)) {
    for (const page of BLOCKS[name](ctx, pages.length + 1)) {
      pages.push(page);
      ctx.pageNo = pages.length + 1;
    }
  }
  const photos = budgetPhotos(ctx.photos, options?.photoBudget ?? PHOTO_BUDGET);
  // A book declares the lowest format that draws it, so the format is read off the pages rather
  // than written by hand: a book reaches format 2 the day it first clips or reuses something, and
  // never a release before that.
  const book = {
    template: tpl.id,
    title: family.title,
    fileName: fileName(family.title, tpl),
    size: { ...PAGE },
    fonts: { ...tpl.fonts },
    defs: ctx.defs,
    photos,
    pages,
  };
  return { format: formatOf(book), ...book };
}

/**
 * Which of the template's blocks actually get laid out.
 *
 * `options.coverOnly` stops after the first - which `template.js` guarantees is always the cover
 * (`t.pages[0] !== 'cover'` fails validation) - so a caller that only wants a thumbnail never pays
 * for the rest of the book. That matters more than it looks: the desktop recomposes every
 * non-selected template's whole book on every debounced keystroke to draw its cover chip
 * (`desktop/renderer/book.js`), and Android's `drawCovers()` does the same per staged template
 * (`BookViewModel.kt`). At Heirloom's ten-odd pages that was tolerable; at the storybook's
 * twenty-something it is not.
 */
export function pageBlocks(tpl, options) {
  return options?.coverOnly ? [tpl.pages[0]] : tpl.pages;
}

/*
 * What a book's photographs may cost. Android's PdfDocument keeps a bitmap losslessly - roughly
 * 1.8 bytes a pixel once deflated - so a family with a photograph for everyone could otherwise
 * make a book no chat app will carry. Past the budget every portrait comes down together, to no
 * less than 96 pixels, which still prints cleanly at the sizes the pages use. The desktop embeds
 * JPEG and comes in well under it either way.
 */
const PHOTO_BUDGET = 9_000_000;
const LOSSLESS_BYTES_PER_PIXEL = 1.8;

function budgetPhotos(asked, budget) {
  const list = [...asked].map(([id, px]) => ({ id, px })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const cost = (scale) => list.reduce((sum, p) => sum + Math.pow(Math.max(96, Math.round(p.px * scale)), 2) * LOSSLESS_BYTES_PER_PIXEL, 0);
  if (cost(1) <= budget) return list;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (cost(mid) <= budget) lo = mid; else hi = mid; }
  return list.map((p) => ({ id: p.id, px: Math.max(96, Math.round(p.px * lo)) }));
}

/**
 * About how large the PDF will be, for the book screen to say before anyone waits for it:
 * `lossless` for Android's PdfDocument, JPEG otherwise. Fonts and vector pages are a near-constant;
 * photographs are the part that grows.
 */
export function estimateBytes(book, { lossless }) {
  const base = 420_000 + book.pages.length * 18_000;
  const perPixel = lossless ? LOSSLESS_BYTES_PER_PIXEL : 0.22;
  return Math.round(base + book.photos.reduce((sum, p) => sum + p.px * p.px * perPixel, 0));
}

function fileName(title, tpl) {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Family';
  return `${clean} ${tpl.fileSuffix ?? 'Book'}.pdf`;
}

/**
 * The toolkit every block draws through. Blocks never build text or photographs by hand: going
 * through here is what keeps every line measured, every photograph at a size the PDF can afford,
 * and every date within the privacy rule.
 */
function context(family, options, tpl, allowance, now, rec) {
  const P = tpl.palette;
  const metricsOf = (role) => METRICS[tpl.fonts[role]];
  const defs = {};
  const photos = new Map();
  const ctx = {
    family,
    facts: familyFacts(family),
    tpl,
    P,
    options: { photos: options.photos !== false, livingDates: options.livingDates === true, words: options.words === 'hi' ? 'hi' : 'en' },
    // Who the story is told around (`story/featured.js`), resolved once, up front, so every block
    // that will ask "is this the featured person?" (#256-258) asks it the same way. Cheap even when
    // nothing reads it yet: one O(V) pass at most, never `relate()`.
    featured: resolveFeatured(family, options),
    attribution: allowance.attribution !== false,
    now: { ...now, label: `${MONTHS[now.month - 1]} ${now.year}` },
    defs,
    photos,
    pageNo: 1,
    pageOf: new Map(),

    /*
     * The QA report (`composeWithReport`). Each is a no-op when nobody asked for a report, and a
     * Map or array push when somebody did, so a story page can call them for every person and
     * every piece of art it places without costing `composeBook` anything. None of them touches
     * the book: its bytes are the same either way.
     */
    /** This person is named or portrayed on the page being drawn. */
    show(id) {
      if (!rec) return;
      const pages = rec.shown.get(id);
      if (!pages) rec.shown.set(id, [ctx.pageNo]);
      else if (pages[pages.length - 1] !== ctx.pageNo) pages.push(ctx.pageNo);
    },
    /** Art on this page marks a zone: `text` (words may sit here), `face` or `busy` (they may not). */
    zone(kind, { x, y, w, h }) {
      if (rec) rec.zones.push({ page: ctx.pageNo, kind, x, y, w, h });
    },
    /** What this page is: its archetype, the variant it took, and the people it is about. */
    describePage({ archetype = null, variant = null, people = [] } = {}) {
      if (rec) rec.pages.set(ctx.pageNo, { archetype, variant, people: [...people] });
    },

    measure: (s, role, size) => measure(s, metricsOf(role), size),
    fit: (s, role, size, width, min) => fitSize(s, metricsOf(role), size, width, min),

    /** One line, carrying the width it was measured to fit so a painter can hold it there. */
    line(x, y, s, role, size, fill, { align = 'start', width, op, kind } = {}) {
      const w = width ?? measure(s, metricsOf(role), size);
      return said(text(x, y, s, role, size, fill, { align, w, op }), kind);
    },

    /** A paragraph broken into lines. Returns the items and where the next line would go. */
    lines(x, y, s, role, size, fill, { width, maxLines, lead = size * 1.35, align = 'start', op, kind } = {}) {
      const broken = breakLines(s, metricsOf(role), size, width, maxLines);
      const items = broken.map((l, i) => said(text(x, y + i * lead, l, role, size, fill, { align, w: width, op }), kind));
      return { items, bottom: y + (broken.length - 1) * lead, count: broken.length };
    },

    gradient(id, def) {
      defs[id] = def;
      return { ref: id };
    },

    /**
     * A person's portrait: their photograph when they have one and photographs are wanted, their
     * initial on a ground coloured by gender otherwise, and the dashed ring when nobody recorded
     * their name. The resolution is decided here, from the size the portrait prints at: about
     * 170 pixels an inch, never under 96 or over 200, which is what a family's PDF can carry.
     */
    portrait(p, cx, cy, r, { ring = P.gold, unknownRing = P.goldSoft } = {}) {
      ctx.show(p.id);
      const items = [];
      if (p.photo && ctx.options.photos) {
        const px = Math.min(200, Math.max(96, Math.ceil(((2 * r) / 72) * 170)));
        photos.set(p.id, Math.max(photos.get(p.id) ?? 0, px));
        items.push(image(p.id, cx - r, cy - r, 2 * r, 2 * r, 'circle'));
      } else if (p.name) {
        const ground = p.gender === 'FEMALE' ? P.female : p.gender === 'MALE' ? P.male : P.other;
        items.push(circle(cx, cy, r, { fill: ground }));
        const initial = Array.from(p.name.trim())[0];
        items.push(text(cx, cy + r * 0.38, initial, 'display', r * 1.1, P.ink, { align: 'middle', w: r * 1.6, op: 0.8 }));
      }
      items.push(p.name
        ? circle(cx, cy, r + Math.max(1.5, r * 0.07), { stroke: ring, sw: Math.max(0.6, r * 0.025) })
        : circle(cx, cy, r, { stroke: unknownRing, sw: Math.max(0.8, r * 0.035), dash: [Math.max(2, r * 0.1), Math.max(1.6, r * 0.08)] }));
      return items;
    },

    /** The quiet line at the foot of an interior page. */
    footer(ink) {
      const items = [text(PAGE.w - 40, PAGE.h - 22, String(ctx.pageNo), 'text', 7.5, ink, { align: 'end', w: 30, op: 0.85 })];
      if (ctx.attribution) items.push(text(40, PAGE.h - 22, 'Made with f-tree', 'text', 7, ink, { w: 120, op: 0.75 }));
      return items;
    },

    page(label, items, ground) {
      return { label, items: ground ? [rect(0, 0, PAGE.w, PAGE.h, { fill: ground }), ...items] : items };
    },
  };
  /** Remembers what kind of line a text item is, for the report only. */
  const said = (item, kind) => {
    if (rec && kind) rec.kinds.set(item, kind);
    return item;
  };
  return ctx;
}

/*
 * A text line's ink band, as fractions of its size: from the baseline up to about the top of a
 * capital or a Devanagari headline, and down past the baseline for descenders. Deliberately a
 * little generous, so two lines that print touching are reported as touching.
 */
const INK_ABOVE = 0.75;
const INK_BELOW = 0.2;

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * The part of the report a finished book carries on its own: its text boxes, its smallest size and
 * its page list. Nobody recorded anything while it was drawn, so `shown` and `artZones` are empty.
 */
export function reportFromBook(book) {
  return finishReport(book, { shown: new Map(), zones: [], kinds: new WeakMap(), pages: new Map() });
}

function finishReport(book, rec) {
  const textBoxes = [];
  let minSize = null;
  const walk = (items, m, page) => {
    for (const it of items) {
      if (it.t === 'group') walk(it.items, it.tf ? mul(m, it.tf) : m, page);
      if (it.t !== 'text') continue;   // symbols hold no text (format.js), so a `use` is never walked
      // The width it prints at: what the advance tables measure, never more than the width the
      // composer gave it (a painter shrinks a line to that, format.js). `w` alone is often a whole
      // column, for a line centred in it.
      const measured = measure(it.s, METRICS[book.fonts[it.font]], it.size);
      const w = it.w === undefined ? measured : Math.min(measured, it.w);
      const x0 = it.align === 'middle' ? it.x - w / 2 : it.align === 'end' ? it.x - w : it.x;
      const corners = [[x0, it.y - it.size * INK_ABOVE], [x0 + w, it.y - it.size * INK_ABOVE], [x0, it.y + it.size * INK_BELOW], [x0 + w, it.y + it.size * INK_BELOW]]
        .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      const size = it.size * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      minSize = minSize === null ? size : Math.min(minSize, size);
      textBoxes.push({
        page, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
        size, font: it.font, kind: rec.kinds.get(it) ?? null, op: it.op ?? 1, s: it.s,
      });
    }
  };
  book.pages.forEach((p, i) => walk(p.items, [1, 0, 0, 1, 0, 0], i + 1));
  return {
    shown: Object.fromEntries([...rec.shown].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    textBoxes,
    artZones: rec.zones,
    minSize,
    pages: book.pages.map((p, i) => ({ page: i + 1, label: p.label, archetype: null, variant: null, people: [], ...rec.pages.get(i + 1) })),
  };
}
