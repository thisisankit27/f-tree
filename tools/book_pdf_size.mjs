/*
 * Measures what paper-cut art costs in a printed PDF, for `estimateBytes`' vector-art term (#245).
 *
 *   FTREE_PLAYWRIGHT=/path/to/playwright/index.mjs node tools/book_pdf_size.mjs [out-dir]
 *
 * Not run in CI. It prints a table, and writes `<out-dir>/book-pdf-size.json` with every number and
 * `<out-dir>/books/*.json` with every Book it printed (for measuring Android, #246). The method and
 * results are written up in docs/family-book.md ("What a PDF weighs"), and the numbers the tests
 * hold `ART_PDF` to are copied into site/book/qa/pdf-size.json.
 *
 * The samples are the most paper-cut-heavy format-2 Books that exist before the story pages do:
 *   - the six approved style frames and the design-system sheet (site/book/art/style-frames), drawn
 *     by their own kit and converted, item for item, into Book format 2 below - symbols stay
 *     symbols, clips stay clips, gradients stay gradients - and checked with `validateBook`;
 *   - the format-2 conformance book (site/book/golden/format2-conformance.json);
 *   - calibration pages, each loaded with mostly one kind of cost;
 *   - a storybook-density book: 28 pages cycling through the frames in story order, the page count
 *     the plan budgets for a family of about 200.
 *
 * For each page it prints the page as it is, and the same page with every drawing removed and only
 * its text left, through Chromium exactly as the desktop does (tools/book_print.mjs). The
 * difference is what the art costs in the PDF. That is fitted to `artStats(book)` (compose.js: the
 * art's bytes, translucent shapes, layers, gradients and clips, every `use` expanded), which is what
 * `estimateBytes` can see without printing anything, and the fit is scaled up to cover the samples.
 */

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBook, formatOf } from '../site/book/format.js';
import { paintPage } from '../site/book/svg.js';
import { measure } from '../site/book/text.js';
import { METRICS } from '../site/book/metrics/index.js';
import { artStats, estimateBytes } from '../site/book/compose.js';
import { loadPlaywright, printPdf } from './book_print.mjs';
import { cutShape, ellipsePts } from '../site/book/art/style-frames/kit.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// The style frames' SVG, read back into Book format 2.
//
// The kit (kit.mjs) writes a small, regular subset of SVG: <g> with a matrix, an opacity and a
// clip-path; <path>, <circle>, <rect>, <text>; <use href> of a <g id> in <defs>; user-space linear
// and radial gradients; and a path's `transform="translate()"` for a paper shadow. Every one of
// those has a Book equivalent, so this reads them one for one and refuses anything else.

const ATTR = /([a-zA-Z][a-zA-Z0-9:-]*)="([^"]*)"/g;
const TAG = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z][a-zA-Z0-9:-]*="[^"]*")*)\s*(\/?)>|([^<]+)/g;

function parseSvg(src) {
  const root = { name: '#root', attrs: {}, kids: [] };
  const stack = [root];
  for (const m of src.matchAll(TAG)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { if (m[5].trim()) top.kids.push({ name: '#text', text: m[5] }); continue; }
    if (m[1]) { stack.pop(); continue; }
    const node = { name: m[2], attrs: Object.fromEntries([...m[3].matchAll(ATTR)].map((a) => [a[1], a[2]])), kids: [] };
    top.kids.push(node);
    if (!m[4]) stack.push(node);
  }
  return root.kids[0];
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const num = (v) => Number(v);
const r2 = (n) => Math.round(n * 100) / 100;
/** The kit's ids may hold a dot (`cv-leaf-1-0.16`); a Book id may not. */
const bookId = (id) => id.replace(/[^A-Za-z0-9_-]/g, '_');

function tfOf(v) {
  if (!v) return undefined;
  let m = /^matrix\(([^)]*)\)$/.exec(v);
  if (m) return m[1].trim().split(/[\s,]+/).map(Number);
  m = /^translate\(([^)]*)\)$/.exec(v);
  if (m) { const [x, y = 0] = m[1].trim().split(/[\s,]+/).map(Number); return [1, 0, 0, 1, x, y]; }
  throw new Error(`unknown transform ${v}`);
}

