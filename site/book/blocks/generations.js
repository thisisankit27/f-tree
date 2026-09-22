/*
 * A page for every generation - or rather, generations that flow like a book's chapters.
 *
 * A generation of three would leave most of an A4 page empty, and a family of seven generations
 * would become seven sparse pages; so a generation begins wherever the last one ended if its
 * heading and two rows fit, and runs on to a new page, headed "continued", when it does not.
 * Portraits grow as a generation shrinks: two people get large ones, forty get small ones, and
 * every page stays full.
 *
 * Every person lands on exactly one page, and that page is recorded for "Find yourself".
 */

import { PAGE, rect, path, PathData } from '../format.js';
import { sparkleData, lamp } from './art.js';
import { lifeLine } from '../family.js';
import { generationName, ROMAN, firstName, andList } from './words.js';

const { w: W, h: H } = PAGE;
const TOP = 60, BOTTOM = H - 48, SIDE = 44;

/**
 * How big each portrait is, from how many share the generation. A small generation sits on one
 * row, so three or four of them can share a page; a large one packs five to a row.
 */
function density(n) {
  if (n <= 2) return { cols: 2, r: 44, name: 14 };
  if (n <= 4) return { cols: n, r: 34, name: 12.5 };
  if (n <= 8) return { cols: 4, r: 30, name: 11.5 };
  return { cols: 5, r: 23, name: 10 };
}
/*
 * A row is exactly as tall as the fullest card in it can be: the portrait, two lines of name, the
 * dates and the relation line (see card()), plus the gap between rows. Deriving it from the card's
 * own spacing is what keeps a two-line name inside its card at every density.
 */
const rowHeight = (d) => d.r * 2 + d.name * 5.05 + 40;

export function generationPages(ctx) {
  const { family, P } = ctx;
  const sections = [];
  for (let g = 0; g < family.generations; g++) {
    const people = family.people.filter((p) => p.gen === g).sort((a, b) => a.x - b.x || a.order - b.order);
    if (people.length) sections.push({ title: generationName(g), numeral: ROMAN[g], people, g });
  }
  if (family.elsewhere.length) {
    // With no joined family at all there is nothing for these people to be "also" beside.
    const alone = !sections.length;
    sections.push({
      title: alone ? 'The family' : 'Also in the family',
      note: alone ? 'Nobody here is linked to anybody else yet.' : 'Recorded without a link to the rest of the tree yet.',
      people: [...family.elsewhere].sort((a, b) => a.order - b.order),
    });
  }

  const pages = [];
  let items = null, y = 0, numeral = null;
  const startPage = () => {
    items = [];
    numeral = null;
    y = TOP;
  };
  /** `closing`: the page ends because a generation did, not part-way through one. */
  const endPage = (closing = true) => {
    if (!items) return;
    // A chapter that ends high on its page closes with a tailpiece, as a printed book's would, so
    // the space beneath reads as a pause rather than as something missing.
    if (closing && BOTTOM - y > 150) tailpiece(ctx, items, y + 22);
    if (numeral) items.unshift(ctx.line(W - 40, 118, numeral, 'display', 120, P.gold, { align: 'end', op: 0.2, kind: 'ornament' }));
    items.push(...ctx.footer(P.inkSoft));
    pages.push(ctx.page(pages.length ? 'Generations, continued' : 'Generations', items, P.paper));
    ctx.pageNo += 1;
    items = null;
  };

  startPage();
  sections.forEach((s, i) => {
    let f = shape(s);
    if (breaksBefore(y, f)) { endPage(); startPage(); }
    // A generation with a page to itself - it opens the page and the next will not share it - is
    // given the largest portraits that page has room for, rather than small ones and a bare foot.
    if (y === TOP && TOP + f.whole <= BOTTOM) {
      const next = sections[i + 1];
      if (!next || breaksBefore(TOP + f.whole + 18, shape(next))) f = grown(s, f);
    }
    const { d, rh, heading } = f;
    if (s.numeral && !numeral) numeral = s.numeral;
    header(ctx, items, s.title, subtitle(s), y);
    y += heading;

    for (let j = 0; j < s.people.length; j += d.cols) {
      if (y + rh > BOTTOM) {
        endPage(false); startPage();
        if (s.numeral) numeral = s.numeral;
        header(ctx, items, `${s.title}, continued`, null, y, 24);
        y += 52;
      }
      const row = s.people.slice(j, j + d.cols);
      row.forEach((p, k) => card(ctx, items, p, d, rowX(row.length, d.cols, k), y, rh));
      y += rh;
    }
    y += 18;
  });
  endPage();
  return pages;
}

