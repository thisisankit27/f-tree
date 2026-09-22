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
 * Budget (site/book/art/README.md "budgets"): one rangoli at R=90pt (the design system's medallion
 * scale) is 128 shapes, no gradients or uses and one translucent layer (the ground's shadow) -
 * measured at about 9.7 KB of estimated PDF bytes by compose.js's artTerm. "Rangoli is used at
 * most twice in a book" (book-design-system.md), so its worst case across a whole book is well
 * under the per-page share of the 10 MB budget. art-procedural.test.mjs holds this to a ceiling
 * so a change here that starts adding gradients or per-petal shadows trips a test, not a surprise
 * at print time.
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

/**
 * A rangoli: `(cx, cy)` its centre, `R` its radius, both in page points. `P` is the template's
 * resolved palette (`ctx.P`, token -> "#rrggbb"): this draws colours directly, not tokens, because
 * it is never compiled into a reusable symbol. `seed` is the one thing that makes two families'
 * rangolis differ - never the page number (art/README.md rule 6), so an unrelated edit elsewhere
 * in the book doesn't reshuffle it. `colours` are four resolved hexes for the cut petals, and
 * `ground` is the disc it sits on.
 *
 * Returns one group item, ready to push onto a page's items.
 */
export function rangoli(P, cx, cy, R, seed, { colours = [P.rani, P.marigold, P.peacock, P.saffron], ground = P.card } = {}) {
  const rand = seeded(seed);
  const items = [];
  // the ground disc, with the paper shadow every cut layer casts (book-design-system.md)
  items.push(circle(cx + 1.7, cy + 2.3, R * 1.02, { fill: P.ink, op: 0.1 }));
  items.push(circle(cx, cy, R * 1.02, { fill: ground }));
  items.push(...petalRing(cx, cy, R * 0.7, 24, R * 0.3, R * 0.07, (i) => (i % 2 ? colours[0] : colours[1])));
  items.push(...petalRing(cx, cy, R * 0.72, 24, R * 0.18, R * 0.035, P.card, 0.5));
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    items.push(circle(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62, R * 0.018, { fill: colours[2] }));
  }
  items.push(...petalRing(cx, cy, R * 0.3, 12, R * 0.28, R * 0.1, (i) => (i % 2 ? colours[2] : colours[3])));
  items.push(...petalRing(cx, cy, R * 0.12, 8, R * 0.2, R * 0.075, colours[0], 0.5));
  items.push(circle(cx, cy, R * 0.13, { fill: P.gold }));
  items.push(circle(cx, cy, R * 0.06, { fill: colours[3] }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    items.push(circle(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94, R * 0.025, { fill: colours[(i + Math.floor(rand() * 2)) % 4] }));
  }
  return group(items);
}
