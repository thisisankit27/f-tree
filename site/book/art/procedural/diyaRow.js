/*
 * A row of diyas: one lamp per person, and never one more (#255).
 *
 * docs/book-design-system.md, "One lamp per person": wherever lamps count people, each lamp is
 * exactly one person. This module draws exactly `count` lamps and nothing else - it never rounds
 * a count up to fill a row, and it never adds a decorative lamp beside the counting ones. Deciding
 * how many people a page can afford to light (the cover, "In numbers", "Legacy") is a page's own
 * job; this is only the primitive that lights however many it is told to.
 *
 * Every lamp is the seeded `diya` symbol (art/papercut/motifs.js), placed with `ctx.art` so a row
 * of two hundred lamps costs one symbol's bytes plus two hundred `use`s (site/book/art/README.md,
 * "reuse, don't copy"). `diya` already draws its own bowl shadow and glow discs in its source, so
 * it is placed without an extra `shadow` (art/draw.js: "a lamp keeps its own bowl shadow ... and is
 * placed without one").
 *
 * Budget: one diya's compiled symbol carries about a dozen shapes and one gradient (its flame),
 * and a gradient is the single most expensive thing compose.js's artTerm counts (ART_PDF.gradients
 * = 5800, against 1050 for a translucent layer and a fraction of a byte per path point), so a
 * row's cost is dominated by its lamp count almost regardless of how simple each lamp is. Measured
 * (art-procedural.test.mjs) at the design system's own page caps: a family page (<=8 people) is
 * about 146 KB of estimated PDF bytes, a gathering (<=12) about 218 KB. A page with many more
 * people than that - a cover lighting a whole family - should expect the cost to keep climbing
 * roughly linearly (measured at 48: about 874 KB) and budget its page count accordingly; this
 * generator does not cap or sample the row, because doing so would mean inventing which people to
 * leave unlit, which is exactly what "never invents extra people" (and never omits real ones)
 * forbids here. A page that cannot afford to light everyone individually should choose a different
 * composition (the register, a count in words), not ask this generator to decide for it.
 * No page-level radial glow is added here either: `diya`'s own light is stacked discs, not a
 * gradient (book-design-system.md, "Light"), so it does not by itself use up the "~10 radial
 * glows a page" cap - a page that adds its own ambient glow behind the row still has to count it.
 *
 * Composer-path code: deterministic only through seed.js's seeded().
 */

import { group } from '../../format.js';
import { seeded } from '../seed.js';

/**
 * `count` diyas from `(x1, y1)` to `(x2, y2)` (page points), evenly spaced along that line with a
 * small seeded jitter so the row doesn't look ruled with a straightedge.
 *   art        `artFor(ctx)` (art/draw.js) for the book this row joins.
 *   count      exactly how many people this row stands for. Never invented, never rounded.
 *   seed       the one source of the row's jitter - never the page number.
 *   w          a lamp's width in page points, or `(i, t) => width` for a row that recedes (t is
 *              the lamp's position along the row, 0 to 1).
 *   jitter     how far a lamp may drift off the line, as a multiple of `w`.
 *   unknownAt  a Set of indices, or a predicate `(i) => boolean`, for a person whose name is not
 *              known. Drawn with the dashed-bowl 'diya-unknown' symbol once it exists (#253); until
 *              then it falls back to the same lit 'diya' as everyone else, because a book must
 *              never ask for a symbol that was never compiled.
 * Returns one group item, or `null` for `count === 0` - a page with nobody to light draws nothing,
 * rather than an empty group.
 */
export function diyaRow(art, x1, y1, x2, y2, count, seed, { w = 20, jitter = 0.18, unknownAt = new Set() } = {}) {
  if (!Number.isInteger(count) || count < 0) throw new Error(`art: diyaRow count must be a whole number of people, got ${count}`);
  if (count === 0) return null;
  const rand = seeded(seed);
  const unknownSymbol = art.has('diya-unknown') ? 'diya-unknown' : 'diya';
  const isUnknown = unknownAt instanceof Set ? (i) => unknownAt.has(i) : (i) => !!unknownAt(i);
  const items = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const width = typeof w === 'function' ? w(i, t) : w;
    const jx = (rand() - 0.5) * jitter * width, jy = (rand() - 0.5) * jitter * width;
    const x = x1 + (x2 - x1) * t + jx;
    const y = y1 + (y2 - y1) * t + jy;
    items.push(art.place(isUnknown(i) ? unknownSymbol : 'diya', { x, y, w: width }));
  }
  return group(items);
}
