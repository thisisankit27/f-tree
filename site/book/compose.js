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
import { readFamily, familyFacts, byKey } from './family.js';
import { validateTemplate } from './template.js';
import { METRICS } from './metrics/index.js';
import { resolveFeatured } from './story/featured.js';
import { kinOf } from './story/kin.js';
import { planStory } from './story/plan.js';
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
 *   - `pages`: `[{ page, label, archetype, variant, people, density }]`. A story page describes
 *     itself with `ctx.describePage(...)`; a format-1 page has nulls there.
 */
export function composeWithReport(doc, options, template, allowance = {}) {
  const rec = recorder();
  const book = compose(doc, options, template, allowance, rec);
  return { book, report: finishReport(book, rec) };
}

/**
 * The template formats this composer can draw. A format-2 (storybook) template validates, and
 * `storyBook` plans its pages (#251), but nothing draws them until the archetypes (#256-#258)
 * land; the QA harness asks `drawable`
 * rather than matching the error, so it picks the storybook up the day this list grows.
 */
export const DRAWABLE_FORMATS = Object.freeze([1]);
export const drawable = (template) => DRAWABLE_FORMATS.includes(validateTemplate(template).format);

function compose(doc, options, template, allowance, rec) {
  const tpl = validateTemplate(template);
  const now = /^(\d{4})-(\d{2})/.exec(options?.now ?? '');
  if (!now) throw new Error('composeBook: options.now must be an ISO date - the composer never reads the clock');

  const family = readFamily(doc, options, allowance);
  const ctx = context(family, options, tpl, allowance, { year: Number(now[1]), month: Number(now[2]) }, rec);
  if (tpl.format === 2) return storyBook(ctx);
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
 * A format-2 (storybook) template's book: the featured person's circles (`story/kin.js`), then
 * every page planned and numbered (`story/plan.js`) before any is drawn.
 *
 * A stub until the page archetypes land (#256-#258): it plans the whole book, then refuses, by
 * name, to draw it. `DRAWABLE_FORMATS` stays [1] until then, so `drawable()` and the QA harness
 * keep treating the storybook as not yet drawable - and invariants.test.mjs's flag test fails the
 * day format 2 is added there without a template for the suite to run over.
 */
function storyBook(ctx) {
  const kin = kinOf(ctx.family, ctx.featured, { words: ctx.options.words });
  const plan = planStory(kin, ctx.tpl, ctx.family);
  throw new Error(`composeBook: "${ctx.tpl.id}" is a format-2 storybook template: its ${plan.pages.length} pages are planned, but their archetypes are not built yet (#256-#258), so this composer cannot draw them`);
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
export const BASE_BYTES = 420_000;
export const PAGE_BYTES = 18_000;

export function estimateBytes(book, { lossless }) {
  const base = BASE_BYTES + book.pages.length * PAGE_BYTES;
  const perPixel = lossless ? LOSSLESS_BYTES_PER_PIXEL : 0.22;
  const art = book.format >= 2 ? Math.ceil(artTerm(artStats(book))) : 0;
  return Math.round(base + art + book.photos.reduce((sum, p) => sum + p.px * p.px * perPixel, 0));
}

/*
 * What paper-cut art adds to a PDF, per thing `artStats` counts. Measured, not guessed (#245):
 * tools/book_pdf_size.mjs prints the approved style frames, the format-2 conformance book and some
 * calibration pages through Chromium as the desktop does, with and without their drawings, and
 * fits the difference to these five counts. The fit is then scaled by its own 95th-percentile
 * under-estimate and a quarter again (x 1.95 in all), and rounded up, so the estimate errs toward
 * "too big": on every page measured it allows at least 1.40 times what the art really cost. The
 * measurements are in qa/pdf-size.json and docs/family-book.md, and estimate.test.mjs fails if a
 * constant here drops below what they need. A layer measured as free: its cost is in what it holds.
 *
 * Format-1 books keep the old estimate, whose per-page constant already covers their starfields.
 * Android's PdfDocument cannot draw format 2 until #246: #246 and #259 must measure it there too
 * and raise these if Android writes more.
 */
export const ART_PDF = Object.freeze({ bytes: 0.75, translucent: 1050, layers: 0, gradients: 5800, clips: 1600 });
/** What `artStats` counts, priced by a set of coefficients: `ART_PDF` unless measuring new ones. */
export const artTerm = (stats, coef = ART_PDF) => Object.keys(coef).reduce((sum, k) => sum + stats[k] * coef[k], 0);

/**
 * What a book's art is made of, counted the way a painter writes it into a PDF: every `use`
 * expanded, because a symbol drawn forty times is forty copies of its paths there.
 *   - `bytes`: every path's data, plus ITEM_BYTES for each shape, group and use drawn (words and
 *     photographs left out) - what a content stream mostly is;
 *   - `translucent`: shapes with an opacity - a paper shadow is one - each its own graphics state;
 *   - `layers`: groups and uses with an opacity, each composited once as a transparency group;
 *   - `gradients`: items painted with a gradient, each a shading (and, with translucent stops, a
 *     soft mask) of its own;
 *   - `clips`: clipped groups.
 * Each symbol is counted once and multiplied by its uses, so this is linear in the book's size.
 */
const ITEM_BYTES = 40;   // an item's own paint, position and transform, roughly

export function artStats(book) {
  const symbols = book.symbols ?? {};
  const memo = new Map();
  const zero = () => ({ bytes: 0, translucent: 0, layers: 0, gradients: 0, clips: 0 });
  const add = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k]; };
  const symbolStats = (ref) => {
    if (!memo.has(ref)) {
      memo.set(ref, zero());   // a cycle adds nothing; validateBook refuses one anyway
      memo.set(ref, stats(Object.hasOwn(symbols, ref) ? symbols[ref].items : []));
    }
    return memo.get(ref);
  };
  const stats = (items) => {
    const n = zero();
    for (const it of items) {
      if (it.t === 'text' || it.t === 'image') continue;
      if (it.t === 'group' || it.t === 'use') {
        add(n, it.t === 'group' ? stats(it.items) : symbolStats(it.ref));
        n.bytes += ITEM_BYTES + (it.clip ? it.clip.length : 0);
        if (it.clip !== undefined) n.clips++;
        if (it.op !== undefined) n.layers++;
      } else {
        n.bytes += ITEM_BYTES + (it.d ? it.d.length : 0);
        if (typeof it.fill === 'object' || typeof it.stroke === 'object') n.gradients++;
        if (it.op !== undefined) n.translucent++;
      }
    }
    return n;
  };
  const total = zero();
  for (const p of book.pages) add(total, stats(p.items));
  return total;
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
    /**
     * What this page is: its archetype, the variant it took (its art placement), the people it is
     * about, and which of the design system's density rows limits it - 'hero' (1-2 people),
     * 'family' (8), 'gathering' (12), 'lane' (4 houses of 8) or 'register' (48 rows).
     */
    describePage(info = {}) {
      if (rec) rec.pages.set(ctx.pageNo, { ...PAGE_INFO, ...info, people: [...(info.people ?? [])] });
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
  return finishReport(book, recorder());
}

/** Where `ctx` puts what a report needs while the book is drawn. */
const recorder = () => ({ shown: new Map(), zones: [], kinds: new WeakMap(), pages: new Map() });

/** What `ctx.describePage` records, and what a page that never called it reports. */
const PAGE_INFO = Object.freeze({ archetype: null, variant: null, people: [], density: null });

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
    shown: Object.fromEntries([...rec.shown].sort(([a], [b]) => byKey(a, b))),
    textBoxes,
    artZones: rec.zones,
    minSize,
    pages: book.pages.map((p, i) => ({ page: i + 1, label: p.label, ...(rec.pages.get(i + 1) ?? PAGE_INFO) })),
  };
}