function convert(svg, id) {
  const defs = {};
  const clips = {};
  const symbols = {};
  const ref = (v) => /^url\(#(.+)\)$/.exec(v)?.[1];
  const colour = (v) => (v === undefined || v === 'none' ? undefined : ref(v) ? { ref: ref(v) } : v.toLowerCase());
  const paint = (a, o) => {
    const fill = colour(a.fill);
    if (fill !== undefined) o.fill = fill;
    if (a.stroke && a.stroke !== 'none') { o.stroke = a.stroke.toLowerCase(); o.sw = r2(num(a['stroke-width'] ?? 1)); }
    if (a['stroke-dasharray']) o.dash = a['stroke-dasharray'].split(/[\s,]+/).map(Number);
    if (a['stroke-linecap']) o.cap = a['stroke-linecap'];
    if (a['stroke-linejoin']) o.join = a['stroke-linejoin'];
    if (a['fill-rule'] === 'evenodd') o.rule = 'evenodd';
    if (a.opacity !== undefined && num(a.opacity) < 1) o.op = r2(num(a.opacity));
    return o;
  };
  const withTf = (a, item) => (a.transform ? { t: 'group', tf: tfOf(a.transform), items: [item] } : item);

  function item(n, inSymbol) {
    const a = n.attrs;
    switch (n.name) {
      case 'path': return withTf(a, paint(a, { t: 'path', d: a.d }));
      case 'circle': return withTf(a, paint(a, { t: 'circle', cx: num(a.cx), cy: num(a.cy), r: num(a.r) }));
      case 'rect': return withTf(a, paint(a, { t: 'rect', x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height), ...(a.rx ? { r: num(a.rx) } : {}) }));
      case 'g': {
        const g = { t: 'group', items: n.kids.map((k) => item(k, inSymbol)).filter(Boolean) };
        if (a.transform) g.tf = tfOf(a.transform);
        if (a['clip-path']) g.clip = clips[ref(a['clip-path'])];
        if (a.opacity !== undefined && num(a.opacity) < 1) g.op = r2(num(a.opacity));
        return g;
      }
      case 'use': {
        const u = { t: 'use', ref: bookId(a.href.slice(1)) };
        if (a.transform) u.tf = tfOf(a.transform);
        if (a.opacity !== undefined && num(a.opacity) < 1) u.op = r2(num(a.opacity));
        return u;
      }
      case 'text': {
        if (inSymbol) throw new Error(`${id}: text inside a symbol`);
        const s = unesc(n.kids.map((k) => k.text ?? '').join(''));
        const font = a['font-family'].replace(/^book_/, '');
        const size = num(a['font-size']);
        const o = { t: 'text', x: num(a.x), y: num(a.y), s, font, size, fill: a.fill.toLowerCase() };
        if (a['text-anchor'] === 'middle' || a['text-anchor'] === 'end') o.align = a['text-anchor'];
        o.w = r2(measure(s, METRICS[`book_${font}`], size));
        if (a.opacity !== undefined && num(a.opacity) < 1) o.op = r2(num(a.opacity));
        return o;
      }
      case 'image': return null;   // stand-in photographs only; frames are rendered without them
      default: throw new Error(`${id}: <${n.name}> has no Book equivalent`);
    }
  }

  const defsNode = svg.kids.find((k) => k.name === 'defs');
  for (const d of defsNode?.kids ?? []) {
    const stops = () => d.kids.filter((k) => k.name === 'stop').map((s) => [num(s.attrs.offset), s.attrs['stop-color'].toLowerCase(), num(s.attrs['stop-opacity'] ?? 1)]);
    if (d.name === 'linearGradient') defs[d.attrs.id] = { type: 'linear', x1: num(d.attrs.x1), y1: num(d.attrs.y1), x2: num(d.attrs.x2), y2: num(d.attrs.y2), stops: stops() };
    else if (d.name === 'radialGradient') defs[d.attrs.id] = { type: 'radial', cx: num(d.attrs.cx), cy: num(d.attrs.cy), r: num(d.attrs.r), stops: stops() };
    else if (d.name === 'clipPath') clips[d.attrs.id] = d.kids[0].attrs.d;
  }
  // Symbols after gradients and clips, which they may name.
  for (const d of defsNode?.kids ?? []) if (d.name === 'g') symbols[bookId(d.attrs.id)] = { items: d.kids.map((k) => item(k, true)).filter(Boolean) };
  const items = svg.kids.filter((k) => k.name !== 'defs').map((k) => item(k, false)).filter(Boolean);
  return { defs, symbols, items };
}

