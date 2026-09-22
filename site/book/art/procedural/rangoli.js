/*
 * A rangoli laid on the ground: a lotus heart, rings of cut petals and a ring of dots (#255).
 *
 * Composer-path code: deterministic only through seed.js's seeded(), never Math.random, Date or
 * anything else with a clock or a locale. The pattern is never the same shape twice - the seed is
 * the family's own (docs/storybook-plan.md, "Rulings") - so it is drawn fresh as plain path and
 * circle items rather than a compiled symbol: nothing in it repeats often enough within one
 * drawing to be worth a `use` (contrast art/procedural/toran.js and diyaRow.js, which place the
 * same flower or lamp many times and do use one).
 *
 * The geometry is ported from the approved reference, style-frames/motifs.mjs `rangoli()`
 * (docs/book-design-system.md: "if a frame disagrees with this document, the frame wins"),
 * rewritten onto format.js's item builders so it can run inside the real composer.
 *
 * Round 1 (design critic): the seed now varies the petal count (16, 20 or 24), the order the four
 * given colours are assigned to the rings, and each ring's petal length/width within a tasteful
 * range - two families no longer draw near-identical rangolis. The ground is a seeded wobbled cut
 * shape (ported from the reference's cutShape, style-frames/kit.mjs), not a perfect circle. The
 * outer ring's accent dots sit in the gaps between petals, one per gap, rather than at a fixed
 * count that could land on a petal's own tip for some seeded counts. The second petal ring, which
 * sits in the gaps of the first (not stacked on it), is now gold rather than `card`: against a
 * `card`-coloured ground - the default - it was invisible.
 *
 * Budget (site/book/art/README.md "budgets"): one rangoli at R=90pt (the design system's medallion
 * scale) has no gradients or uses; art-procedural.test.mjs measures and holds its estimated PDF
 * cost to a ceiling. "Rangoli is used at most twice in a book" (book-design-system.md), so its
 * worst case across a whole book is well under the per-page share of the 10 MB budget.
 */

import { path, circle, group, PathData } from '../../format.js';
import { seeded } from '../seed.js';

const TAU = Math.PI * 2;

/** One ring of `count` cut petals around `(cx, cy)` at radius `rr`, `len` long and `wd` wide. */
function petalRing(cx, cy, rr, count, len, wd, fill, offset = 0) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const a = ((i + offset) / count) * TAU;
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const at = (al, ac) => [cx + ux * (rr + al) + vx * ac, cy + uy * (rr + al) + vy * ac];
    const [x0, y0] = at(0, 0), [x1, y1] = at(len * 0.3, wd), [x2, y2] = at(len * 0.75, wd), [x3, y3] = at(len, 0);
    const [x4, y4] = at(len * 0.75, -wd), [x5, y5] = at(len * 0.3, -wd);
    const d = new PathData().M(x0, y0).C(x1, y1, x2, y2, x3, y3).C(x4, y4, x5, y5, x0, y0).Z();
    items.push(path(String(d), { fill: typeof fill === 'function' ? fill(i) : fill }));
  }
  return items;
}

/** `n` points evenly around a circle of radius `r` centred on `(cx, cy)`. */
function ellipsePts(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}

/**
 * Nudges each point of a closed ring along its own normal - the scissors' hand: a hand-cut edge is
 * never geometrically perfect (book-design-system.md, "Hand-cut edges"). Ported from the approved
 * reference's wobble() (style-frames/kit.mjs) onto a `rand` the caller already seeded, rather than
 * re-seeding here, so the whole rangoli draws from one seeded stream.
 */
function wobble(pts, amp, rand, freq = 3) {
  const n = pts.length;
  const ph1 = rand() * TAU, ph2 = rand() * TAU;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const t = i / n;
    const w = amp * (0.55 * Math.sin(t * TAU * freq + ph1) + 0.3 * Math.sin(t * TAU * freq * 2.7 + ph2) + 0.35 * (rand() - 0.5));
    return [p[0] + nx * w, p[1] + ny * w];
  });
}

