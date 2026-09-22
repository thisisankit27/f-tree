/*
 * A toran: a cord hung with mango leaves across a doorway, an arch or the top of a page (#255),
 * a marigold at every other leaf. This is the approved treatment (design-critic round 1): a
 * marigold-only string is the book's marriage notation (a marigold mala between two frames), so a
 * sagging string of marigolds alone risks being read as one.
 *
 * The leaves and flowers are #253's `mango-leaf` and `marigold` symbols, placed with `ctx.art` so
 * a cord of forty leaves costs one symbol's bytes plus forty `use`s, never forty copies of the
 * geometry (site/book/art/README.md, "reuse, don't copy"). The cord itself is drawn fresh every
 * time, because a toran is never the same width twice - a doorway, an arch and a page header are
 * all different spans - so the leaf count and spacing are computed here, never fixed by a caller.
 *
 * Budget: each leaf and flower is placed with its paper shadow (a second `use` of the same
 * symbol), and neither symbol carries a gradient, so the cost is bytes and translucent layers
 * only. Measured (art-procedural.test.mjs) at a full page width, densely overlapped as the
 * approved frame draws it (round 2: about 116 leaves and 58 flowers at the default 0.7 gap):
 * roughly 330 KB of estimated PDF bytes by compose.js's artTerm - more than double round 1's
 * sparser spacing. A page that hangs more than one toran should budget for this per toran, the
 * same way it would for any other art.
 *
 * Composer-path code: deterministic only through seed.js's seeded().
 */

import { path, group, PathData } from '../../format.js';
import { seeded } from '../seed.js';

/**
 * Hangs a toran from `(x1, y)` to `(x2, y)` (page points; `x1` may be greater than `x2`).
 *   art   `artFor(ctx)` (art/draw.js) for the book this toran joins.
 *   P     the template's resolved palette (`ctx.P`), for the cord's own colour.
 *   seed  the one source of variety between two torans - never the page number.
 *   size  a leaf's width in page points (13 by default); the marigolds are drawn a little smaller.
 *   gap   spacing between leaves, as a multiple of `size` - 0.7 by default so leaves overlap
 *         densely, as the approved frame draws them: a wider door gets more leaves, never bigger
 *         ones.
 *   sag   how far the cord dips at its centre, as a fraction of the span - about 0.03 reads as a
 *         hung cord; 0 draws it straight. (Round 1: 0.35 of a flower's width read as a wobbly
 *         straight line rather than a dip, because it didn't scale with the span.)
 * Returns one group item (the cord, every leaf and every other slot's marigold, each with its
 * paper shadow), or `null` for a span too short to hang even one leaf.
 */
export function toran(art, P, x1, x2, y, seed, { size = 13, gap = 0.7, sag = 0.03 } = {}) {
  const span = x2 - x1;
  if (Math.abs(span) < size * 0.5) return null;
  const rand = seeded(seed);
  const n = Math.max(1, Math.round(Math.abs(span) / (size * gap)));
  const dip = Math.abs(span) * sag;
  const at = (t) => [x1 + span * t, y + Math.sin(t * Math.PI) * dip];

  const cord = new PathData();
  const [sx, sy] = at(0);
  cord.M(sx, sy);
  const steps = Math.max(8, Math.min(40, n * 3));
  for (let i = 1; i <= steps; i++) {
    const [cx, cy] = at(i / steps);
    cord.L(cx, cy);
  }
  const items = [path(String(cord), { stroke: P.clay, sw: 1.2 })];

  // shrink the shadow offset for a leaf smaller than draw.js's own w:13 example, per its doc.
  const shrink = size / 13;
  const shadow = { dx: 1.7 * shrink, dy: 2.3 * shrink, op: 0.22 };

  for (let i = 0; i <= n; i++) {
    // n is always >= 1 here (the Math.max above), so i / n never divides by zero.
    const [lx, ly] = at(i / n);
    const leafSize = size * (0.86 + 0.24 * ((i % 3) / 2));
    // alternate leaf/leafDeep with a tint - free (no new symbol or bytes beyond the use's own
    // fill), and matches the approved reference's own alternation (style-frames/motifs.mjs).
    items.push(art.place('mango-leaf', { x: lx, y: ly, w: leafSize, flip: i % 2 ? 'x' : undefined, shadow, tint: i % 2 ? 'leafDeep' : 'leaf' }));
  }
  for (let i = 0; i <= n; i += 2) {
    const [mx, my] = at(i / n);
    const jitter = (rand() - 0.5) * size * 0.1;
    items.push(art.place('marigold', { x: mx, y: my + jitter, w: size * 0.7, shadow }));
  }
  return group(items);
}