/** One Book from pages drawn by the kit: every page's defs and symbols merged (their ids are page-prefixed). */
function bookOf(name, framePages) {
  const book = { format: 2, template: 'measure', title: name, fileName: `${name}.pdf`, size: { w: 595, h: 842 },
    fonts: { display: 'book_display', text: 'book_text', strong: 'book_strong', hand: 'book_hand' }, defs: {}, symbols: {}, photos: [], pages: [] };
  for (const [label, f] of framePages) {
    Object.assign(book.defs, f.defs);
    Object.assign(book.symbols, f.symbols);
    book.pages.push({ label, items: f.items });
  }
  if (!Object.keys(book.symbols).length) delete book.symbols;
  book.format = formatOf(book);
  const problems = validateBook(book);
  if (problems.length) throw new Error(`${name} is not a valid Book:\n  ${problems.slice(0, 10).join('\n  ')}`);
  return book;
}

/** The same page with every drawing gone and its text left where it was, through its groups. */
function textOnly(items) {
  const out = [];
  for (const it of items) {
    if (it.t === 'text') out.push(it);
    else if (it.t === 'group') {
      const inner = textOnly(it.items);
      if (inner.length) out.push({ t: 'group', items: inner, ...(it.tf ? { tf: it.tf } : {}) });
    }
  }
  return out;
}

const svgsOf = (book) => book.pages.map((_, i) => paintPage(book, i, { photo: () => null, font: (k) => k, idPrefix: `p${i}-` }));

function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// ---------------------------------------------------------------------------------------------

const out = path.resolve(process.argv[2] ?? mkdtempSync(path.join(os.tmpdir(), 'book-pdf-size-')));
mkdirSync(out, { recursive: true });
const frameDir = path.join(out, 'frames');
mkdirSync(frameDir, { recursive: true });
execFileSync(process.execPath, [path.join(repo, 'site/book/art/style-frames/frames.mjs'), frameDir], { stdio: 'ignore' });

const FRAMES = ['cover', 'opening', 'courtyards', 'lane', 'register', 'remembrance', 'system'];
const frames = Object.fromEntries(FRAMES.map((f) => [f, convert(parseSvg(readFileSync(path.join(frameDir, `${f}.svg`), 'utf8')), f)]));

const conformance = JSON.parse(readFileSync(path.join(repo, 'site/book/golden/format2-conformance.json'), 'utf8'));
// Story order, repeated to the plan's ~28 pages for a family of ~200: cover, then the chapters,
// the register and remembrance, closing on the system sheet as the richest page there is.
const STORY = ['cover', 'opening', 'courtyards', 'courtyards', 'lane', 'lane', 'lane', 'opening', 'courtyards', 'lane',
  'opening', 'courtyards', 'lane', 'lane', 'opening', 'courtyards', 'lane', 'system', 'register', 'register', 'register',
  'register', 'remembrance', 'remembrance', 'opening', 'lane', 'remembrance', 'cover'];

/*
 * Calibration pages, each loaded with mostly one kind of cost, so the fit below can tell a byte of
 * path from a gradient from a layer: hand-cut paper shapes (the kit's own cutShape), gradient fills
 * with translucent stops (a glow), and dimmed uses and clips (paper shadows, windows).
 */
