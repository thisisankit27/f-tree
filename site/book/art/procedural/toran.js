/*
 * A toran: a cord strung with marigolds across a doorway, an arch or the top of a page (#255).
 *
 * The flowers are the seeded `marigold` symbol (art/papercut/motifs.js), placed with `ctx.art`
 * so a cord of forty flowers costs one symbol's bytes plus forty `use`s, never forty copies of the
 * geometry (site/book/art/README.md, "reuse, don't copy"). The cord itself is drawn fresh every
 * time, because a toran is never the same width twice - a doorway, an arch and a page header are
 * all different spans - so the flower count and spacing are computed here, never fixed by a
 * caller.
 *
 * Budget: each flower is placed with its paper shadow (a second `use` of the same symbol), which
 * is why the cost is closer to two flowers' worth of bytes than one. Measured (art-procedural.test
 * .mjs) at a full page width (about 27 flowers at the default spacing): roughly 177 KB of
 * estimated PDF bytes by compose.js's artTerm. A page that hangs more than one toran should budget
 * for this per toran, the same way it would for any other art.
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
 *   w     a flower's width in page points (13, the draw.js doc's own example, by default).
 *   gap   spacing between flower centres, as a multiple of `w`: a wider door gets more flowers,
 *         never bigger ones.
 *   sag   how far the cord dips at its centre, as a multiple of `w`.
 * Returns one group item (the cord plus every flower and its shadow), or `null` for a span too
 * short to hang even one flower.
 */
export function toran(art, P, x1, x2, y, seed, { w = 13, gap = 1.55, sag = 0.35 } = {}) {
  const span = x2 - x1;
  if (Math.abs(span) < w * 0.5) return null;
  const rand = seeded(seed);
  const n = Math.max(1, Math.round(Math.abs(span) / (w * gap)));
  const dip = w * sag;
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

  // shrink the shadow offset for a flower smaller than draw.js's own w:13 example, per its doc.
  const shrink = w / 13;
  const shadow = { dx: 1.7 * shrink, dy: 2.3 * shrink, op: 0.22 };
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0.5 : i / n;
    const [mx, my] = at(t);
    const jitter = (rand() - 0.5) * w * 0.12;
    const size = w * (0.86 + 0.24 * ((i % 3) / 2));
    items.push(art.place('marigold', { x: mx, y: my + jitter, w: size, shadow }));
  }
  return group(items);
}
