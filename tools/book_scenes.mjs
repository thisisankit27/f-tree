/*
 * The storybook's six scenes (#254), authored in code and written out as the SVG sources that
 * tools/book_art.mjs compiles:
 *
 *   node tools/book_scenes.mjs                   write site/book/art/src/papercut/scenes/*.svg
 *   node tools/book_scenes.mjs --review <dir>    also paint every scene through svg.js in headless
 *                                                Chromium: <id>.png at page size, <id>-150.png at a
 *                                                chat thumbnail's width, <id>-zones.png with its zones,
 *                                                sample copy and stand-in lamps, and sheet.png, all six
 *                                                side by side (FTREE_PLAYWRIGHT, as book_print.mjs)
 *
 * The scenes are drawn here rather than in an editor because their look is the approved style
 * frames' (site/book/art/style-frames/frames.mjs), which is procedural: seeded wobble on every cut
 * edge, rows of windows, scattered stars. This file is their source; edit it and rerun, rather than
 * editing the SVGs by hand, or the next run overwrites the edit. Then run `node tools/book_art.mjs`.
 *
 * What makes them paper-cut rather than flat vector, and what keeps them small:
 *   - every cut layer casts a paper shadow that is a *silhouette use* of the same shape
 *     (a `<use fill>`), never a second copy of its paths;
 *   - a shape drawn more than once (a house, a leaf, an umbrella) is one part placed many times,
 *     and recoloured by a silhouette use rather than copied;
 *   - rows of small marks (stars, merlons, ripples, lights, holes seen far off) are one stroked
 *     path with a dash, not one shape each;
 *   - translucency is a layer's opacity where it can be, because the PDF pays for every translucent
 *     shape (compose.js ART_PDF);
 *   - layers darken toward the viewer on night scenes.
 * Scenes invent nobody and count nothing: lamps, people, frames and names are placed by the pages
 * into the zones each scene declares.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { resample, wobble, ellipsePts } from '../site/book/art/style-frames/kit.mjs';
import { seeded } from '../site/book/art/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
export const SCENE_DIR = path.join(repoRoot, 'site', 'book', 'art', 'src', 'papercut', 'scenes');

const W = 595, H = 842;

/** The authoring hexes of src/papercut/swatches.json, by token: the only colours a source may use. */
const HEX = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(SCENE_DIR, '..', 'swatches.json'), 'utf8')).swatches).map(([hex, token]) => [token, hex]));

/* ------------------------------------------------------------------------------ geometry */

/** A tenth of a point is finer than any printer draws, and a digit shorter than the compiler's 0.01. */
const R = (v) => Math.round(v * 10) / 10;
const n = (v) => String(R(v));

class P {
  constructor() { this.s = ''; }
  M(x, y) { this.s += `M${n(x)} ${n(y)}`; return this; }
  L(x, y) { this.s += `L${n(x)} ${n(y)}`; return this; }
  C(a, b, c, d, x, y) { this.s += `C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(x)} ${n(y)}`; return this; }
  Q(a, b, x, y) { this.s += `Q${n(a)} ${n(b)} ${n(x)} ${n(y)}`; return this; }
  Z() { this.s += 'Z'; return this; }
  toString() { return this.s; }
}
const d = () => new P();

/** A Catmull-Rom spline through points, as cubics (kit.mjs's, at a tenth of a point). */
function smooth(pts, { closed = true, tension = 1 } = {}) {
  const m = pts.length;
  const p = d().M(...pts[0]);
  const at = (i) => (closed ? pts[(i + m) % m] : pts[Math.max(0, Math.min(m - 1, i))]);
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2), k = tension / 6;
    p.C(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]);
  }
  if (closed) p.Z();
  return String(p);
}
function poly(pts, closed = true) {
  const p = d().M(...pts[0]);
  for (const q of pts.slice(1)) p.L(...q);
  if (closed) p.Z();
  return String(p);
}
/** A hand-cut outline: resampled every `step`, nudged by a seeded wobble, smoothed. */
const hand = (pts, amp, seed, step = 24) => smooth(wobble(resample(pts, step), amp, seed));
/** A hand-cut open line (a ridge, a roofline): the ends stay put. */
const handLine = (pts, amp, seed, step = 24) => smooth(wobble(resample(pts, step, false), amp, seed, { closed: false }), { closed: false });
/** A band whose top edge is hand-cut and whose other three sides run off the page: only the edge a
 *  reader sees pays for its wobble. */
const bandFrom = (top, bottom, amp, seed, step = 40) => {
  const edge = handLine(top, amp, seed, step);
  const [x1] = top[top.length - 1], [x0] = top[0];
  return `${edge}L${n(x1)} ${n(bottom)}L${n(x0)} ${n(bottom)}Z`;
};
/** A circle as a closed subpath, for punching holes with the even-odd rule. */
function ring(cx, cy, r) {
  const k = 0.552 * r;
  return String(d().M(cx - r, cy).C(cx - r, cy - k, cx - k, cy - r, cx, cy - r).C(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    .C(cx + r, cy + k, cx + k, cy + r, cx, cy + r).C(cx - k, cy + r, cx - r, cy + k, cx - r, cy).Z());
}
/** An arched opening (x, y top-left, w by h): straight jambs and a pointed or round head, as two cubics. */
function arch(x, y, w, h, { pointed = true } = {}) {
  const s = pointed ? w * 0.62 : w / 2, cx = x + w / 2;
  return String(d().M(x, y + h).L(x, y + s).C(x, y + s * 0.4, cx - w * 0.3, y + (pointed ? s * 0.07 : 0), cx, y)
    .C(cx + w * 0.3, y + (pointed ? s * 0.07 : 0), x + w, y + s * 0.4, x + w, y + s).L(x + w, y + h).Z());
}
/** A stroke of dots: one path, round caps on dashes of almost nothing. */
const dots = (pts) => pts.map(([x, y]) => `M${n(x)} ${n(y)}L${n(x + 0.1)} ${n(y)}`).join('');
const line = (x1, y1, x2, y2) => `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`;

/* -------------------------------------------------------------------------------- writer */

const SHADOW = { dx: 1.7, dy: 2.3, op: 0.22, colour: 'ink' };
const SOFT = [[3, 0.35], [2, 0.3], [1, 0.45]];
const tfOf = ({ x = 0, y = 0, s = 1, sx = s, sy = s, flip = false, rot = 0 } = {}) => {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), fx = flip ? -1 : 1;
  return [c * sx * fx, sn * sx * fx, -sn * sy, c * sy, x, y];
};
const mtx = (m) => `matrix(${m.map((v) => Math.round(v * 1000) / 1000).join(' ')})`;