function calibration() {
  const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const P = ['#e9dcc0', '#7a3e63', '#b5562a', '#2a1a33', '#f2b84b', '#3a7d6b'];
  const shape = (i, s = 1) => cutShape(ellipsePts(40 + (i * 53) % 515, 60 + (i * 97) % 720, 18 * s + (i % 5) * 4, 12 * s + (i % 3) * 5, 18, i), 2.5, `cal${i}`, 5);
  const book = (name, pages, extra = {}) => bookOf(name, pages.map((items, i) => [`${name} ${i + 1}`, { defs: extra.defs ?? {}, symbols: extra.symbols ?? {}, items }]));
  const defs = Object.fromEntries(seq(80, (i) => [`glow${i}`, { type: 'radial', cx: 40 + (i * 53) % 515, cy: 60 + (i * 97) % 720, r: 30, stops: [[0, '#f2b84b', 0.7], [1, '#f2b84b', 0]] }]));
  const symbols = { leaf: { items: [{ t: 'path', d: shape(3, 0.5), fill: '#3a7d6b' }, { t: 'path', d: 'M0 0 L10 10', stroke: '#2a1a33', sw: 0.6 }] } };
  return [
    ['cal:paths', book('cal-paths', [seq(400, (i) => ({ t: 'path', d: shape(i), fill: P[i % 6] }))])],
    ['cal:dimmed', book('cal-dimmed', [seq(400, (i) => ({ t: 'path', d: shape(i), fill: P[i % 6], op: 0.2 + (i % 7) / 10 }))])],
    ['cal:shadows', book('cal-shadows', [seq(400, (i) => ({ t: 'group', tf: [1, 0, 0, 1, 1.7, 2.3], items: [{ t: 'path', d: shape(i), fill: '#2a1a33', op: 0.22 }] }))])],
    ['cal:gradients', book('cal-gradients', [seq(80, (i) => ({ t: 'circle', cx: defs[`glow${i}`].cx, cy: defs[`glow${i}`].cy, r: 30, fill: { ref: `glow${i}` } }))], { defs })],
    ['cal:layers', book('cal-layers', [[
      ...seq(160, (i) => ({ t: 'use', ref: 'leaf', tf: [1, 0, 0, 1, 20 + (i * 37) % 540, 30 + (i * 71) % 780], fill: '#2a1a33', op: 0.3 })),
      ...seq(40, (i) => ({ t: 'group', clip: `M${(i * 13) % 500} ${(i * 19) % 700} H${(i * 13) % 500 + 60} V${(i * 19) % 700 + 80} H${(i * 13) % 500} Z`, items: [{ t: 'use', ref: 'leaf', tf: [2, 0, 0, 2, (i * 13) % 500 + 20, (i * 19) % 700 + 20] }] })),
    ]], { symbols })],
  ];
}

/** Least squares on relative error, coefficients held non-negative by trying every subset. */
function fit(rows, keys) {
  let best = null;
  for (let mask = 1; mask < 1 << keys.length; mask++) {
    const ks = keys.filter((_, i) => mask & (1 << i));
    // Weighted by 1/y^2: relative error, so a 9 KB page counts as much as a 900 KB one.
    const A = ks.map((a) => ks.map((b) => rows.reduce((s, r) => s + (r[a] * r[b]) / r.artPdf ** 2, 0)));
    const y = ks.map((a) => rows.reduce((s, r) => s + (r[a] * r.artPdf) / r.artPdf ** 2, 0));
    const x = solve(A, y);
    if (!x || x.some((v) => !(v >= 0))) continue;
    const coef = Object.fromEntries(keys.map((k) => [k, 0]));
    ks.forEach((k, i) => { coef[k] = x[i]; });
    const err = rows.reduce((s, r) => s + ((r.artPdf - keys.reduce((t, k) => t + coef[k] * r[k], 0)) / r.artPdf) ** 2, 0);
    if (!best || err < best.err) best = { coef, err };
  }
  return best.coef;
}