/** A closed Catmull-Rom curve through `pts`, as the absolute cubics format.js's PathData allows. */
function smoothClosed(pts) {
  const n = pts.length;
  const at = (i) => pts[(i + n) % n];
  const d = new PathData().M(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p1 = at(i), p2 = at(i + 1), p0 = at(i - 1), p3 = at(i + 2);
    const k = 1 / 6;
    d.C(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]);
  }
  d.Z();
  return String(d);
}

/**
 * A rangoli: `(cx, cy)` its centre, `R` its radius, both in page points. `P` is the template's
 * resolved palette (`ctx.P`, token -> "#rrggbb"): this draws colours directly, not tokens, because
 * it is never compiled into a reusable symbol. `seed` is the one thing that makes two families'
 * rangolis differ - never the page number (art/README.md rule 6), so an unrelated edit elsewhere
 * in the book doesn't reshuffle it. `colours` are four resolved hexes for the cut petals (their
 * assignment to rings is itself seeded), and `ground` is the disc it sits on.
 *
 * Returns one group item, ready to push onto a page's items.
 */
export function rangoli(P, cx, cy, R, seed, { colours = [P.rani, P.marigold, P.peacock, P.saffron], ground = P.card } = {}) {
  const rand = seeded(seed);

  // seeded variety: the outer ring's petal count, the colours' role order, and each ring's
  // chubbiness within a tasteful range around the approved reference's own proportions.
  const outerCount = [16, 20, 24][Math.floor(rand() * 3)];
  const midCount = Math.round(outerCount / 2);
  const innerCount = Math.round(outerCount / 3);
  const rot = Math.floor(rand() * colours.length);
  const C = colours.map((_, i) => colours[(i + rot) % colours.length]);
  const tasteful = (base, spread) => base + rand() * spread;
  const outerLen = R * tasteful(0.26, 0.08), outerWd = R * tasteful(0.055, 0.03);
  const midLen = R * tasteful(0.24, 0.08), midWd = R * tasteful(0.085, 0.03);
  const innerLen = R * tasteful(0.17, 0.06), innerWd = R * tasteful(0.065, 0.02);
  // a floor so a small rangoli's accent dots don't vanish to sub-pixel specks (round 1, "nice")
  const dotR = (frac) => Math.max(R * frac, 0.8);

  const items = [];

  // the ground: a seeded wobbled cut disc, not a perfect circle, with the paper shadow every cut
  // layer casts (book-design-system.md)
  const ring = wobble(ellipsePts(cx, cy, R * 1.02, 48), R * 0.018, rand);
  items.push(path(smoothClosed(ring.map(([x, y]) => [x + 1.7, y + 2.3])), { fill: P.ink, op: 0.1 }));
  items.push(path(smoothClosed(ring), { fill: ground }));

  items.push(...petalRing(cx, cy, R * 0.7, outerCount, outerLen, outerWd, (i) => (i % 2 ? C[0] : C[1])));
  // the second ring sits in the GAPS of the first (offset 0.5), on the bare ground, not stacked
  // on a petal - it must contrast with the ground, so it is gold rather than the ground's own
  // `card` (round 1: "invisible on the card ground").
  items.push(...petalRing(cx, cy, R * 0.72, outerCount, outerLen * 0.6, outerWd * 0.5, P.gold, 0.5));

  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    items.push(circle(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62, dotR(0.018), { fill: C[2] }));
  }
  items.push(...petalRing(cx, cy, R * 0.3, midCount, midLen, midWd, (i) => (i % 2 ? C[2] : C[3])));
  items.push(...petalRing(cx, cy, R * 0.12, innerCount, innerLen, innerWd, C[0], 0.5));
  items.push(circle(cx, cy, R * 0.13, { fill: P.gold }));
  items.push(circle(cx, cy, R * 0.06, { fill: C[3] }));

  // one accent dot in every gap of the outer ring - never on a petal's own tip, whatever the
  // seeded outer count turned out to be (round 1: a fixed 8 could land on a tip).
  for (let i = 0; i < outerCount; i++) {
    const a = ((i + 0.5) / outerCount) * TAU;
    items.push(circle(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94, dotR(0.025), { fill: C[(i + Math.floor(rand() * 2)) % 4] }));
  }
  return group(items);
}