/** An SVG source the compiler reads: parts in <defs>, layers as top-level groups, zones as rects. */
class Scene {
  constructor(id, desc) {
    this.id = id; this.desc = desc;
    this.defs = []; this.layers = []; this.zones = []; this.stack = []; this.parts = new Set(); this.grads = 0;
  }
  hex(t) {
    if (!Object.hasOwn(HEX, t)) throw new Error(`${this.id}: no swatch for the token "${t}"`);
    return HEX[t];
  }
  emit(s) { this.stack[this.stack.length - 1].push(s); }
  capture(fn) { const out = []; this.stack.push(out); fn(); this.stack.pop(); return out.join(''); }
  attrs({ fill, stroke, sw = 1, op, rule, dash, cap, join } = {}) {
    let a = ` fill="${fill ? (fill.startsWith('url(') ? fill : this.hex(fill)) : 'none'}"`;
    if (stroke) a += ` stroke="${this.hex(stroke)}" stroke-width="${n(sw)}"`;
    if (dash) a += ` stroke-dasharray="${dash.map((v) => Math.round(v * 100) / 100).join(' ')}"`;
    if (cap) a += ` stroke-linecap="${cap}"`;
    if (join) a += ` stroke-linejoin="${join}"`;
    if (rule) a += ` fill-rule="${rule}"`;
    if (op !== undefined && op < 1) a += ` opacity="${Math.round(op * 100) / 100}"`;
    return a;
  }
  path(pd, o) { this.emit(`<path d="${pd}"${this.attrs(o)}/>`); }
  circle(cx, cy, r, o) { this.emit(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${this.attrs(o)}/>`); }
  rect(x, y, w, h, o) { this.emit(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${this.attrs(o)}/>`); }
  /** A top-level layer: sky, far, mid, near, light. The design system allows 3 to 6. */
  layer(name, fn) { this.layers.push(`<g data-name="${name}">\n${this.capture(fn)}\n</g>`); }
  group(fn, { op } = {}) { this.emit(`<g${op !== undefined ? ` opacity="${op}"` : ''}>${this.capture(fn)}</g>`); }
  /** A part: drawn once in <defs>, placed with use(). */
  part(name, fn) {
    if (!this.parts.has(name)) {
      this.parts.add(name);
      this.defs.push(`<g id="${name}">${this.capture(fn)}</g>`);
    }
    return name;
  }
  /** One placement of a part. `tint` recolours it (a silhouette use); `op` is one layer of opacity. */
  use(name, o = {}) {
    const m = o.tf ?? tfOf(o);
    const ident = m.every((v, i) => v === [1, 0, 0, 1, 0, 0][i]);
    this.emit(`<use href="#${name}"${ident ? '' : ` transform="${mtx(m)}"`}${o.op !== undefined && o.op < 1 ? ` opacity="${o.op}"` : ''}${o.tint ? ` fill="${this.hex(o.tint)}"` : ''}/>`);
  }
  /** A part placed with its paper shadow first: silhouette uses of the same part, offset. */
  cast(name, o = {}, shadow = true) {
    if (shadow) {
      const s = { ...SHADOW, ...(typeof shadow === 'object' ? shadow : {}) };
      const m = o.tf ?? tfOf(o);
      const at = (k, a) => this.use(name, { tf: [m[0], m[1], m[2], m[3], m[4] + s.dx * k, m[5] + s.dy * k], tint: s.colour, op: Math.round(s.op * a * 100) / 100 });
      if (s.soft) for (const [k, a] of SOFT) at(k, a); else at(1, 1);
    }
    this.use(name, o);
  }
  /** A cut-paper shape with its shadow: the path becomes a part, drawn once. */
  cut(name, pd, style, shadow = true) {
    this.part(name, () => this.path(pd, style));
    this.cast(name, {}, shadow);
  }
  lin(x1, y1, x2, y2, stops) { return this.grad(`<linearGradient id="${this.id}-g${this.grads}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">`, 'linearGradient', stops); }
  rad(cx, cy, r, stops) { return this.grad(`<radialGradient id="${this.id}-g${this.grads}" gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}">`, 'radialGradient', stops); }
  grad(open, tag, stops) {
    const id = `${this.id}-g${this.grads++}`;
    this.defs.push(`${open}${stops.map(([o, t, a]) => `<stop offset="${o}" stop-color="${this.hex(t)}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</${tag}>`);
    return `url(#${id})`;
  }
  zone(kind, name, x, y, w, h) { this.zones.push(`<rect data-zone="${kind}" data-name="${name}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`); }
  svg() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by tools/book_scenes.mjs: edit that file and rerun it, not this one. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" data-anchor="top-left">
<desc>${this.desc} Original f-tree work, MIT.</desc>
<defs>
${this.defs.join('\n')}
</defs>
${this.layers.join('\n')}
${this.zones.join('\n')}
</svg>
`;
  }
}

/* ------------------------------------------------------------------------- shared pieces */

/** Stars: three dotted strokes (faint, bright, and a few four-point sparkles as one part). */
function stars(sc, seed, box, count, { avoid, colour = 'flame' } = {}) {
  const rand = seeded(seed);
  const small = [], big = [], spark = [];
  for (let i = 0; i < count; i++) {
    const x = box.x + rand() * box.w, y = box.y + Math.pow(rand(), 1.25) * box.h, k = rand();
    if (avoid && x > avoid.x && x < avoid.x + avoid.w && y > avoid.y && y < avoid.y + avoid.h && k < 0.7) continue;
    (k > 0.965 ? spark : k > 0.8 ? big : small).push([x, y]);
  }
  sc.path(dots(small), { stroke: colour, sw: 1.1, cap: 'round', op: 0.45 });
  sc.path(dots(big), { stroke: colour, sw: 1.9, cap: 'round', op: 0.75 });
  const star = sc.part(`${sc.id}-star`, () => sc.path(String(d().M(0, -10).Q(1.8, -1.8, 7, 0).Q(1.8, 1.8, 0, 10).Q(-1.8, 1.8, -7, 0).Q(-1.8, -1.8, 0, -10).Z()), { fill: colour }));
  for (const [x, y] of spark) sc.use(star, { x, y, s: 0.24 + rand() * 0.16 });
}

/** A sky lantern rising: a paper body lit from below, one faint halo. */
function lanternPart(sc, { halo = false } = {}) {
  return sc.part(halo ? 'lantern-lit' : 'lantern', () => {
    if (halo) for (const [r, a] of [[16, 0.08], [11, 0.1], [7, 0.14]]) sc.circle(0, 0.5, r, { fill: 'gold', op: a });
    sc.path(String(d().M(-4.5, -6).Q(0, -7.5, 4.5, -6).L(3.2, 5.5).Q(0, 6.2, -3.2, 5.5).Z()), { fill: 'saffron' });
    sc.path(String(d().M(-3.8, 0.5).L(3.8, 0.5).L(3.2, 5.5).Q(0, 6.2, -3.2, 5.5).Z()), { fill: 'flame' });
  });
}

/** A mango leaf, pointing right from (0, 0), one unit long. */
function leafPart(sc, name, fill) {
  return sc.part(name, () => sc.path(String(d().M(0, 0).C(3, -3.4, 7, -3, 10, 0).C(7, 3, 3, 3.4, 0, 0).Z()), { fill }));
}

/** A leafy branch reaching in from the page edge: a stroked stem and leaves of one part. */
function branch(sc, pts, seed, { stem, leaf, alt, leaves = 20, size = 16 }) {
  const rand = seeded(seed);
  sc.path(handLine(pts, 1.2, `${seed}s`, 30), { stroke: stem, sw: size * 0.3, cap: 'round' });
  const L = leafPart(sc, `leaf-${leaf}`, leaf);
  for (let i = 0; i < leaves; i++) {
    const t = rand(), k = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1))), u = t * (pts.length - 1) - k;
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    const rot = (rand() - 0.5) * 140 + (rand() > 0.5 ? 30 : -30);
    sc.use(L, { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, sx: size * (0.09 + rand() * 0.08), sy: size * 0.09, rot, tint: alt && i % 3 === 1 ? alt : undefined });
  }
}

/* --------------------------------------------------------------------------------- scenes */

/**
 * The cover's night ghat. Sky (deep to dusk), the far bank (temples, ghat houses with lit arched
 * windows, steps, umbrellas), the river, and the near landing the family sits on. The lamps - one
 * for each person - are the page's to float on the water, in the `lamps` zone.
 */
function ghatNight() {
  const sc = new Scene('ghat-night', 'The cover: the river at night, the far ghat lit, the near landing in shadow. The page floats one lamp for each person in the lamps zone and seats the family in the figures zone.');
  const horizon = 470, base = horizon + 12, river = horizon + 32, bank = 738;
  const title = { x: 90, y: 160, w: 415, h: 180 };

  sc.layer('sky', () => {
    sc.rect(0, 0, W, river, { fill: sc.lin(0, 0, 0, horizon, [[0, 'deep'], [0.36, 'night'], [0.74, 'glow'], [1, 'dusk']]) });
    sc.circle(W / 2, horizon, 400, { fill: sc.rad(W / 2, horizon, 400, [[0, 'saffron', 0.36], [0.4, 'rani', 0.12], [1, 'rani', 0]]) });
    stars(sc, 'ghat-night', { x: 0, y: 70, w: W, h: 330 }, 150, { avoid: title });
    const lantern = lanternPart(sc), lit = lanternPart(sc, { halo: true });
    for (const [x, y, s] of [[120, 356, 7], [482, 236, 8.5], [528, 322, 5], [72, 420, 5], [396, 118, 3.8], [206, 104, 3.4], [452, 398, 4.2]]) sc.use(s > 6 ? lit : lantern, { x, y, s: s / 10 });
  });

  sc.layer('far-bank', () => {
    // temples beyond the houses, in haze: shikharas and domes, no flags
    const shikhara = sc.part('shikhara', () => {
      sc.path(hand([[-50, 0], [-50, -35], [-42, -62], [-24, -84], [-10, -90], [10, -90], [24, -84], [42, -62], [50, -35], [50, 0]], 0.5, 'sh', 12)
        + String(d().M(-16, -90).Q(0, -98, 16, -90).Z()) + String(d().M(-5, -96).Q(0, -106, 5, -96).Z()), { fill: 'haze' });
      sc.path([1, 2, 3, 4, 5].map((i) => { const y = -14 * i, w = 50 * (1 - i * 0.09); return `M${n(-w)} ${y}Q0 ${y - 3} ${n(w)} ${y}`; }).join(''), { stroke: 'glow', sw: 1.2 });
    });
    const dome = sc.part('dome', () => sc.path(String(d().M(-42, 0).L(-42, -30).L(-50, -30).C(-62, -75, -10, -80, 0, -102).C(10, -80, 62, -75, 50, -30).L(42, -30).L(42, 0).Z()), { fill: 'haze' }));
    for (const [x, h, k] of [[26, 58, 'd'], [84, 84, 's'], [196, 66, 'd'], [254, 94, 's'], [322, 56, 'd'], [372, 78, 's'], [470, 88, 's'], [530, 60, 'd'], [582, 76, 's']]) {
      if (k === 's') sc.cast(shikhara, { x, y: horizon - 2, sx: h * 0.0048, sy: h / 100 }, { dx: 1.2, dy: 1.6, op: 0.25 });
      else sc.cast(dome, { x, y: horizon - 2, s: h * 0.008 }, { dx: 1.2, dy: 1.6, op: 0.25 });
    }
    // the ghat houses: one cut roofline, kangura merlons as a dashed stroke along each roof, and
    // arched windows lit here and there - never in a grid
    const rand = seeded('ghat-houses');
    const houses = [[-6, 50, 50], [44, 38, 38], [82, 56, 58], [138, 44, 44], [182, 60, 36], [242, 40, 54], [282, 56, 42], [338, 46, 60], [384, 58, 40], [442, 42, 52], [484, 60, 44], [544, 58, 56]];
    const outline = [[-10, base + 2]];
    for (const [x, w, h] of houses) outline.push([x, base - h], [x + w, base - h]);
    outline.push([W + 10, base - 50], [W + 10, base + 2]);
    const roofs = d(), lit = [], dim = [];
    for (const [x, w, h] of houses) roofs.M(x + 2, base - h - 2).L(x + w - 2, base - h - 2);
    for (const [x, w, h] of houses) {
      const storeys = Math.max(1, Math.floor((h - 10) / 16));
      for (let r = 0; r < storeys; r++) {
        const count = 1 + Math.floor(rand() * Math.max(1, w / 22));
        for (let c = 0; c < count; c++) {
          if (rand() < 0.35) continue;
          const wx = x + 5 + rand() * (w - 14), wy = base - h + 8 + r * 16;
          (rand() < 0.6 ? lit : dim).push(arch(wx, wy, 5, 8));
        }
      }
    }
    sc.part('houses', () => {
      sc.path(poly(outline), { fill: 'glow' });
      sc.path(String(roofs), { stroke: 'glow', sw: 4, dash: [2.6, 3.2] });
      sc.path(lit.join(''), { fill: 'flame' });
      sc.path(dim.join(''), { fill: 'gold' });
    });
    sc.cast('houses', {}, { op: 0.3 });
    const chhatri = sc.part('chhatri', () => sc.path(String(d().M(-42, 0).L(-42, -50).L(-55, -50).L(-45, -58).C(-42, -95, 42, -95, 45, -58).L(55, -50).L(42, -50).L(42, 0).L(32, 0).L(32, -45).L(-32, -45).L(-32, 0).Z()), { fill: 'glow' }));
    for (const [x, y, s] of [[112, base - 58, 14], [312, base - 42, 13], [402, base - 40, 12], [566, base - 56, 15]]) sc.use(chhatri, { x, y, s: s / 100 });
    // the far ghat's steps: four treads as strokes, and what stands on the landing
    for (let i = 0; i < 4; i++) sc.path(line(-10, base + 1 + i * 5.5, W + 10, base + 1 + i * 5.5), { stroke: i % 2 ? 'night' : 'glow', sw: 5.5 });
    sc.path(line(-10, base + 22, W + 10, base + 22), { stroke: 'deep', sw: 1.2, op: 0.6 });
    for (const x of [34, 262, 508]) sc.cast(chhatri, { x, y: base, s: 0.22, tint: 'night' }, { dx: 0.8, dy: 1.2, op: 0.3 });
    const umbrella = sc.part('umbrella', () => {
      sc.path(line(0, 0, 0, -80), { stroke: 'clay', sw: 6 });
      sc.path(String(d().M(-50, -72).Q(-20, -86, 0, -102).Q(20, -86, 50, -72).Q(0, -66, -50, -72).Z()), { fill: 'marigold' });
      sc.path('M0 -100L-48 -70M0 -100L-24 -69M0 -100L0 -68M0 -100L24 -69M0 -100L48 -70', { stroke: 'gold', sw: 4 });
    });
    for (const [x, c] of [[100], [196, 'rani'], [338], [440, 'saffron'], [566, 'rani']]) sc.use(umbrella, { x, y: base, s: 0.16, tint: c });
  });

  sc.layer('river', () => {
    sc.rect(0, river, W, bank - river + 2, { fill: sc.lin(0, river, 0, bank, [[0, 'dusk'], [0.22, 'glow'], [0.6, 'night'], [1, 'deep']]) });
    const boat = sc.part('boat', () => sc.path(String(d().M(-100, 0).Q(0, 30, 100, -20).L(70, 6).Q(0, 20, -75, 10).Z()), { fill: 'deep' }));
    for (const [x, s, f] of [[150, 18], [300, 14, true], [470, 20]]) sc.use(boat, { x, y: river + 1.5, s: s / 100, flip: f });
    // the far bank's lights fall on the water as broken vertical strokes; ripples catch the lamps
    const rand = seeded('ghat-water');
    const refl = d(), rip = d();
    for (let i = 0; i < 44; i++) { const x = rand() * W, y = river + 6 + rand() * 46; refl.M(x, y).L(x, y + 3 + rand() * 10); }
    for (let i = 0; i < 26; i++) {
      const y = river + 10 + Math.pow(rand(), 0.8) * (bank - river - 14), x = rand() * W, l = 10 + ((y - river) / (bank - river)) * 60;
      rip.M(x, y).Q(x + l / 2, y - 1.4, x + l, y);
    }
    sc.path(String(refl), { stroke: 'gold', sw: 1.1, dash: [2.2, 1.6], op: 0.28 });
    sc.path(String(rip), { stroke: 'flame', sw: 0.6, op: 0.14 });
  });

  sc.layer('near-landing', () => {
    sc.cut('landing', bandFrom([[-10, bank + 4], [W + 10, bank - 4]], H + 10, 1, 'land'), { fill: 'glow' }, { dx: 0, dy: -2, op: 0.5, colour: 'deep' });
    sc.path(line(-10, bank + 4, W + 10, bank - 4), { stroke: 'gold', sw: 0.9, op: 0.5 });
    sc.cut('riser', bandFrom([[-10, bank + 28], [W + 10, bank + 24]], H + 10, 0.8, 'riser'), { fill: 'deep' }, { dx: 0, dy: -2.4, op: 0.45, colour: 'night' });
    sc.path(line(-10, bank + 28, W + 10, bank + 24), { stroke: 'gold', sw: 0.8, op: 0.45 });
    sc.path(line(-10, bank + 62, W + 10, bank + 60) + line(-10, bank + 90, W + 10, bank + 88), { stroke: 'dusk', sw: 1.4, op: 0.5 });
    // marigold petals dropped on the steps: two dotted strokes, not a flower each
    const rand = seeded('ghat-petals');
    const pet = [[], []];
    for (let i = 0; i < 16; i++) pet[i % 2].push([300 + rand() * 270, bank + 40 + rand() * 62]);
    sc.path(dots(pet[0]), { stroke: 'saffron', sw: 5, cap: 'round' });
    sc.path(dots(pet[1]), { stroke: 'marigold', sw: 4, cap: 'round' });
  });

  sc.layer('light', () => {
    // the warmth the lamps throw on the water: one glow over the lamps zone, whatever their number
    sc.circle(390, 650, 250, { fill: sc.rad(390, 650, 250, [[0, 'gold', 0.24], [0.45, 'saffron', 0.1], [1, 'saffron', 0]]) });

    branch(sc, [[-20, 70], [30, 110], [58, 170], [66, 250], [50, 330]], 'bl', { stem: 'deep', leaf: 'deep', alt: 'night', leaves: 34, size: 20 });
    branch(sc, [[615, 60], [560, 104], [540, 160], [548, 230]], 'br', { stem: 'deep', leaf: 'deep', alt: 'night', leaves: 28, size: 20 });
  });

  sc.zone('text', 'title', title.x, title.y, title.w, title.h);
  sc.zone('text', 'credit', 16, H - 30, 200, 22);
  sc.zone('busy', 'toran', 0, 0, W, 72);
  sc.zone('busy', 'lamps', 240, river + 12, W - 250, bank - river - 20);
  sc.zone('busy', 'figures', 20, bank - 140, 290, 170);
  sc.zone('busy', 'far-bank', 0, horizon - 100, W, river - horizon + 100);
  return sc;
}

/* ------------------------------------------------------------------ shared day and night */

/**
 * A kangura parapet along y from x1 to x2: square-cut merlons as one dashed stroke, their rounded
 * heads as a dotted one on top. Two paths for any length of wall.
 */
function kangura(sc, x1, x2, y, fill, { w = 9, gap = 5, h = 7 } = {}) {
  const pitch = w + gap, count = Math.floor((x2 - x1) / pitch), start = x1 + ((x2 - x1) - count * pitch + gap) / 2;
  sc.path(line(start, y - h / 2, start + count * pitch, y - h / 2), { stroke: fill, sw: h, dash: [w, gap] });
  sc.path(line(start + w / 2, y - h, start + count * pitch, y - h), { stroke: fill, sw: w, cap: 'round', dash: [0.01, pitch - 0.01] });
}

/** Handmade paper: the flat ground and a few faint fibre clouds, as one translucent layer. */
function paperGround(sc, seed, { h = H } = {}) {
  sc.rect(0, 0, W, h, { fill: 'paper' });
  const rand = seeded(seed);
  sc.group(() => {
    for (let i = 0; i < 5; i++) {
      const cx = rand() * W, cy = rand() * h, rx = 110 + rand() * 150, ry = 70 + rand() * 110;
      sc.path(hand(ellipsePts(cx, cy, rx, ry, 10, rand() * 3), 12, `${seed}c${i}`, 60), { fill: 'paperDeep' });
    }
  }, { op: 0.35 });
}

/** A small bird, wings up: one part. */
const birdPart = (sc, fill) => sc.part(`bird-${fill}`, () => sc.path(String(d().M(-10, -1).Q(-4.5, -5.5, 0, 0).Q(4.5, -5.5, 10, -1).Q(4.5, -3, 0, 1.2).Q(-4.5, -3, -10, -1).Z()), { fill }));

/** A shikhara and a dome as parts, drawn at 100 units tall, in one colour for a far skyline. */
function templeParts(sc, fill, rib) {
  const shikhara = sc.part(`shikhara-${fill}`, () => {
    sc.path(hand([[-50, 0], [-50, -35], [-42, -62], [-24, -84], [-10, -90], [10, -90], [24, -84], [42, -62], [50, -35], [50, 0]], 0.5, 'sh', 12)
      + String(d().M(-16, -90).Q(0, -98, 16, -90).Z()) + String(d().M(-5, -96).Q(0, -106, 5, -96).Z()), { fill });
    sc.path([1, 2, 3, 4, 5].map((i) => { const y = -14 * i, w = 50 * (1 - i * 0.09); return `M${n(-w)} ${y}Q0 ${y - 3} ${n(w)} ${y}`; }).join(''), { stroke: rib, sw: 1.2 });
  });
  const dome = sc.part(`dome-${fill}`, () => sc.path(String(d().M(-42, 0).L(-42, -30).L(-50, -30).C(-62, -75, -10, -80, 0, -102).C(10, -80, 62, -75, 50, -30).L(42, -30).L(42, 0).Z()), { fill }));
  return { shikhara, dome };
}

/** A water tank on a roof: black, banded. 100 units wide. */
const tankPart = (sc) => sc.part('tank', () => {
  sc.path(String(d().M(-50, 0).L(-50, -90).Q(0, -105, 50, -90).L(50, 0).Z()), { fill: 'ink' });
  sc.path('M-50 -22Q0 -16 50 -22M-50 -44Q0 -38 50 -44M-50 -66Q0 -60 50 -66', { stroke: 'inkSoft', sw: 3 });
  sc.rect(-15, -108, 30, 10, { fill: 'inkSoft' });
});

/** A string of festival lights: the cord, and a dotted stroke of bulbs per colour. */
function ladi(sc, x1, y1, x2, y2, sag, colours, { step = 9, halo = true } = {}) {
  const cx = (x1 + x2) / 2, cy = Math.max(y1, y2) + sag;
  sc.path(`M${n(x1)} ${n(y1)}Q${n(cx)} ${n(cy)} ${n(x2)} ${n(y2)}`, { stroke: 'inkSoft', sw: 0.5 });
  const m = Math.round(Math.hypot(x2 - x1, y2 - y1) / step), by = colours.map(() => []), all = [];
  for (let i = 1; i < m; i++) {
    const t = i / m, x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2, y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2 + 2;
    by[i % colours.length].push([x, y]);
    all.push([x, y]);
  }
  if (halo) sc.path(dots(all), { stroke: 'gold', sw: 6.5, cap: 'round', op: 0.16 });
  colours.forEach((c, k) => sc.path(dots(by[k]), { stroke: c, sw: 3, cap: 'round' }));
}

/* ------------------------------------------------------------------------------ banyan */

/**
 * The roots chapter's banyan: a wide canopy of cut leaf masses, aerial roots hanging from its
 * branches to the ground, the trunk on a stone chabutra, and a swing on one root. The page hangs
 * the earliest ancestors' medallions in the `face` zones among the roots.
 */
function banyan() {
  const sc = new Scene('banyan', 'The roots chapter: a banyan on its stone platform, the canopy and the aerial roots. The page hangs ancestors\' medallions in the face zones among the roots.');
  const ground = 668;
  sc.layer('paper', () => paperGround(sc, 'banyan'));

  sc.layer('far', () => {
    // a far bank on the horizon, in the day's haze: the town the family came from
    const { shikhara, dome } = templeParts(sc, 'dayHaze', 'dayMid');
    for (const [x, h, k] of [[40, 56, 'd'], [96, 80, 's'], [498, 86, 's'], [560, 60, 'd']]) sc.use(k === 's' ? shikhara : dome, { x, y: ground - 20, sx: k === 's' ? h * 0.0048 : h * 0.008, sy: k === 's' ? h / 100 : h * 0.008 });
    const roof = [[-10, ground - 20], [-10, ground - 50], [60, ground - 50], [60, ground - 38], [130, ground - 38], [130, ground - 58], [190, ground - 58], [190, ground - 40], [400, ground - 40], [400, ground - 54], [470, ground - 54], [470, ground - 36], [530, ground - 36], [530, ground - 60], [W + 10, ground - 60], [W + 10, ground - 20]];
    sc.path(poly(roof), { fill: 'dayHaze' });
    kangura(sc, 130, 190, ground - 58, 'dayHaze', { w: 5, gap: 4, h: 4 });
    kangura(sc, 530, W, ground - 60, 'dayHaze', { w: 5, gap: 4, h: 4 });
    sc.cut('banyan-bank', bandFrom([[-10, ground - 22], [W + 10, ground - 24]], ground + 40, 0.6, 'bank'), { fill: 'dayMid' }, { op: 0.15 });
  });

  sc.layer('roots-and-trunk', () => {
    // aerial roots: strokes from the branches' undersides, the far ones lighter
    const rand = seeded('banyan-roots');
    const far = d(), near = d();
    for (let i = 0; i < 26; i++) {
      const x = 60 + rand() * 475, top = 330 + rand() * 60, len = 120 + rand() * (ground - top - 110), sway = (rand() - 0.5) * 16;
      (i % 3 ? far : near).M(x, top).C(x + sway, top + len * 0.35, x - sway, top + len * 0.7, x + sway * 0.4, Math.min(ground - 4, top + len));
    }
    sc.path(String(far), { stroke: 'dayMid', sw: 2.2, cap: 'round' });
    sc.path(String(near), { stroke: 'clay', sw: 3, cap: 'round' });
    // pillar roots that reached the ground and thickened into trunks of their own
    sc.cut('pillar', ['M118 360C112 460 126 560 116 666L134 666C140 560 128 470 132 360Z', 'M468 356C476 460 462 560 472 666L488 666C482 560 494 470 484 356Z'].join(''), { fill: 'dayMid' }, { op: 0.18 });
    // the trunk: fluted, flaring at the foot, bark folds as strokes
    sc.cut('trunk', hand([[246, ground - 6], [262, 560], [268, 460], [256, 380], [230, 330], [300, 350], [372, 326], [340, 382], [330, 470], [336, 560], [352, ground - 6]], 1.4, 'trunk', 26), { fill: 'clay' }, { soft: true });
    sc.path('M280 650C286 570 282 470 290 380M306 650C300 560 312 470 306 372M326 648C322 580 318 500 330 420', { stroke: 'dayMid', sw: 2.4, cap: 'round' });
    // the chabutra: two tiers of stone around the foot
    sc.cut('chabutra-low', poly([[150, ground + 26], [446, ground + 26], [434, ground + 4], [162, ground + 4]]), { fill: 'stone' });
    sc.cut('chabutra-top', poly([[196, ground + 6], [400, ground + 6], [390, ground - 12], [206, ground - 12]]), { fill: 'stone' });
    sc.path(line(162, ground + 4, 434, ground + 4) + line(206, ground - 12, 390, ground - 12), { stroke: 'card', sw: 1.6 });
    sc.path(line(172, ground + 15, 424, ground + 15), { stroke: 'clay', sw: 0.8, dash: [18, 3] });
    // a swing hung from a low root, nobody on it
    sc.path('M150 386L152 590M196 384L194 590', { stroke: 'clay', sw: 1.2 });
    sc.cut('swing', poly([[140, 588], [206, 588], [204, 596], [142, 596]]), { fill: 'peacock' }, { dx: 1.2, dy: 1.8, op: 0.25 });
  });

  sc.layer('canopy', () => {
    // one dark mass under everything, then cut leaf clusters, one part in three sizes and tints
    sc.cut('crown', hand([[20, 350], [30, 250], [90, 190], [170, 150], [260, 132], [350, 136], [440, 156], [520, 200], [575, 260], [580, 340], [520, 378], [420, 360], [300, 372], [180, 362], [80, 384]], 6, 'crown', 30), { fill: 'leafDeep' }, { soft: true });
    const blob = sc.part('cluster', () => sc.path(hand(ellipsePts(0, 0, 50, 36, 12), 3, 'cluster', 14), { fill: 'leaf' }));
    const rand = seeded('banyan-canopy');
    const spots = [];
    for (let i = 0; i < 24; i++) {
      const a = rand() * Math.PI, r = Math.sqrt(rand());
      spots.push([297 + Math.cos(a) * 250 * r * (rand() > 0.5 ? 1 : -1), 250 - Math.sin(a) * 90 * r + rand() * 70, 0.5 + rand() * 0.45, i]);
    }
    spots.sort((a, b) => a[1] - b[1]);
    for (const [x, y, k, i] of spots) sc.cast(blob, { x, y, s: k, flip: i % 2 === 1, tint: i % 4 === 1 ? 'leafDeep' : undefined }, { dx: 1.5, dy: 2.2, op: 0.2 });
    // leaf edges: a few single leaves breaking the outline
    const L = leafPart(sc, 'leaf-leaf', 'leaf');
    for (let i = 0; i < 18; i++) {
      const t = i / 18, a = Math.PI * (1 - t);
      sc.use(L, { x: 297 + Math.cos(a) * 270, y: 330 - Math.sin(a) * 200 + rand() * 20, sx: 1.8, sy: 1.6, rot: -a * 57 + (rand() - 0.5) * 60, tint: i % 3 ? undefined : 'leafDeep' });
    }
  });

  sc.layer('near', () => {
    const bird = birdPart(sc, 'inkSoft');
    for (const [x, y, s] of [[92, 116, 0.6], [112, 104, 0.45], [486, 96, 0.5]]) sc.use(bird, { x, y, s });
    // grass at the ground line, as strokes
    const rand = seeded('banyan-grass');
    const g = d();
    for (let i = 0; i < 40; i++) { const x = rand() * W; if (x > 150 && x < 446) continue; g.M(x, ground + 30).Q(x + 2, ground + 22, x + 4 + rand() * 4, ground + 16 + rand() * 6); }
    sc.path(String(g), { stroke: 'leaf', sw: 1.4, cap: 'round' });
  });

  sc.zone('text', 'title', 60, 44, W - 120, 84);
  sc.zone('text', 'story', 70, 712, W - 140, 100);
  sc.zone('busy', 'tree', 20, 130, W - 40, ground - 100);
  sc.zone('busy', 'ground', 0, ground - 60, W, 100);
  // where the ancestors' medallions hang: two tiers among the roots, the eldest highest
  for (const [k, cx, cy] of [[1, 170, 280], [2, 425, 280], [3, 92, 470], [4, 503, 470], [5, 200, 560], [6, 395, 560]]) sc.zone('face', `root-${k}`, cx - 38, cy - 38, 76, 76);
  return sc;
}

/* ------------------------------------------------------------------------------ aangan */

/** A house front's wall, parapet and cornice in one colour, 230 x 240: one part, tinted per house. */
function wallPart(sc, name, fill) {
  return sc.part(name, () => {
    sc.path(bandFrom([[0, 12], [230, 12]], 240, 0.5, `${name}w`, 30), { fill });
    kangura(sc, 2, 228, 13, fill, { w: 10, gap: 5, h: 8 });
  });
}

/**
 * The two-courtyards chapter: the father's side and the mother's side, two doorways across one
 * courtyard floor, the tulsi between them. The page puts each household's people in the
 * `household-*` face zones and their words in `left` and `right`; lamps for names not known go in
 * the `aala-*` zones, in the house's own wall.
 */
function aangan() {
  const sc = new Scene('aangan', 'The two-courtyards chapter: two house fronts across a courtyard floor, a tulsi vrindavan between them. The page places each household\'s people and any aala lamps in the zones.');
  const top = 132, floor = 372;
  sc.layer('paper', () => paperGround(sc, 'aangan'));

  sc.layer('floor', () => {
    sc.cut('floor', poly([[-10, floor - 4], [W + 10, floor - 4], [W + 10, floor + 52], [-10, floor + 52]]), { fill: 'paperDeep' }, { op: 0.15 });
    let t = '';
    for (let i = 0; i < 18; i++) t += line(i * 36 - 20, floor + 52, i * 36 + 6, floor - 4);
    sc.path(t, { stroke: 'stone', sw: 0.6 });
  });

  sc.layer('houses', () => {
    const wall = wallPart(sc, 'aangan-wall', 'stone');
    for (const [x, tint] of [[40], [325, 'wash']]) {
      sc.cast(wall, { x, y: top, tint }, { soft: true });
      sc.rect(x - 4, top + 12, 238, 5, { fill: 'clay' });
    }
    // windows high on each side, under little chhajja eaves
    const eave = sc.part('eave', () => {
      sc.path(String(d().M(-15, 0).L(15, 0).L(17, 5).Q(13.6, 8.5, 10.2, 5).Q(6.8, 8.5, 3.4, 5).Q(0, 8.5, -3.4, 5).Q(-6.8, 8.5, -10.2, 5).Q(-13.6, 8.5, -17, 5).Z()), { fill: 'card' });
    });
    const shutter = sc.part('window-shutter', () => {
      sc.rect(-13, -3, 26, 36, { fill: 'card' });
      sc.rect(-10, 0, 20, 30, { fill: 'ink', op: 0.7 });
      sc.path(poly([[-10, 0], [-3.2, 1.8], [-3.2, 28.2], [-10, 30]]) + poly([[10, 0], [3.2, 1.8], [3.2, 28.2], [10, 30]]), { fill: 'peacock' });
    });
    const jaali = sc.part('window-jaali', () => {
      sc.path(arch(-13, -3, 26, 36), { fill: 'card' });
      sc.path(arch(-10, 0, 20, 30), { fill: 'inkSoft' });
      const pts = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) pts.push([-7.5 + c * 5 + (r % 2) * 2.5 - (c === 3 && r % 2 ? 5 : 0), 11 + r * 5]);
      sc.path(dots(pts), { stroke: 'card', sw: 2.6, cap: 'round' });
    });
    for (const cx of [68, 242]) { sc.cast(shutter, { x: cx, y: top + 44 }, { op: 0.2 }); sc.cast(eave, { x: cx, y: top + 36, tint: 'clay' }, { op: 0.2 }); }
    for (const cx of [353, 527]) { sc.cast(jaali, { x: cx, y: top + 44 }, { op: 0.2 }); sc.cast(eave, { x: cx, y: top + 36 }, { op: 0.2 }); }
    // left: the painted doorway, open, lamplight inside; a mandana border of chalk dots
    const dw = 96, dh = 144, lx = 155 - dw / 2, dy = floor - dh;
    sc.path(arch(lx - 14, dy - 16, dw + 28, dh + 16), { fill: 'clay' });
    sc.path(arch(lx - 7, dy - 8, dw + 14, dh + 8), { fill: 'card' });
    sc.path(arch(lx, dy, dw, dh), { fill: 'saffron' });
    sc.path(arch(lx + 14, dy + 12, dw - 28, dh - 12), { fill: 'gold' });
    sc.path(poly([[lx, dy + dh * 0.3], [lx + dw * 0.3, dy + dh * 0.35], [lx + dw * 0.3, floor], [lx, floor]]) + poly([[lx + dw, dy + dh * 0.3], [lx + dw * 0.7, dy + dh * 0.35], [lx + dw * 0.7, floor], [lx + dw, floor]]), { fill: 'peacock' });
    const md = [];
    for (let i = 0; i < 14; i++) { const a = Math.PI * (i / 13); md.push([155 - Math.cos(a) * (dw / 2 + 11), dy + 30 - Math.sin(a) * 46]); }
    sc.path(dots(md), { stroke: 'card', sw: 2.4, cap: 'round' });
    // mandana rosettes beside the door
    const ros = sc.part('rosette', () => {
      sc.circle(0, 0, 6, { stroke: 'card', sw: 1.4 });
      sc.path(dots([0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos(k * 0.785) * 11, Math.sin(k * 0.785) * 11])), { stroke: 'card', sw: 2.4, cap: 'round' });
    });
    for (const cx of [72, 238]) sc.use(ros, { x: cx, y: top + 150 });
    // right: the closed door of blue-washed wood, studded
    const rx = 440 - dw / 2;
    sc.path(arch(rx - 14, dy - 16, dw + 28, dh + 16), { fill: 'clay' });
    sc.path(arch(rx, dy, dw, dh), { fill: 'indigo' });
    sc.path(line(440, dy + dh * 0.2, 440, floor), { stroke: 'ink', sw: 0.8, op: 0.4 });
    sc.path(line(419, dy + 58, 419, floor - 20) + line(461, dy + 58, 461, floor - 20), { stroke: 'gold', sw: 3.2, cap: 'round', dash: [0.01, 20] });
    // thresholds and a pot of leaves by the open door
    for (const cx of [155, 440]) sc.cut(`step-${cx}`, poly([[cx - dw / 2 - 14, floor], [cx + dw / 2 + 14, floor], [cx + dw / 2 + 10, floor + 6], [cx - dw / 2 - 10, floor + 6]]), { fill: 'clay' }, { op: 0.2 });
    // a string of lights between the houses
    ladi(sc, 262, 150, 333, 150, 16, ['rani', 'marigold', 'peacock', 'gold'], { step: 8 });
  });

  sc.layer('tulsi', () => {
    // the tulsi vrindavan: a stepped planter with a lotus in relief, the plant cut in leaves
    const x = W / 2, base = 406, s = 50;
    sc.cut('vrindavan', poly([[x - s * 0.5, base], [x + s * 0.5, base], [x + s * 0.4, base - s * 0.12], [x + s * 0.36, base - s * 0.12], [x + s * 0.3, base - s * 0.72], [x + s * 0.42, base - s * 0.72], [x + s * 0.36, base - s * 0.82], [x - s * 0.36, base - s * 0.82], [x - s * 0.42, base - s * 0.72], [x - s * 0.3, base - s * 0.72], [x - s * 0.36, base - s * 0.12], [x - s * 0.4, base - s * 0.12]]), { fill: 'clay' });
    sc.path(poly([[x - s * 0.33, base - s * 0.14], [x + s * 0.33, base - s * 0.14], [x + s * 0.28, base - s * 0.7], [x - s * 0.28, base - s * 0.7]]), { fill: 'saffron' });
    sc.path(String(d().M(x - 9, base - 17).Q(x - 8, base - 26, x, base - 30).Q(x + 8, base - 26, x + 9, base - 17).Q(x, base - 20, x - 9, base - 17).Z()) + String(d().M(x - 3, base - 18).Q(x, base - 30, x + 3, base - 18).Z()), { fill: 'card', rule: 'evenodd' });
    sc.path(line(x, base - s * 0.82, x, base - s * 1.34), { stroke: 'leafDeep', sw: 1.6 });
    const leaf = sc.part('tulsi-leaf', () => sc.path(String(d().M(0, 0).C(-5, -3, -4, -9, 0, -12).C(4, -9, 5, -3, 0, 0).Z()), { fill: 'leaf' }));
    const rand = seeded('tulsi');
    for (let i = 0; i < 26; i++) {
      const t = rand(), a = -Math.PI / 2 + (rand() - 0.5) * 2.6 * (1 - t * 0.5), rr = s * (0.08 + t * 0.4);
      sc.use(leaf, { x: x + Math.cos(a) * rr * 0.8, y: base - s * 0.86 + Math.sin(a) * rr, s: 0.55 + (1 - t) * 0.25, rot: (a + Math.PI / 2) * 57 + (rand() - 0.5) * 40, tint: i % 3 ? undefined : 'leafDeep' });
    }
  });

  sc.zone('text', 'title', 60, 44, W - 120, 72);
  sc.zone('busy', 'houses', 30, top - 10, W - 60, floor - top + 60);
  sc.zone('busy', 'toran-left', 155 - 70, floor - 170, 140, 30);
  sc.zone('busy', 'toran-right', 440 - 70, floor - 170, 140, 30);
  // the wall either side of each door, where a page cuts an aala for a name not known
  for (const [k, x] of [['left-1', 46], ['left-2', 222], ['right-1', 330], ['right-2', 507]]) sc.zone('busy', `aala-${k}`, x, floor - 100, 44, 90);
  sc.zone('busy', 'figure', 205, floor - 30, 60, 50);
  sc.zone('face', 'household-left', 40, 434, 240, 120);
  sc.zone('face', 'household-right', 316, 434, 240, 120);
  sc.zone('text', 'left', 40, 580, 240, 80);
  sc.zone('text', 'right', 316, 560, 240, 100);
  sc.zone('text', 'note', 110, 680, W - 220, 100);
  return sc;
}

/* ------------------------------------------------------------------------- haveli lane */

/**
 * The lane at dusk: a house to each household of the wider family, the town beyond, strings of
 * lights, washing and water tanks on the roofs. One facade is drawn once and placed four times;
 * each house takes its own wall colour, door and roof. The page writes a household on each house:
 * its nameplate in `plate-N` and its people in `house-N`.
 */
function haveliLane() {
  const sc = new Scene('haveli-lane', 'Our lane at dusk: four havelis of four colours, one facade drawn once and placed on each, the town beyond. The page names a household on each house in the plate and house zones.');
  const base = 560;
  sc.layer('sky', () => {
    sc.rect(0, 0, W, H, { fill: 'paper' });
    sc.rect(0, 120, W, base - 120, { fill: sc.lin(0, 120, 0, base, [[0, 'paper'], [0.4, 'sky'], [0.75, 'dayHaze'], [1, 'dayMid']]) });
    const bird = birdPart(sc, 'inkSoft');
    for (const [x, y, s] of [[300, 90, 0.6], [318, 80, 0.45], [336, 96, 0.5]]) sc.use(bird, { x, y, s });
    // two kites, their strings running down toward the roofs
    const kite = sc.part('kite', () => {
      sc.path(poly([[0, -13], [11, 0], [0, 13], [-11, 0]]), { fill: 'rani' });
      sc.path(poly([[0, -13], [11, 0], [0, 0]]), { fill: 'marigold' });
      sc.path(poly([[0, 13], [4, 19], [-4, 19]]), { fill: 'marigold' });
    });
    sc.path('M470 137C460 170 466 200 450 230M540 179C534 200 540 220 528 250', { stroke: 'inkSoft', sw: 0.5, op: 0.6 });
    sc.cast(kite, { x: 470, y: 124, rot: 8 }, { op: 0.2 });
    sc.cast(kite, { x: 540, y: 170, s: 0.7, rot: -10, tint: 'peacock' }, { op: 0.2 });
  });

  sc.layer('town', () => {
    const { shikhara, dome } = templeParts(sc, 'dayHaze', 'dayMid');
    for (const [x, h, k] of [[40, 70, 'd'], [120, 110, 's'], [300, 96, 'd'], [392, 124, 's'], [548, 104, 'd']]) sc.use(k === 's' ? shikhara : dome, { x, y: 300, sx: k === 's' ? h * 0.005 : h * 0.008, sy: k === 's' ? h / 100 : h * 0.008 });
    sc.rect(-4, 296, W + 8, 20, { fill: 'dayHaze' });
    const roofs = [[-4, 72, 50], [68, 62, 36], [130, 84, 58], [214, 72, 42], [286, 92, 54], [378, 70, 40], [448, 72, 60], [520, 80, 46]];
    const outline = [[-4, 330]];
    for (const [x, w, h] of roofs) outline.push([x, 312 - h], [x + w, 312 - h]);
    outline.push([W + 4, 330]);
    sc.cut('rooftops', poly(outline), { fill: 'dayMid' }, { op: 0.15 });
    for (const [x, w, h] of roofs) kangura(sc, x + 3, x + w - 3, 312 - h, 'dayMid', { w: 6, gap: 5, h: 4 });
  });

  sc.layer('houses', () => {
    const houses = [
      { x: 14, w: 142, h: 236, fill: 'indigo', door: 'saffron', roof: 'tank' },
      { x: 156, w: 140, h: 262, fill: 'saffron', door: 'peacock', roof: 'none' },
      { x: 296, w: 146, h: 244, fill: 'peacock', door: 'marigold', roof: 'eave' },
      { x: 442, w: 140, h: 272, fill: 'rani', door: 'indigo', roof: 'tank' },
    ];
    // the facade every house shares, 140 wide, drawn up from its door sill at (0, 0)
    const facade = sc.part('facade', () => {
      // storey bands
      sc.path(line(3, -150, 137, -150) + line(3, -96, 137, -96), { stroke: 'card', sw: 1.4 });
      // the upper storey: arched windows either side, a jharokha balcony in the middle
      for (const cx of [26, 114]) { sc.path(arch(cx - 11, -196, 22, 32), { fill: 'card' }); sc.path(arch(cx - 8, -193, 16, 29), { fill: 'inkSoft' }); }
      sc.path(String(d().M(51, -178).C(54, -200, 86, -200, 89, -178).Z()), { fill: 'card' });
      sc.path(arch(56, -186, 28, 34), { fill: 'ink', op: 0.55 });
      sc.path(poly([[50, -152], [90, -152], [86, -146], [54, -146]]), { fill: 'card' });
      sc.path('M57 -158L57 -152M62.5 -158L62.5 -152M68 -158L68 -152M73.5 -158L73.5 -152M79 -158L79 -152M84 -158L84 -152', { stroke: 'card', sw: 1.2 });
      sc.path(line(55, -158, 85, -158), { stroke: 'card', sw: 1.2 });
      // the middle storey: jaali windows under chhajja eaves
      for (const cx of [26, 70, 114]) {
        sc.path(arch(cx - 10, -140, 20, 30), { fill: 'card' });
        sc.path(arch(cx - 7, -137, 14, 27), { fill: 'inkSoft' });
        sc.path(dots([[cx - 3, -124], [cx + 3, -124], [cx, -119], [cx - 3, -114], [cx + 3, -114]]), { stroke: 'card', sw: 2, cap: 'round' });
        sc.path(String(d().M(cx - 14, -146).L(cx + 14, -146).L(cx + 16, -141).Q(cx + 11, -138, cx + 7, -141).Q(cx + 2, -138, cx - 2, -141).Q(cx - 7, -138, cx - 11, -141).Q(cx - 14, -139, cx - 16, -141).Z()), { fill: 'card' });
      }
      // the door: a pointed arch in a card frame, and a plain board above it for a nameplate
      sc.rect(40, -88, 60, 14, { fill: 'card' });
      sc.path(arch(49, -70, 42, 70), { fill: 'card' });
      sc.path(line(70, -50, 70, 0), { stroke: 'ink', sw: 0.6, op: 0.4 });
      sc.path(dots([[60, -38], [60, -28], [60, -18], [80, -38], [80, -28], [80, -18]]), { stroke: 'gold', sw: 2.4, cap: 'round' });
    });
    const doorLeaf = sc.part('door-leaf', () => sc.path(arch(52, -67, 36, 67), { fill: 'peacock' }));
    const tank = tankPart(sc);
    const wall = sc.part('lane-wall', () => sc.path(bandFrom([[0, 0], [140, 0]], 300, 0.5, 'lanewall', 30), { fill: 'stone' }));
    for (const hs of houses) {
      const top = base - hs.h, kx = hs.w / 140;
      sc.cast(wall, { tf: [kx, 0, 0, (hs.h - 8) / 300, hs.x, top + 8], tint: hs.fill }, { soft: true });
      kangura(sc, hs.x + 2, hs.x + hs.w - 2, top + 9, hs.fill, { w: 8, gap: 5, h: 6 });
      sc.rect(hs.x - 2, top + 8, hs.w + 4, 3, { fill: 'card' });
      sc.use(facade, { tf: [kx, 0, 0, 1, hs.x, base] });
      sc.use(doorLeaf, { tf: [kx, 0, 0, 1, hs.x, base], tint: hs.door });
      if (hs.roof === 'tank') sc.cast(tank, { x: hs.x + hs.w * 0.3, y: top + 6, s: 0.21 }, { op: 0.2 });
      if (hs.roof === 'eave') {
        sc.cut('lane-eave', poly([[hs.x - 4, base - 106], [hs.x + hs.w + 4, base - 106], [hs.x + hs.w + 10, base - 97], [hs.x - 10, base - 97]]), { fill: 'card' }, { op: 0.3 });
        sc.path(line(hs.x + 8, base - 94, hs.x + hs.w - 8, base - 94), { stroke: 'card', sw: 5, cap: 'round', dash: [0.01, (hs.w - 16) / 4] });
      }
      // the otla, the raised step at every door
      const bx = hs.x + hs.w / 2;
      sc.path(poly([[bx - 30, base], [bx + 30, base], [bx + 34, base + 7], [bx - 34, base + 7]]), { fill: 'stone' });
    }
    // washing between two roofs, and strings of lights across the lane
    sc.path('M100 330Q140 342 180 304', { stroke: 'inkSoft', sw: 0.5 });
    const cloth = [[112, 334, 'rani'], [128, 336, 'marigold'], [146, 332, 'card'], [162, 322, 'peacock']];
    for (const [x, y, c] of cloth) sc.path(poly([[x - 4, y], [x + 4, y], [x + 3.4, y + 12], [x - 3.4, y + 12]]), { fill: c });
    ladi(sc, -4, 330, 300, 318, 24, ['gold', 'rani', 'marigold', 'peacock', 'flame']);
    ladi(sc, 290, 318, 600, 332, 26, ['flame', 'marigold', 'rani', 'gold']);
    ladi(sc, 20, 408, 580, 404, 18, ['gold', 'peacock', 'rani', 'flame']);
  });

  sc.layer('street', () => {
    sc.cut('street', poly([[-10, base + 7], [W + 10, base + 7], [W + 10, base + 36], [-10, base + 36]]), { fill: 'stone' }, { op: 0.25 });
    sc.path(line(-10, base + 36, W + 10, base + 36), { stroke: 'dayMid', sw: 1.2 });
  });

  sc.zone('text', 'title', 44, 50, 300, 72);
  sc.zone('busy', 'roofs', 10, 280, W - 20, 150);
  sc.zone('busy', 'doors', 10, base - 74, W - 20, 74);
  sc.zone('text', 'footer', 60, 740, W - 120, 30);
  [[14, 142], [156, 140], [296, 146], [442, 140]].forEach(([x, w], i) => {
    sc.zone('text', `plate-${i + 1}`, x + (w * 40) / 140, base - 88, (w * 60) / 140, 14);
    sc.zone('text', `house-${i + 1}`, x + 4, 614, w - 8, 118);
    sc.zone('busy', `doorstep-${i + 1}`, x + w / 2 - 36, base, 72, 34);
  });
  return sc;
}

/* ------------------------------------------------------------------- remembrance night */

/**
 * Still to be found: a long courtyard wall under the night sky, and the courtyard floor. The page
 * cuts an aala into the wall for each name not known (`niches`) and sets the names below. A wall,
 * not a river, so it never reads as the cover again.
 */
function remembranceNight() {
  const sc = new Scene('remembrance-night', 'Still to be found: a courtyard wall under the night sky and the floor before it. The page cuts an aala for each name not known in the niches zone.');
  const wy = 250, wb = 630;
  sc.layer('sky', () => {
    sc.rect(0, 0, W, wy + 20, { fill: sc.lin(0, 0, 0, wy + 20, [[0, 'deep'], [1, 'night']]) });
    stars(sc, 'remember', { x: 0, y: 24, w: W, h: 220 }, 120, { avoid: { x: 60, y: 60, w: W - 120, h: 90 } });
    const lantern = lanternPart(sc), lit = lanternPart(sc, { halo: true });
    for (const [x, y, s] of [[96, 180, 6], [480, 150, 7], [410, 214, 4.5], [170, 226, 4]]) sc.use(s > 5 ? lit : lantern, { x, y, s: s / 10 });
  });

  sc.layer('wall', () => {
    const wall = sc.part('wall', () => {
      sc.path(poly([[-10, wy + 12], [W + 10, wy + 12], [W + 10, wb + 10], [-10, wb + 10]]), { fill: 'glow' });
      kangura(sc, -6, W + 6, wy + 14, 'glow', { w: 17, gap: 10, h: 10 });
    });
    sc.cast(wall, {}, { soft: true, colour: 'deep', op: 0.5 });
    sc.rect(-6, wy + 14, W + 12, 5, { fill: 'night' });
    // a Sanjhi-cut frieze along the wall's head: keri and dots punched through a band of dusk
    const band = [];
    band.push(poly([[-6, wy + 26], [W + 6, wy + 26], [W + 6, wy + 44], [-6, wy + 44]]));
    for (let i = 0; i < 27; i++) {
      const cx = 11 + i * 22, cy = wy + 35;
      band.push(i % 2 ? ring(cx, cy, 2.2) : String(d().M(cx - 6, cy).C(cx - 6, cy - 5, cx + 2, cy - 5.5, cx + 5.5, cy - 1.5).Q(cx + 7.5, cy + 0.5, cx + 4.5, cy + 0.5).C(cx + 1.2, cy + 4.5, cx - 6, cy + 5, cx - 6, cy).Z()));
    }
    sc.path(band.join(''), { fill: 'haze', rule: 'evenodd' });
    // the wall's courses, faint, and its plinth
    sc.path(line(-6, wy + 150, W + 6, wy + 150) + line(-6, wy + 290, W + 6, wy + 290), { stroke: 'night', sw: 1, op: 0.5 });
    sc.cut('plinth', poly([[-10, wb - 18], [W + 10, wb - 18], [W + 10, wb], [-10, wb]]), { fill: 'haze' }, { dx: 0, dy: 2, op: 0.4, colour: 'deep' });
  });

  sc.layer('floor', () => {
    sc.cut('floor', bandFrom([[-10, wb], [W + 10, wb]], H + 10, 0.8, 'rfloor'), { fill: sc.lin(0, wb, 0, H, [[0, 'dusk'], [0.5, 'haze'], [1, 'glow']]) }, { dx: 0, dy: -1.5, op: 0.45, colour: 'deep', soft: true });
    let t = '';
    for (let i = 0; i < 16; i++) t += line(W / 2 + (i - 7.5) * 30, wb, W / 2 + (i - 7.5) * 70, H);
    sc.path(t, { stroke: 'glow', sw: 0.7, op: 0.5 });
    const rand = seeded('remember-petals');
    const pet = [[], []];
    for (let i = 0; i < 14; i++) { const x = 30 + rand() * (W - 60); if (x > 190 && x < 410) continue; pet[i % 2].push([x, 772 + rand() * 50]); }
    sc.path(dots(pet[0]), { stroke: 'saffron', sw: 4.6, cap: 'round' });
    sc.path(dots(pet[1]), { stroke: 'marigold', sw: 3.8, cap: 'round' });
  });

  sc.zone('text', 'title', 60, 58, W - 120, 86);
  sc.zone('busy', 'niches', 40, wy + 50, W - 80, 230);
  sc.zone('text', 'names', 40, wy + 290, W - 80, 70);
  sc.zone('text', 'closing', 60, wb + 26, W - 120, 104);
  sc.zone('busy', 'rangoli', 180, 760, W - 360, 70);
  return sc;
}

/* ------------------------------------------------------------------------- closing sky */

/**
 * The closing night: seen from a rooftop, the town's roofs below and the whole sky above, full of
 * lanterns going up and a few bursts of fireworks. There is no moon: Diwali falls on the new moon.
 * Open sky and a terrace, so it never reads as the cover's river or the remembrance wall.
 */
function closingSky() {
  const sc = new Scene('closing-sky', 'The closing night from a rooftop: the town\'s roofs, a terrace with its jaali parapet, and a sky of rising lanterns and fireworks. No moon: Diwali is the new moon.');
  const roofs = 640, terrace = 716;
  const title = { x: 70, y: 110, w: W - 140, h: 110 }, missing = { x: 80, y: 250, w: W - 160, h: 120 };
  sc.layer('sky', () => {
    sc.rect(0, 0, W, roofs + 20, { fill: sc.lin(0, 0, 0, roofs, [[0, 'deep'], [0.45, 'night'], [0.8, 'indigo'], [1, 'dusk']]) });
    stars(sc, 'closing', { x: 0, y: 20, w: W, h: 420 }, 170, { avoid: { x: title.x, y: title.y, w: title.w, h: missing.y + missing.h - title.y } });
    // fireworks: rings of dots, one dashed circle each, no glow
    const burst = (cx, cy, r, colours) => colours.forEach((c, k) => {
      const rr = r * (1 - k * 0.3), m = Math.round((2 * Math.PI * rr) / (5 + k));
      sc.circle(cx, cy, rr, { stroke: c, sw: 2.6 - k * 0.6, cap: 'round', dash: [0.01, (2 * Math.PI * rr) / m - 0.01] });
    });
    burst(470, 430, 38, ['gold', 'rani', 'flame']);
    burst(112, 448, 30, ['peacock', 'gold', 'flame']);
    burst(540, 70, 24, ['rani', 'flame']);
    burst(50, 60, 20, ['gold', 'flame']);
  });

  sc.layer('lanterns', () => {
    // lanterns rising from the roofs in a slow diagonal, the far ones small
    const lantern = lanternPart(sc), lit = lanternPart(sc, { halo: true });
    const rand = seeded('closing-lanterns');
    let lits = 0;
    for (let i = 0; i < 22; i++) {
      const t = i / 22, x = 60 + t * 470 + (rand() - 0.5) * 90, y = 600 - t * 520 + (rand() - 0.5) * 60, s = 0.9 - t * 0.55 + rand() * 0.2;
      if (x > title.x - 10 && x < title.x + title.w + 10 && y > title.y - 10 && y < missing.y + missing.h + 10) continue;
      const big = s > 0.75 && lits < 3;
      if (big) lits++;
      sc.use(big ? lit : lantern, { x, y, s });
    }
  });

  sc.layer('town', () => {
    const rand = seeded('closing-town');
    const outline = [[-10, roofs + 60]];
    let x = -10;
    const tops = [];
    while (x < W + 10) { const w = 36 + rand() * 50, h = 18 + rand() * 46; outline.push([x, roofs - h], [x + w, roofs - h]); tops.push([x, w, h]); x += w; }
    outline.push([W + 10, roofs + 60]);
    const lit = [];
    for (const [tx, w, h] of tops) for (let k = 0; k < 2; k++) if (rand() < 0.5) lit.push(arch(tx + 6 + rand() * (w - 16), roofs - h + 8 + rand() * (h - 4), 5, 8));
    sc.part('closing-roofs', () => {
      sc.path(poly(outline), { fill: 'night' });
      sc.path(lit.join(''), { fill: 'gold' });
    });
    sc.cast('closing-roofs', {}, { op: 0.3, colour: 'deep' });
    const tank = tankPart(sc);
    for (const [tx, w, h] of tops.filter((_, i) => i % 3 === 1)) sc.use(tank, { x: tx + w * 0.6, y: roofs - h, s: 0.16, tint: 'deep' });
    ladi(sc, 40, roofs - 30, 250, roofs - 44, 20, ['gold', 'rani', 'flame'], { step: 10 });
    ladi(sc, 330, roofs - 38, 560, roofs - 26, 18, ['flame', 'marigold', 'peacock'], { step: 10 });
  });

  sc.layer('terrace', () => {
    // the terrace parapet: a jaali of punched holes, the wall darkest because it is nearest
    const holes = [];
    for (let i = 0; i < 30; i++) {
      const cx = 12 + i * 20;
      holes.push(arch(cx - 5, terrace - 58, 10, 26), ring(cx, terrace - 16, 3));
    }
    // lamplight on the terrace floor, seen through the jaali
    sc.rect(-10, terrace - 72, W + 20, 72, { fill: sc.lin(0, terrace - 72, 0, terrace, [[0, 'dusk'], [1, 'saffron']]) });
    sc.cut('parapet', poly([[-10, terrace - 72], [W + 10, terrace - 72], [W + 10, H + 10], [-10, H + 10]]) + holes.join(''), { fill: 'deep', rule: 'evenodd' }, { dx: 0, dy: -2.2, op: 0.5, colour: 'ink' });
    sc.path(line(-10, terrace - 72, W + 10, terrace - 72), { stroke: 'gold', sw: 0.9, op: 0.5 });
    sc.path(line(-10, terrace - 4, W + 10, terrace - 4), { stroke: 'glow', sw: 3 });
    let tiles = '';
    for (let i = 0; i < 14; i++) tiles += line(W / 2 + (i - 6.5) * 50, terrace, W / 2 + (i - 6.5) * 90, H);
    sc.path(tiles + line(-10, terrace + 50, W + 10, terrace + 50), { stroke: 'glow', sw: 0.8 });
    kangura(sc, -6, W + 6, terrace - 72, 'deep', { w: 12, gap: 8, h: 7 });
  });

  sc.zone('text', 'title', title.x, title.y, title.w, title.h);
  sc.zone('text', 'missing', missing.x, missing.y, missing.w, missing.h);
  sc.zone('text', 'qr', W - 170, terrace + 10, 110, 110);
  sc.zone('text', 'credit', 30, terrace + 40, 300, 60);
  sc.zone('busy', 'town', 0, roofs - 70, W, terrace - roofs + 70);
  return sc;
}

export const SCENES = { 'ghat-night': ghatNight, banyan, aangan, 'haveli-lane': haveliLane, 'remembrance-night': remembranceNight, 'closing-sky': closingSky };

/* ------------------------------------------------------------------------------ the CLI */

async function main(argv) {
  mkdirSync(SCENE_DIR, { recursive: true });
  for (const [id, draw] of Object.entries(SCENES)) {
    const file = path.join(SCENE_DIR, `${id}.svg`);
    writeFileSync(file, draw().svg());
    console.log(`  wrote ${path.relative(repoRoot, file)}`);
  }
  const at = argv.indexOf('--review');
  if (at >= 0) {
    if (!argv[at + 1]) throw new Error('--review needs an output directory');
    // the review paints the compiled library, so compile what was just written first
    execFileSync(process.execPath, [path.join(here, 'book_art.mjs')], { stdio: 'inherit' });
    const { review } = await import('./book_scene_review.mjs');
    await review(argv[at + 1], Object.keys(SCENES));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`book_scenes: ${e.message}`); process.exit(1); });
}