function solve(A, y) {
  const n = y.length, M = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const rows = [];
try {
  const blank = (await printPdf(browser, ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595pt" height="842pt"></svg>'])).length;
  const samples = [
    ...FRAMES.map((f) => [`frame:${f}`, bookOf(f, [[f, frames[f]]])]),
    ...conformance.pages.map((p, i) => [`conformance:${i + 1}`, { ...conformance, pages: [p] }]),
    ...calibration(),
  ];
  // The Books themselves, for measuring the same pages on Android's PdfDocument (#246, #259).
  mkdirSync(path.join(out, 'books'), { recursive: true });
  for (const [name, book] of samples) {
    writeFileSync(path.join(out, 'books', `${name.replace(':', '-')}.json`), JSON.stringify(book));
    const full = (await printPdf(browser, svgsOf(book))).length;
    const bare = { ...book, pages: book.pages.map((p) => ({ ...p, items: textOnly(p.items) })) };
    const text = (await printPdf(browser, svgsOf(bare))).length;
    rows.push({ name, pdf: full, textOnly: text, artPdf: full - text, ...artStats(book), json: JSON.stringify(book).length });
  }

  // The model, fitted to every sample, then scaled so it covers them: by the 95th percentile of
  // measured / predicted, and a quarter again on top. Estimating high is the point (#245).
  const KEYS = ['bytes', 'translucent', 'layers', 'gradients', 'clips'];
  const fitted = fit(rows, KEYS);
  const predict = (r, c) => KEYS.reduce((t, k) => t + c[k] * r[k], 0);
  // A page whose art prints smaller than PAGE_ALLOWANCE is already paid for by estimateBytes'
  // per-page constant, so the margin is set on the pages where the art term is what matters.
  const PAGE_ALLOWANCE = 18_000;
  const ratios = rows.filter((r) => r.artPdf >= PAGE_ALLOWANCE).map((r) => r.artPdf / predict(r, fitted));
  const scale = quantile(ratios, 0.95) * 1.25;
  const chosen = Object.fromEntries(KEYS.map((k) => [k, fitted[k] * scale]));
  for (const r of rows) {
    r.predicted = Math.round(predict(r, chosen));
    // Covered: what the estimate allows this page's art (the term plus the per-page constant) over
    // what it actually cost.
    r.cover = (r.predicted + PAGE_ALLOWANCE) / r.artPdf;
  }

  const story = bookOf('storybook-density', STORY.map((f, i) => [`${f} ${i + 1}`, frames[f]]));
  writeFileSync(path.join(out, 'books', 'storybook-density.json'), JSON.stringify(story));
  const storyPdf = (await printPdf(browser, svgsOf(story))).length;
  const storyArt = artStats(story);
  const result = {
    chromium: browser.version(),
    method: 'art in PDF = pdf(page) - pdf(same page, text only); Chromium page.pdf, A4, printBackground, preferCSSPageSize. '
      + 'Fitted art ~ sum of artStats features x coefficients, by non-negative least squares on relative error over every sample, then scaled by p95(measured/fitted over pages whose art is >= 18 KB) x 1.25. covered = (term + 18 KB per-page constant) / measured art.',
    blankPagePdf: blank,
    rows,
    fitted,
    scale,
    chosen,
    storybook: { pages: story.pages.length, json: JSON.stringify(story).length, ...storyArt, pdf: storyPdf,
      predictedArt: Math.round(predict(storyArt, chosen)), estimateJpeg: estimateBytes(story, { lossless: false }) },
  };
  writeFileSync(path.join(out, 'book-pdf-size.json'), JSON.stringify(result, null, 1));

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`.padStart(10);
  console.log(`Chromium ${result.chromium}; a blank page prints to ${kb(blank)}\n`);
  console.log(`${'sample'.padEnd(18)}${'PDF'.padStart(10)}${'text only'.padStart(10)}${'art in PDF'.padStart(11)}${'art JSON'.padStart(10)}${'translucent'.padStart(12)}${'layers'.padStart(7)}${'gradients'.padStart(10)}${'clips'.padStart(6)}${'term'.padStart(11)}${'covered'.padStart(9)}`);
  for (const r of rows) console.log(`${r.name.padEnd(18)}${kb(r.pdf)}${kb(r.textOnly)} ${kb(r.artPdf)}${kb(r.bytes)}${String(r.translucent).padStart(12)}${String(r.layers).padStart(7)}${String(r.gradients).padStart(10)}${String(r.clips).padStart(6)} ${kb(r.predicted)}${r.cover.toFixed(2).padStart(9)}`);
  const f = (c) => `${c.bytes.toFixed(3)} a byte, ${c.translucent.toFixed(0)} a translucent shape, ${c.layers.toFixed(0)} a layer, ${c.gradients.toFixed(0)} a gradient, ${c.clips.toFixed(0)} a clip`;
  console.log(`\nfitted: ${f(fitted)}\nscaled by p95(real/fitted, pages with >= 18 KB of art) x 1.25 = ${scale.toFixed(3)}: ${f(chosen)}`);
  const s = result.storybook;
  console.log(`storybook density: ${s.pages} pages, JSON ${kb(s.json)}, art JSON ${kb(s.bytes)}, PDF ${kb(s.pdf)}; the art term predicts ${kb(s.predictedArt)}, estimateBytes ${kb(s.estimateJpeg)}`);
  console.log(`\n${path.join(out, 'book-pdf-size.json')}`);
} finally {
  await browser.close();
}