/** A short gold rule broken by the template's own mark: three stars, or a lamp. */
function tailpiece(ctx, items, y) {
  const { P } = ctx;
  const cx = W / 2;
  items.push(path(String(new PathData().M(cx - 80, y).L(cx - 20, y).M(cx + 20, y).L(cx + 80, y)), { stroke: P.gold, sw: 0.6, op: 0.7 }));
  if (ctx.tpl.cover.motif === 'lamps') {
    const glow = ctx.gradient('lampGlow', { type: 'radial', cx: 0, cy: 0, r: 1, units: 'item', stops: [[0, P.flame, 0.8], [1, P.clay, 0]] });
    items.push(...lamp(cx, y + 3, 10, { clay: P.clay, flame: P.flame, gold: P.gold, glow: glow.ref }));
  } else {
    const stars = sparkleData(cx, y, 7.5);
    sparkleData(cx - 12, y, 3, stars);
    sparkleData(cx + 12, y, 3, stars);
    items.push(path(String(stars), { fill: P.gold }));
  }
}

/** A section's measurements at a density: its row height, heading, rows and whole height. */
function shape(s, d = density(s.people.length)) {
  const rh = rowHeight(d);
  const heading = s.note ? 84 : 78;
  const rows = Math.ceil(s.people.length / d.cols);
  return { d, rh, heading, rows, whole: heading + rows * rh };
}

/**
 * Whether a section starts on a new page when the page so far reaches `y`. It starts where it is
 * if it fits there whole; otherwise only if two of its rows fit under its heading and - when it
 * would fit whole on a fresh page - two are left to carry over. So nothing strands a lone row
 * under a "continued" heading, and a page is not left half empty just to keep a generation together.
 */
function breaksBefore(y, f) {
  if (y <= TOP || y + f.whole <= BOTTOM) return false;
  const room = Math.floor((BOTTOM - y - f.heading) / f.rh);
  return room < 2 || (TOP + f.whole <= BOTTOM && f.rows - room < 2);
}

/** The same section with the largest portraits that still fit one page, keeping its columns. */
function grown(s, f) {
  const sizes = f.d.cols <= 4 ? [[44, 14], [38, 13], [34, 12.5]] : [[30, 11.5], [26, 10.5]];
  for (const [r, name] of sizes) {
    if (r <= f.d.r) break;
    const g = shape(s, { ...f.d, r, name });
    if (TOP + g.whole <= BOTTOM) return g;
  }
  return f;
}

function subtitle(s) {
  if (s.note) return s.note;
  const years = s.people.map((p) => p.by).filter((b) => b !== null);
  if (!years.length) return null;
  const lo = Math.min(...years), hi = Math.max(...years);
  return lo === hi ? `Born in ${lo}` : `Born between ${lo} and ${hi}`;
}

function header(ctx, items, title, sub, y, size = 32) {
  const { P } = ctx;
  items.push(ctx.line(SIDE, y + size, title, 'display', ctx.fit(title, 'display', size, W - 2 * SIDE - 60, 18), P.ink));
  if (sub) items.push(ctx.line(SIDE, y + size + 24, sub, 'text', 12, P.inkSoft, { width: W - 2 * SIDE }));
  items.push(path(String(new PathData().M(SIDE, y + size + (sub ? 40 : 14)).L(W - SIDE, y + size + (sub ? 40 : 14))), { stroke: P.rule, sw: 0.8 }));
}

/** Where card k of a row sits: a short last row is centred rather than left hanging. */
function rowX(inRow, cols, k) {
  const cw = (W - 2 * SIDE) / cols;
  return SIDE + ((W - 2 * SIDE) - inRow * cw) / 2 + k * cw;
}

function card(ctx, items, p, d, x, y, rh) {
  const { P, family } = ctx;
  const cw = (W - 2 * SIDE) / d.cols;
  const cx = x + cw / 2;
  items.push(rect(x + 6, y, cw - 12, rh - 14, { r: 4, fill: p.deceased ? P.aged : P.card }));
  if (p.deceased) items.push(path(String(new PathData().M(x + 6, y + 0.8).L(x + cw - 6, y + 0.8)), { stroke: P.goldSoft, sw: 1.6 }));
  items.push(...ctx.portrait(p, cx, y + d.r + 16, d.r));
  ctx.pageOf.set(p.id, ctx.pageNo);

  const width = cw - 26;
  const name = ctx.lines(cx, y + d.r * 2 + 16 + d.name * 1.9, p.name ?? 'Name not yet recorded', 'strong', d.name, p.name ? P.ink : P.goldSoft, { width, maxLines: 2, lead: d.name * 1.15, align: 'middle' });
  items.push(...name.items);
  let yy = name.bottom + d.name * 1.05;
  const life = lifeLine(p, ctx.options);
  if (life) {
    items.push(ctx.line(cx, yy, life, 'text', d.name * 0.76, P.inkSoft, { align: 'middle', width }));
    yy += d.name * 0.95;
  }
  const parents = family.parentsOf(p.id).map(firstName).filter(Boolean);
  const partners = family.spousesOf(p.id).map(firstName).filter(Boolean);
  const relation = parents.length ? `Child of ${andList(parents)}` : partners.length ? `Married to ${andList(partners)}` : null;
  if (relation) items.push(...ctx.lines(cx, yy + 1, relation, 'text', d.name * 0.7, P.inkSoft, { width, maxLines: 1, align: 'middle', op: 0.9 }).items);
}
