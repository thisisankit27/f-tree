/*
 * The Night sky's drawing vocabulary: stars, lamps, lanterns, a rangoli ring.
 *
 * Everything that stands for a person is one mark per person - the constellation invents nobody.
 * The starfield behind it is texture, and deliberately looks it: smaller, fainter and never joined
 * by a line, so no reader mistakes a background speck for a relative.
 */

import { circle, path, group, PathData, r2 } from '../format.js';
import { seeded } from '../art/seed.js';

/* seeded() lives in art/seed.js now (#247); re-exported so every existing import keeps working. */
export { seeded };

export function starfield(seed, count, box, colour) {
  const rand = seeded(seed);
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(circle(box.x + rand() * box.w, box.y + rand() * box.h, 0.25 + rand() * 0.7, { fill: colour, op: 0.15 + rand() * 0.5 }));
  }
  return group(items);
}

/** A four-point star: long vertical arms, shorter horizontal ones. */
export function sparkleData(x, y, s, d = new PathData()) {
  const k = 0.16;
  return d.M(x, y - s)
    .Q(x + s * k, y - s * k, x + s * 0.72, y)
    .Q(x + s * k, y + s * k, x, y + s)
    .Q(x - s * k, y + s * k, x - s * 0.72, y)
    .Q(x - s * k, y - s * k, x, y - s)
    .Z();
}

/** A diya: clay bowl, flame, and the glow around it. `unknown` draws the bowl as the dashed ring. */
export function lamp(x, y, s, { unknown, clay, flame, gold, glow }) {
  const k = s / 10;
  const bowl = new PathData().M(x - 7.5 * k, y).Q(x, y + 7.5 * k, x + 7.5 * k, y).Z();
  const tongue = new PathData()
    .M(x, y - 1 * k)
    .C(x + 2.3 * k, y - 3 * k, x + 2.1 * k, y - 6.6 * k, x, y - 10.5 * k)
    .C(x - 2.1 * k, y - 6.6 * k, x - 2.3 * k, y - 3 * k, x, y - 1 * k)
    .Z();
  return [
    circle(x, y - 5 * k, 13 * k, { fill: { ref: glow } }),
    unknown
      ? path(String(bowl), { stroke: gold, sw: 0.9 * k, dash: [1.6 * k, 1.2 * k] })
      : path(String(bowl), { fill: clay }),
    path(String(tongue), { fill: flame }),
  ];
}

/** A hanging paper lantern (akash kandil) on its cord. */
export function lantern(x, drop, { body, top, cord, glow }) {
  const cordLine = new PathData().M(x, 0).L(x, drop);
  const bodyShape = new PathData().M(x, drop).L(x + 18, drop + 16).L(x, drop + 50).L(x - 18, drop + 16).Z();
  const cap = new PathData().M(x, drop).L(x + 18, drop + 16).L(x - 18, drop + 16).Z();
  const tassels = new PathData()
    .M(x - 10, drop + 50).L(x - 8, drop + 68)
    .M(x, drop + 50).L(x, drop + 72)
    .M(x + 10, drop + 50).L(x + 8, drop + 68);
  return [
    path(String(cordLine), { stroke: cord, sw: 0.7 }),
    circle(x, drop + 22, 34, { fill: { ref: glow } }),
    path(String(bodyShape), { fill: body }),
    path(String(cap), { fill: top }),
    path(String(tassels), { stroke: top, sw: 1.2 }),
  ];
}

/** A ring of alternating petals, the border of a rangoli, around (cx, cy). */
export function rangoliRing(cx, cy, radius, count, colours, rule) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
    // A petal pointing outwards, built in place so no transform is needed.
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const P = (along, across) => [x + ux * along + vx * across, y + uy * along + vy * across];
    const d = new PathData().M(...P(0, 0));
    d.C(...P(8, 6), ...P(16, 6), ...P(24, 0));
    d.C(...P(16, -6), ...P(8, -6), ...P(0, 0));
    d.Z();
    items.push(path(String(d), { fill: colours[i % colours.length], op: 0.9 }));
  }
  items.push(circle(cx, cy, radius - 14, { stroke: rule, sw: 0.8, dash: [2, 5], op: 0.7 }));
  return items;
}

/** The f-tree mark: two discs joined to a third, which is the dashed brass ring of a name unknown. */
export function logo(x, y, size, ink, brass) {
  const k = size / 24;
  const P = (px, py) => [x + px * k, y + py * k];
  const lines = new PathData().M(...P(12, 7)).L(...P(12, 12)).M(...P(12, 12)).L(...P(6, 17)).M(...P(12, 12)).L(...P(18, 17));
  return [
    path(String(lines), { stroke: ink, sw: 1.6 * k }),
    circle(...P(12, 5), 3 * k, { fill: ink }),
    circle(...P(5, 19), 3 * k, { fill: ink }),
    circle(...P(19, 19), 3 * k, { stroke: brass, sw: 1.6 * k, dash: [1.6 * k, 1.4 * k] }),
  ];
}

/** QR modules as one path: every dark module a square, merged into a single fill. */
export function qrPath(rows, x, y, size, fill) {
  const n = rows.length, m = size / n;
  const d = [];
  rows.forEach((row, r) => {
    let c = 0;
    while (c < n) {
      if (row[c] !== '1') { c++; continue; }
      let end = c;
      while (end < n && row[end] === '1') end++;
      // One rectangle per run of dark modules keeps the path short.
      const x0 = r2(x + c * m), x1 = r2(x + end * m), y0 = r2(y + r * m), y1 = r2(y + (r + 1) * m);
      d.push(`M${x0} ${y0}L${x1} ${y0}L${x1} ${y1}L${x0} ${y1}Z`);
      c = end;
    }
  });
  return path(d.join(''), { fill });
}
