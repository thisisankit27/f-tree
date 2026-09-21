/*
 * The paper-cut art compiler (#247): authored SVG in, painter-safe Book items out.
 *
 * Designers draw the storybook's scenes, frames, avatars, motifs and ornaments in Inkscape or
 * Figma, under site/book/art/src/papercut/<kind>/<id>.svg. The painters (site/book/svg.js and
 * Android's BookPainter.kt) only ever see what Book format 2 carries: absolute M L C Q Z paths,
 * circles, rects, groups with an opacity and a clip, linear and radial gradients, and symbols
 * placed with `use`. This file closes that gap, once, at build time:
 *
 *   - a small XML reader (no dependencies, like font_metrics.mjs);
 *   - every path command - relative, H/V, S/T, arcs - and every shape - rect, circle, ellipse,
 *     line, polyline, polygon - becomes absolute M L C Q Z, or a native circle/rect where that is
 *     exact; transforms are baked in and coordinates rounded to 0.01;
 *   - every colour becomes a palette TOKEN through src/papercut/swatches.json, and a colour that is
 *     not a swatch fails the build, naming the file, the element and the colour;
 *   - filter, mask, pattern, image, text, style and class are refused, with the reason;
 *   - `data-anchor` (on the root), `<rect data-zone="text|face|busy">` and a frame's
 *     `data-clip` opening are read into the drawing's metadata and never drawn;
 *   - byte budgets per kind fail the build: avatar 2.5 KB, frame 4 KB, scene 40 KB (and 4 KB for a
 *     motif or an ornament).
 *
 * The output is five committed ES modules, site/book/art/papercut/<kind>.js, which
 * site/book/art/index.js imports statically and site/book/art/draw.js places. It is deterministic
 * byte for byte, so `--check` can hold the committed files to their sources.
 *
 *   node tools/book_art.mjs            compile every source and write the modules
 *   node tools/book_art.mjs --check    fail if the modules are stale, or if swatches.json's tokens
 *                                      differ from template.js's PAPERCUT_PALETTE_KEYS
 *   node tools/book_art.mjs --sheet out.svg
 *                                      draw every compiled drawing, with its paper shadow, on one
 *                                      page through svg.js, to look at before committing
 *
 * The contributor workflow is in site/book/art/README.md.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { rect, circle, path as pathItem, group, use, r2, validateBook, PAGE, MAX_SYMBOL_DEPTH } from '../site/book/format.js';
import { PAPERCUT_PALETTE_KEYS } from '../site/book/template.js';
import { anchorPoint } from '../site/book/art/draw.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
export const SRC_DIR = path.join(repoRoot, 'site', 'book', 'art', 'src', 'papercut');
export const OUT_DIR = path.join(repoRoot, 'site', 'book', 'art', 'papercut');

/** Source directory -> the kind each drawing in it is. The output module shares the directory's name. */
export const KINDS = Object.freeze({ scenes: 'scene', avatars: 'avatar', frames: 'frame', motifs: 'motif', ornaments: 'ornament' });

/**
 * Compiled bytes each kind may cost: the drawing, its internal parts and its gradients, as the JSON
 * that crosses Android's WebView bridge. Avatar, frame and scene are the plan's (#247); a motif or
 * an ornament is a small repeated thing and gets a frame's allowance.
 */
export const BUDGETS = Object.freeze({ avatar: 2560, frame: 4096, scene: 40960, motif: 4096, ornament: 4096 });

export class ArtError extends Error {}

/* ------------------------------------------------------------------------------------ XML */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s, fail) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    if (Object.hasOwn(ENTITIES, e)) return ENTITIES[e];
    return fail(`the entity ${m} is not one this reader knows; write the character itself`);
  });
}

/**
 * Reads XML into `{ name, attrs, children, line }` elements (text nodes are `{ text, line }`). Only
 * what an SVG editor writes: elements, attributes, text, comments, CDATA, processing instructions
 * and a DOCTYPE without an internal subset.
 */
export function parseXml(src, file = 'input.svg') {
  const root = { name: '#document', attrs: {}, children: [], line: 1 };
  const stack = [root];
  let i = 0, line = 1;
  const fail = (msg) => { throw new ArtError(`${file}:${line}: ${msg}`); };
  const advance = (to) => { for (let k = i; k < to; k++) if (src.charCodeAt(k) === 10) line++; i = to; };
  const until = (token, what) => { const e = src.indexOf(token, i); if (e < 0) fail(`${what} is never closed`); return e; };
  const OPEN = /<([A-Za-z_][\w:.-]*)/y;
  const ATTR = /\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  const END = /\s*(\/?)>/y;
  const CLOSE = /<\/([A-Za-z_][\w:.-]*)\s*>/y;
  while (i < src.length) {
    const top = stack[stack.length - 1];
    if (src[i] !== '<') {
      const e = src.indexOf('<', i);
      const end = e < 0 ? src.length : e;
      const t = src.slice(i, end);
      if (t.trim()) {
        if (top === root) fail('text outside the <svg> element');
        top.children.push({ text: decode(t, fail), line });
      }
      advance(end);
    } else if (src.startsWith('<!--', i)) advance(until('-->', 'a comment') + 3);
    else if (src.startsWith('<![CDATA[', i)) {
      const e = until(']]>', 'a CDATA section');
      top.children.push({ text: src.slice(i + 9, e), line });
      advance(e + 3);
    } else if (src.startsWith('<?', i)) advance(until('?>', 'a processing instruction') + 2);
    else if (src.startsWith('<!', i)) {
      const e = until('>', 'a declaration');
      if (src.slice(i, e).includes('[')) fail('a DOCTYPE with an internal subset (its own entities) is not read; delete the DOCTYPE');
      advance(e + 1);
    } else if (src[i + 1] === '/') {
      CLOSE.lastIndex = i;
      const m = CLOSE.exec(src);
      if (!m) fail('a malformed closing tag');
      if (top.name !== m[1]) fail(`</${m[1]}> closes <${top.name}>`);
      stack.pop();
      advance(CLOSE.lastIndex);
    } else {
      OPEN.lastIndex = i;
      const m = OPEN.exec(src);
      if (!m) fail('a malformed tag');
      const el = { name: m[1], attrs: {}, children: [], line };
      let at = OPEN.lastIndex;
      for (;;) {
        ATTR.lastIndex = at;
        const a = ATTR.exec(src);
        if (!a) break;
        if (Object.hasOwn(el.attrs, a[1])) fail(`<${el.name}> has the attribute ${a[1]} twice`);
        el.attrs[a[1]] = decode(a[2] ?? a[3], fail);
        at = ATTR.lastIndex;
      }
      END.lastIndex = at;
      const e = END.exec(src);
      if (!e) fail(`<${el.name}>: a malformed attribute or an unclosed tag`);
      if (top === root && root.children.some((c) => c.name)) fail('more than one root element');
      top.children.push(el);
      advance(END.lastIndex);
      if (!e[1]) stack.push(el);
    }
  }
  if (stack.length > 1) throw new ArtError(`${file}: <${stack[stack.length - 1].name}> (line ${stack[stack.length - 1].line}) is never closed`);
  const svg = root.children.find((c) => c.name);
  if (!svg || svg.name !== 'svg') throw new ArtError(`${file}: the root element must be <svg>`);
  return svg;
}

/* ------------------------------------------------------------------------------ geometry */

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** m after n: apply n first, then m. SVG's [a b c d e f]. */
export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const EPS = 1e-9;
/** Rotation, uniform scale, translation and reflection only: circles stay circles, strokes stay even. */
const isSimilarity = (m) => (Math.abs(m[0] - m[3]) < EPS && Math.abs(m[1] + m[2]) < EPS) || (Math.abs(m[0] + m[3]) < EPS && Math.abs(m[1] - m[2]) < EPS);
const isAxisAligned = (m) => Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS;
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export function parseTransform(s, fail) {
  let m = IDENTITY;
  if (s === undefined) return m;
  const re = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/y;
  let at = 0;
  const src = s.trim();
  while (at < src.length) {
    re.lastIndex = at;
    const t = re.exec(src);
    if (!t) fail(`transform "${s}" is not a list of matrix, translate, scale, rotate, skewX or skewY`);
    at = re.lastIndex;
    const n = (t[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
    const want = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] }[t[1]];
    if (!want.includes(n.length)) fail(`transform ${t[1]}(${t[2]}) takes ${want.join(' or ')} numbers`);
    const rad = (deg) => (deg * Math.PI) / 180;
    let k;
    switch (t[1]) {
      case 'matrix': k = n; break;
      case 'translate': k = [1, 0, 0, 1, n[0], n[1] ?? 0]; break;
      case 'scale': k = [n[0], 0, 0, n[1] ?? n[0], 0, 0]; break;
      case 'rotate': {
        const c = Math.cos(rad(n[0])), sn = Math.sin(rad(n[0]));
        k = [c, sn, -sn, c, 0, 0];
        if (n.length === 3) k = mul(mul([1, 0, 0, 1, n[1], n[2]], k), [1, 0, 0, 1, -n[1], -n[2]]);
        break;
      }
      case 'skewX': k = [1, 0, Math.tan(rad(n[0])), 1, 0, 0]; break;
      default: k = [1, Math.tan(rad(n[0])), 0, 1, 0, 0];
    }
    m = mul(m, k);
  }
  return m;
}

/**
 * Path data in any SVG form -> segments with absolute points: ['M', x, y], ['L', x, y],
 * ['C', x1, y1, x2, y2, x, y], ['Q', x1, y1, x, y], ['Z']. H/V become L, S/T become C/Q with the
 * reflected control point, and arcs become cubics.
 */
export function parsePath(d, fail) {
  const src = String(d);
  let i = 0;
  const ws = () => { while (i < src.length && /[\s,]/.test(src[i])) i++; };
  const num = () => {
    ws();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(src);
    if (!m) fail(`path data "${short(src)}": expected a number at character ${i}`);
    i = NUMBER.lastIndex;
    return Number(m[0]);
  };
  const flag = () => {
    ws();
    if (src[i] !== '0' && src[i] !== '1') fail(`path data "${short(src)}": an arc flag must be 0 or 1 (character ${i})`);
    return src[i++] === '1' ? 1 : 0;
  };
  const moreNumbers = () => { ws(); return i < src.length && /[-+.\d]/.test(src[i]); };
  const out = [];
  let x = 0, y = 0, sx = 0, sy = 0, prev = '', cx2 = 0, cy2 = 0, qx = 0, qy = 0;
  ws();
  if (i < src.length && !/[Mm]/.test(src[i])) fail(`path data "${short(src)}" must start with M`);
  while ((ws(), i < src.length)) {
    let cmd = src[i];
    if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(cmd)) fail(`path data "${short(src)}": "${cmd}" is not a path command`);
    i++;
    let first = true;
    do {
      const rel = cmd === cmd.toLowerCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      switch (cmd.toUpperCase()) {
        case 'M': {
          x = ox + num(); y = oy + num();
          if (first) { out.push(['M', x, y]); sx = x; sy = y; } else out.push(['L', x, y]);
          break;
        }
        case 'L': x = ox + num(); y = oy + num(); out.push(['L', x, y]); break;
        case 'H': x = ox + num(); out.push(['L', x, y]); break;
        case 'V': y = (rel ? y : 0) + num(); out.push(['L', x, y]); break;
        case 'C': {
          const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
          out.push(['C', ...a]);
          [cx2, cy2, x, y] = a.slice(2);
          break;
        }
        case 'S': {
          const [rx, ry] = /[CS]/i.test(prev) ? [2 * x - cx2, 2 * y - cy2] : [x, y];
          const a = [ox + num(), oy + num(), ox + num(), oy + num()];
          out.push(['C', rx, ry, ...a]);
          [cx2, cy2, x, y] = a;
          break;
        }
        case 'Q': {
          const a = [ox + num(), oy + num(), ox + num(), oy + num()];
          out.push(['Q', ...a]);
          [qx, qy, x, y] = a;
          break;
        }
        case 'T': {
          [qx, qy] = /[QT]/i.test(prev) ? [2 * x - qx, 2 * y - qy] : [x, y];
          const nx = ox + num(), ny = oy + num();
          out.push(['Q', qx, qy, nx, ny]);
          x = nx; y = ny;
          break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
          const nx = ox + num(), ny = oy + num();
          out.push(...arcToCubics(x, y, rx, ry, rot, large, sweep, nx, ny));
          x = nx; y = ny;
          break;
        }
        default:
          out.push(['Z']);
          x = sx; y = sy;
      }
      prev = cmd;
      if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';
      first = false;
    } while (!/[Zz]/.test(prev) && moreNumbers());
  }
  return out;
}

const short = (s) => (s.length > 40 ? `${s.slice(0, 40)}...` : s);

/** An elliptical arc as cubics (SVG 1.1 F.6.5), at most a quarter turn each. */
export function arcToCubics(x1, y1, rx, ry, rotDeg, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < EPS || ry < EPS) return [['L', x2, y2]];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const at = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const d = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  for (let s = 0; s < n; s++) {
    const a = t1 + s * step, b = a + step;
    const [ax, ay] = at(a), [bx, by] = s === n - 1 ? [x2, y2] : at(b);
    const [dax, day] = d(a), [dbx, dby] = d(b);
    out.push(['C', ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
  }
  return out;
}

const KAPPA = 0.5522847498307936;

function ellipseSegs(cx, cy, rx, ry) {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ];
}

function rectSegs(x, y, w, h, rx, ry) {
  if (!rx || !ry) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    ['M', x + rx, y], ['L', x + w - rx, y],
    ['C', x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry], ['L', x + w, y + h - ry],
    ['C', x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h], ['L', x + rx, y + h],
    ['C', x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry], ['L', x, y + ry],
    ['C', x, y + ry - ky, x + rx - kx, y, x + rx, y], ['Z'],
  ];
}

const mapSegs = (segs, m) => segs.map(([c, ...p]) => {
  const q = [];
  for (let k = 0; k < p.length; k += 2) q.push(...apply(m, p[k], p[k + 1]));
  return [c, ...q];
});

/** The exact bounding box of segments, curve extrema included: [x, y, w, h]. */
export function segBBox(segs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  let px = 0, py = 0, sx = 0, sy = 0;
  const roots = (a, b, c) => {
    if (Math.abs(a) < EPS) return Math.abs(b) < EPS ? [] : [-c / b];
    const disc = b * b - 4 * a * c;
    if (disc < 0) return [];
    const r = Math.sqrt(disc);
    return [(-b + r) / (2 * a), (-b - r) / (2 * a)];
  };
  for (const [c, ...p] of segs) {
    if (c === 'Z') { px = sx; py = sy; continue; }
    if (c === 'M') { sx = p[0]; sy = p[1]; }
    if (c === 'C') {
      for (const axis of [0, 1]) {
        const p0 = axis ? py : px, p1 = p[axis], p2 = p[2 + axis], p3 = p[4 + axis];
        for (const t of roots(3 * (-p0 + 3 * p1 - 3 * p2 + p3), 6 * (p0 - 2 * p1 + p2), 3 * (p1 - p0))) {
          if (t > 0 && t < 1) {
            const u = 1 - t;
            const bez = (a0, a1, a2, a3) => u * u * u * a0 + 3 * u * u * t * a1 + 3 * u * t * t * a2 + t * t * t * a3;
            add(bez(px, p[0], p[2], p[4]), bez(py, p[1], p[3], p[5]));
          }
        }
      }
    } else if (c === 'Q') {
      for (const axis of [0, 1]) {
        const p0 = axis ? py : px, p1 = p[axis], p2 = p[2 + axis];
        const den = p0 - 2 * p1 + p2;
        if (Math.abs(den) > EPS) {
          const t = (p0 - p1) / den;
          if (t > 0 && t < 1) {
            const u = 1 - t;
            add(u * u * px + 2 * u * t * p[0] + t * t * p[2], u * u * py + 2 * u * t * p[1] + t * t * p[3]);
          }
        }
      }
    }
    [px, py] = p.slice(-2);
    add(px, py);
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

/** A number as short as the path grammar allows: rounded to 0.01, no leading zero, no "-0". */
const fmt = (n) => {
  const v = r2(n);
  return String(Object.is(v, -0) ? 0 : v).replace(/^(-?)0\./, '$1.');
};

/**
 * Segments -> the Book's path grammar (format.js pathPoints), minified the way every SVG and
 * Android path parser reads it: a repeated L/C/Q drops its letter, and no separator is written
 * before a minus sign, or before ".5" after a number that already has its point.
 */
export function serialize(segs) {
  let out = '', last = '', prev = null;
  for (const [c, ...p] of segs) {
    const repeat = c === last && c !== 'M' && c !== 'Z';
    if (!repeat) { out += c; prev = null; }
    for (const v of p) {
      const s = fmt(v);
      if (prev !== null && !(s[0] === '-' || (s[0] === '.' && prev.includes('.')))) out += ' ';
      out += s;
      prev = s;
    }
    last = c;
  }
  return out;
}

/* ----------------------------------------------------------------------------- the rules */

const REFUSED = {
  filter: 'the painters draw no filters: cut the effect as shapes (a glow is stacked translucent circles)',
  mask: 'the painters draw no masks: use a clip-path on a <g>, or cut the shape itself',
  pattern: 'the painters draw no patterns: draw the repeated shape once in <defs> and <use> it',
  image: 'art is vector only: no embedded images',
  text: 'no text inside art: the composer sets every word, measured, in the book\'s own fonts',
  tspan: 'no text inside art: the composer sets every word, measured, in the book\'s own fonts',
  textPath: 'no text inside art: the composer sets every word, measured, in the book\'s own fonts',
  style: 'no stylesheets: set fill, stroke and opacity as attributes on each shape',
  script: 'no scripts in art',
  foreignObject: 'no foreign objects in art',
  marker: 'the painters draw no markers: draw the arrowhead or dot as its own shape',
  switch: 'no <switch>: draw one version',
  a: 'no links in art',
  animate: 'no animation in art', animateTransform: 'no animation in art', animateMotion: 'no animation in art', set: 'no animation in art',
};
const REFUSED_ATTRS = {
  class: 'no classes: set fill, stroke and opacity as attributes on each shape (Inkscape: Preferences > Input/Output > SVG output, "presentation attributes"; Figma already exports them)',
  style: 'no style attributes: set fill, stroke and opacity as attributes on each shape (Inkscape: Preferences > Input/Output > SVG output, "presentation attributes"; Figma already exports them)',
  filter: REFUSED.filter,
  mask: REFUSED.mask,
  'mix-blend-mode': 'the painters draw no blend modes',
  'marker-start': REFUSED.marker, 'marker-mid': REFUSED.marker, 'marker-end': REFUSED.marker,
};
const IGNORED = new Set(['title', 'desc', 'metadata']);
const PAINT = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'display', 'visibility', 'clip-rule'];
const BASE = ['id', 'transform', 'data-name', ...PAINT];
const ALLOWED = {
  svg: ['id', 'data-name', ...PAINT, 'viewBox', 'width', 'height', 'x', 'y', 'version', 'preserveAspectRatio', 'data-anchor', 'enable-background'],
  g: [...BASE, 'clip-path', 'data-asset'],
  path: [...BASE, 'd', 'data-clip'],
  rect: [...BASE, 'x', 'y', 'width', 'height', 'rx', 'ry', 'data-zone', 'data-clip'],
  circle: [...BASE, 'cx', 'cy', 'r', 'data-clip'],
  ellipse: [...BASE, 'cx', 'cy', 'rx', 'ry', 'data-clip'],
  line: [...BASE, 'x1', 'y1', 'x2', 'y2'],
  polyline: [...BASE, 'points'],
  polygon: [...BASE, 'points', 'data-clip'],
  defs: ['id'],
  symbol: ['id', 'data-name', ...PAINT],
  use: ['id', 'data-name', 'transform', 'href', 'x', 'y', 'opacity', 'display', 'visibility'],
  linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  stop: ['id', 'offset', 'stop-color', 'stop-opacity'],
  clipPath: ['id', 'clipPathUnits', 'transform'],
};
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const ZONES = new Set(['text', 'face', 'busy']);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const describe = (node) => `<${node.name}${node.attrs?.id ? ` id="${node.attrs.id}"` : ''}> (line ${node.line})`;

/** Refusals and unknown attributes anywhere in the file, used or not, before anything is drawn. */
function vet(node, fail) {
  if (IGNORED.has(node.name) || node.name.includes(':')) return;
  if (Object.hasOwn(REFUSED, node.name)) fail(node, `<${node.name}> is refused: ${REFUSED[node.name]}`);
  if (!Object.hasOwn(ALLOWED, node.name)) fail(node, `<${node.name}> is not something the painters can draw`);
  for (const [k, v] of Object.entries(node.attrs)) {
    if (Object.hasOwn(REFUSED_ATTRS, k)) fail(node, `the ${k} attribute is refused: ${REFUSED_ATTRS[k]}`);
    if (k === 'xlink:href') continue;
    if (k === 'xmlns' || k.startsWith('xmlns:') || k.startsWith('xml:') || (k.includes(':') && !k.startsWith('data-'))) continue;
    if (k === 'opacity' && (node.name === 'svg' || node.name === 'symbol')) fail(node, `opacity on the <${node.name}> is not read: put it on a <g> inside, on the <use>, or pass op when placing the drawing`);
    if (!ALLOWED[node.name].includes(k)) fail(node, `the attribute ${k}="${v}" is not one the compiler reads on <${node.name}>`);
  }
  for (const c of node.children) if (c.name) vet(c, fail);
}

/* -------------------------------------------------------------------------- the compiler */

const DEFAULT_PAINT = Object.freeze({
  fill: '#000000', 'fill-opacity': '1', 'fill-rule': 'nonzero', stroke: 'none', 'stroke-width': '1', 'stroke-opacity': '1',
  'stroke-dasharray': 'none', 'stroke-dashoffset': '0', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '4',
  'clip-rule': 'nonzero', defaultFill: true,
});
const INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'clip-rule'];

/** A swatch table: lower-case "#rrggbb" -> token. */
export function readSwatches(file) {
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new ArtError(`${file}: ${e.message}`); }
  if (doc?.format !== 1 || !doc.swatches || typeof doc.swatches !== 'object') throw new ArtError(`${file}: expected { "format": 1, "swatches": { "#rrggbb": "token" } }`);
  const out = {};
  for (const [hex, token] of Object.entries(doc.swatches)) {
    const h = hex.toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(h)) throw new ArtError(`${file}: "${hex}" is not a #rrggbb colour`);
    if (typeof token !== 'string' || !token) throw new ArtError(`${file}: "${hex}" maps to no token`);
    if (Object.hasOwn(out, h)) throw new ArtError(`${file}: ${h} is listed twice`);
    out[h] = token;
  }
  return out;
}

/** Problems when the swatches' tokens are not exactly template.js's paper-cut palette. */
export function swatchDrift(swatches, keys = PAPERCUT_PALETTE_KEYS) {
  const tokens = new Set(Object.values(swatches));
  const problems = [];
  const missing = keys.filter((k) => !tokens.has(k));
  const extra = [...tokens].filter((t) => !keys.includes(t)).sort();
  if (missing.length) problems.push(`swatches.json has no swatch for the palette token(s) ${missing.join(', ')} that template.js's PAPERCUT_PALETTE_KEYS lists`);
  if (extra.length) problems.push(`swatches.json maps to ${extra.join(', ')}, which template.js's PAPERCUT_PALETTE_KEYS does not list: a template could not colour it`);
  return problems;
}

const hexOf = (s) => {
  const v = s.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
};

function nearest(hex, swatches) {
  const rgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [r, g, b] = rgb(hex);
  let best = null, bestD = Infinity;
  for (const [h, t] of Object.entries(swatches)) {
    const [r2_, g2, b2] = rgb(h);
    const d = (r - r2_) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) { bestD = d; best = `${h} (${t})`; }
  }
  return best;
}

/**
 * Compiles one SVG source.
 * @returns { id, kind, symbols: { <id>: entry, <id>--<part>: { items } }, gradients, assetRefs }
 */
export function compileSvg(src, { file = 'input.svg', id, kind, swatches }) {
  const fail = (node, msg) => { throw new ArtError(`${file}: ${node ? `${describe(node)}: ` : ''}${msg}`); };
  if (!ID.test(id ?? '')) throw new ArtError(`${file}: "${id}" is not a drawing id: name the file in lower case, words joined by single hyphens (diya-unknown.svg)`);
  const root = parseXml(src, file);
  vet(root, fail);

  const byId = new Map();
  (function index(n) {
    if (n.attrs?.id !== undefined) {
      if (byId.has(n.attrs.id)) fail(n, `the id "${n.attrs.id}" is used twice`);
      byId.set(n.attrs.id, n);
    }
    for (const c of n.children ?? []) if (c.name) index(c);
  })(root);

  const numAttr = (node, k, dflt) => {
    const v = node.attrs[k];
    if (v === undefined) {
      if (dflt === undefined) fail(node, `${k} is required`);
      return dflt;
    }
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(px)?\s*$/.exec(v);
    if (!m) fail(node, `${k}="${v}" is not a plain number (write user units, not %, mm or em)`);
    return Number(m[1]);
  };
  const opacityOf = (node, v, k) => {
    if (v === undefined) return 1;
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))(%)?\s*$/.exec(v);
    if (!m) fail(node, `${k}="${v}" is not an opacity`);
    return Math.min(1, Math.max(0, Number(m[1]) / (m[2] ? 100 : 1)));
  };
  const token = (value, node, what, isDefault) => {
    const hex = hexOf(value);
    if (!hex) fail(node, `${what} "${value}" is not a #rrggbb colour: paint with the hexes in swatches.json`);
    if (Object.hasOwn(swatches, hex)) return swatches[hex];
    return fail(node, `${what} ${hex}${isDefault ? ' (SVG\'s default black: nothing sets a fill here)' : ''} is not a swatch in src/papercut/swatches.json; the nearest is ${nearest(hex, swatches)}`);
  };
  const hrefOf = (node) => node.attrs.href ?? node.attrs['xlink:href'];

  const gradients = {};
  const gradientKeys = new Map();
  const parts = {};
  const building = new Set();
  let inPart = 0;   // > 0 while compiling what a <use> draws
  const assetRefs = new Set();
  const zones = [];
  let clip = null;

  /* Gradients: the Book has linear and radial, user-space or (radial on a circle) item-relative. */
  const gradChain = (node) => {
    const chain = [];
    for (let n = node; n; n = hrefOf(n) ? byId.get(hrefOf(n).replace(/^#/, '')) : null) {
      if (chain.includes(n)) fail(node, 'its gradient href chain loops');
      if (!/^(linear|radial)Gradient$/.test(n.name)) fail(node, `href points at ${describe(n)}, not a gradient`);
      chain.push(n);
      if (hrefOf(n) && !byId.has(hrefOf(n).replace(/^#/, ''))) fail(n, `href="${hrefOf(n)}" names nothing in this file`);
    }
    return chain;
  };

  function gradientFor(gnode, m, geom, shapeNode) {
    const chain = gradChain(gnode);
    const attr = (k) => chain.find((n) => n.attrs[k] !== undefined)?.attrs[k];
    const stopsNode = chain.find((n) => n.children.some((c) => c.name === 'stop'));
    const stops = (stopsNode?.children ?? []).filter((c) => c.name === 'stop').map((s) => {
      const o = s.attrs.offset ?? '0';
      const off = /%\s*$/.test(o) ? parseFloat(o) / 100 : parseFloat(o);
      if (!Number.isFinite(off)) fail(s, `offset="${o}" is not a number`);
      const a = opacityOf(s, s.attrs['stop-opacity'], 'stop-opacity');
      const t = token(s.attrs['stop-color'] ?? '#000000', s, 'stop-color', s.attrs['stop-color'] === undefined);
      const stop = [Math.round(Math.min(1, Math.max(0, off)) * 1000) / 1000, t];
      if (a !== 1) stop.push(r2(a));
      return stop;
    });
    if (stops.length < 2) fail(gnode, 'a gradient needs at least two stops (one stop is a solid fill: use the colour)');
    const spread = attr('spreadMethod');
    if (spread !== undefined && spread !== 'pad') fail(gnode, `spreadMethod="${spread}": the painters only pad`);
    const units = attr('gradientUnits') ?? 'objectBoundingBox';
    const gT = parseTransform(attr('gradientTransform'), (msg) => fail(gnode, msg));
    const linear = gnode.name === 'linearGradient';
    const coord = (k, dflt) => {
      const v = attr(k) ?? dflt;
      const pct = /%\s*$/.test(v);
      if (pct && units === 'userSpaceOnUse') {
        fail(gnode, attr(k) === undefined
          ? `${k} is missing, and in userSpaceOnUse SVG would take it as ${v} of the viewport; write it in user units`
          : `${k}="${v}": a percentage in userSpaceOnUse depends on the viewport; write user units`);
      }
      const n = pct ? parseFloat(v) / 100 : Number(v);
      if (!Number.isFinite(n)) fail(gnode, `${k}="${v}" is not a number`);
      return n;
    };
    let def;
    if (units === 'userSpaceOnUse') {
      const t = mul(m, gT);
      if (!isSimilarity(t)) fail(gnode, 'this gradient is skewed or stretched (by gradientTransform or the shape\'s transform); the painters draw gradients without a transform of their own');
      if (linear) {
        const [x1, y1] = apply(t, coord('x1', '0'), coord('y1', '0'));
        const [x2, y2] = apply(t, coord('x2', '100%'), coord('y2', '0'));
        def = { type: 'linear', x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), stops };
      } else {
        const cx = coord('cx', '50%'), cy = coord('cy', '50%');
        if ((attr('fx') !== undefined && coord('fx') !== cx) || (attr('fy') !== undefined && coord('fy') !== cy)) fail(gnode, 'a focal point (fx, fy) off the centre: the painters draw centred radial gradients');
        if (attr('fr') !== undefined && coord('fr') !== 0) fail(gnode, 'fr: the painters draw radial gradients from a point');
        const [x, y] = apply(t, cx, cy);
        def = { type: 'radial', cx: r2(x), cy: r2(y), r: r2(coord('r', '50%') * scaleOf(t)), stops };
      }
    } else if (units === 'objectBoundingBox') {
      if (attr('gradientTransform') !== undefined) fail(gnode, 'gradientTransform on an objectBoundingBox gradient: set gradientUnits="userSpaceOnUse"');
      if (!linear) {
        if (geom.kind !== 'circle') fail(shapeNode, 'a radial gradient in objectBoundingBox units only works on a circle; use gradientUnits="userSpaceOnUse"');
        const cx = coord('cx', '50%'), cy = coord('cy', '50%');
        if ((attr('fx') !== undefined && coord('fx') !== cx) || (attr('fy') !== undefined && coord('fy') !== cy)) fail(gnode, 'a focal point (fx, fy) off the centre: the painters draw centred radial gradients');
        const r4 = (v) => Math.round(v * 10000) / 10000;
        def = { type: 'radial', units: 'item', cx: r4((cx - 0.5) * 2), cy: r4((cy - 0.5) * 2), r: r4(coord('r', '50%') * 2), stops };
      } else {
        const [bx, by, bw, bh] = segBBox(geom.segs);
        const x1 = coord('x1', '0'), y1 = coord('y1', '0'), x2 = coord('x2', '1'), y2 = coord('y2', '0');
        if (!(x1 === x2 || y1 === y2 || Math.abs(bw - bh) < 1e-6)) fail(gnode, 'a diagonal objectBoundingBox gradient on a shape that is not square would change angle in the painters; set gradientUnits="userSpaceOnUse"');
        const [ux1, uy1] = apply(m, bx + x1 * bw, by + y1 * bh);
        const [ux2, uy2] = apply(m, bx + x2 * bw, by + y2 * bh);
        if (!isSimilarity(m)) fail(gnode, 'this gradient is skewed or stretched by the shape\'s transform; the painters draw gradients without a transform of their own');
        def = { type: 'linear', x1: r2(ux1), y1: r2(uy1), x2: r2(ux2), y2: r2(uy2), stops };
      }
    } else fail(gnode, `gradientUnits="${units}" is not userSpaceOnUse or objectBoundingBox`);
    const key = JSON.stringify(def);
    if (!gradientKeys.has(key)) {
      const gid = `${id}-g${gradientKeys.size}`;
      gradientKeys.set(key, gid);
      gradients[gid] = def;
    }
    return { ref: gradientKeys.get(key) };
  }

  const paintOf = (node, parent) => {
    const p = { ...parent };
    for (const k of INHERITED) {
      const v = node.attrs[k];
      if (v !== undefined && v.trim() !== 'inherit') {
        p[k] = v.trim();
        if (k === 'fill') p.defaultFill = false;
      }
    }
    return p;
  };

  const paintValue = (value, node, what, st) => {
    if (value === 'none' || value === 'transparent') return null;
    const url = /^url\(\s*#([^)\s]+)\s*\)/.exec(value);
    if (url) {
      const g = byId.get(url[1]);
      if (!g) fail(node, `${what} url(#${url[1]}) names nothing in this file`);
      if (!/^(linear|radial)Gradient$/.test(g.name)) fail(node, `${what} url(#${url[1]}) is a <${g.name}>, not a gradient`);
      return { grad: g };
    }
    if (value === 'currentColor') fail(node, `${what}="currentColor": write the swatch colour itself`);
    return { token: token(value, node, what, what === 'fill' && st.defaultFill) };
  };

  function geometry(node) {
    const n = (k, d) => numAttr(node, k, d);
    switch (node.name) {
      case 'circle': { const r = n('r', 0); return r > 0 ? { kind: 'circle', cx: n('cx', 0), cy: n('cy', 0), r, segs: ellipseSegs(n('cx', 0), n('cy', 0), r, r) } : null; }
      case 'ellipse': {
        const cx = n('cx', 0), cy = n('cy', 0), rx = n('rx', 0), ry = n('ry', 0);
        if (!(rx > 0 && ry > 0)) return null;
        return rx === ry ? { kind: 'circle', cx, cy, r: rx, segs: ellipseSegs(cx, cy, rx, rx) } : { kind: 'path', segs: ellipseSegs(cx, cy, rx, ry) };
      }
      case 'rect': {
        const x = n('x', 0), y = n('y', 0), w = n('width', 0), h = n('height', 0);
        if (w < 0 || h < 0) fail(node, 'a negative width or height');
        if (!(w > 0 && h > 0)) return null;
        let rx = node.attrs.rx !== undefined ? n('rx') : undefined, ry = node.attrs.ry !== undefined ? n('ry') : undefined;
        rx = Math.min(Math.max(0, rx ?? ry ?? 0), w / 2);
        ry = Math.min(Math.max(0, ry ?? rx ?? 0), h / 2);
        return { kind: 'rect', x, y, w, h, rx, ry, segs: rectSegs(x, y, w, h, rx, ry) };
      }
      case 'line': return { kind: 'path', segs: [['M', n('x1', 0), n('y1', 0)], ['L', n('x2', 0), n('y2', 0)]] };
      case 'polyline': case 'polygon': {
        const v = (node.attrs.points ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
        if (v.length < 4 || v.length % 2) fail(node, 'points must be at least two x,y pairs');
        const segs = [];
        for (let k = 0; k < v.length; k += 2) segs.push([k ? 'L' : 'M', v[k], v[k + 1]]);
        if (node.name === 'polygon') segs.push(['Z']);
        return { kind: 'path', segs };
      }
      default: {
        const segs = parsePath(node.attrs.d ?? '', (msg) => fail(node, msg));
        return segs.length ? { kind: 'path', segs } : null;
      }
    }
  }

  /** One shape, drawn through `m`. */
  function shape(node, m, st) {
    const geom = geometry(node);
    if (!geom) return [];
    // A line has no inside, so SVG never fills one: its fill (even the default black) is moot.
    const fill = node.name === 'line' ? null : paintValue(st.fill, node, 'fill', st);
    let stroke = paintValue(st.stroke, node, 'stroke', st);
    if (stroke?.grad) fail(node, 'a gradient stroke: the painters stroke in one colour');
    if (!fill && !stroke) return [];
    let op = opacityOf(node, node.attrs.opacity, 'opacity');
    const fo = opacityOf(node, st['fill-opacity'], 'fill-opacity'), so = opacityOf(node, st['stroke-opacity'], 'stroke-opacity');
    if (fill && stroke && fo !== so) fail(node, `fill-opacity ${fo} and stroke-opacity ${so} differ: a shape has one opacity in the painters; split it into a filled shape and a stroked one`);
    op *= fill ? fo : so;
    if (op === 0) return [];
    if (st['stroke-dashoffset'] !== '0' && Number(st['stroke-dashoffset']) !== 0) fail(node, 'stroke-dashoffset: the painters start every dash at the path\'s start');
    const join = st['stroke-linejoin'], cap = st['stroke-linecap'];
    if (!['miter', 'round', 'bevel'].includes(join)) fail(node, `stroke-linejoin="${join}" is not miter, round or bevel`);
    if (!['butt', 'round', 'square'].includes(cap)) fail(node, `stroke-linecap="${cap}" is not butt, round or square`);
    if (stroke && join === 'miter' && Number(st['stroke-miterlimit']) !== 4) fail(node, `stroke-miterlimit="${st['stroke-miterlimit']}": the painters use 4; set it to 4, or use a round or bevel join`);
    if (!['nonzero', 'evenodd'].includes(st['fill-rule'])) fail(node, `fill-rule="${st['fill-rule']}" is not nonzero or evenodd`);
    const sw = Number(st['stroke-width']);
    if (stroke && !(sw >= 0)) fail(node, `stroke-width="${st['stroke-width']}" is not a plain number`);
    const dash = st['stroke-dasharray'] === 'none' ? null : st['stroke-dasharray'].split(/[\s,]+/).filter(Boolean).map(Number);
    if (dash && dash.some((v) => !(v >= 0))) fail(node, `stroke-dasharray="${st['stroke-dasharray']}" is not a list of plain numbers`);
    const dashes = dash && (dash.length % 2 ? [...dash, ...dash] : dash);

    // A stroke or a gradient cannot be baked through a skew or a stretch: keep the shape in its own
    // coordinates and let a group carry the transform, as the painters concatenate one.
    let keep = !isSimilarity(m) && (stroke || fill?.grad);
    let bake = keep ? IDENTITY : m;
    let k = scaleOf(bake);
    // SVG draws nothing for a zero-width stroke, but Android draws width 0 as a one-pixel hairline:
    // a stroke that rounds to nothing is no stroke at all.
    if (stroke && r2(sw * (keep ? scaleOf(m) : k)) === 0) {
      stroke = null;
      if (!fill) return [];
      keep = !isSimilarity(m) && !!fill.grad;
      bake = keep ? IDENTITY : m;
      k = scaleOf(bake);
    }
    const style = {
      fill: fill ? (fill.grad ? gradientFor(fill.grad, bake, geom, node) : fill.token) : undefined,
      stroke: stroke?.token,
      sw: stroke ? sw * k : undefined,
      dash: stroke && dashes ? dashes.map((v) => v * k) : undefined,
      op,
    };
    const plainJoins = join === 'miter' && cap === 'butt';
    let item;
    if (geom.kind === 'circle' && isSimilarity(bake) && (cap === 'butt' || !dash)) {
      const [cx, cy] = apply(bake, geom.cx, geom.cy);
      item = circle(cx, cy, geom.r * k, style);
    } else if (geom.kind === 'rect' && isAxisAligned(bake) && plainJoins
      && Math.abs(geom.rx * Math.abs(bake[0]) - geom.ry * Math.abs(bake[3])) < 1e-6) {
      const [x0, y0] = apply(bake, geom.x, geom.y), [x1, y1] = apply(bake, geom.x + geom.w, geom.y + geom.h);
      item = rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), { ...style, r: geom.rx * Math.abs(bake[0]) });
    } else {
      item = pathItem(serialize(mapSegs(geom.segs, bake)), {
        ...style,
        cap: stroke && cap !== 'butt' ? cap : undefined,
        join: stroke && join !== 'miter' ? join : undefined,
        rule: fill && st['fill-rule'] === 'evenodd' ? 'evenodd' : undefined,
      });
    }
    return keep ? [group([item], { tf: m })] : [item];
  }

  const clipFor = (node, m) => {
    const ref = /^url\(\s*#([^)\s]+)\s*\)$/.exec(node.attrs['clip-path'].trim());
    const cp = ref && byId.get(ref[1]);
    if (!cp || cp.name !== 'clipPath') fail(node, `clip-path="${node.attrs['clip-path']}" does not name a <clipPath> in this file`);
    if ((cp.attrs.clipPathUnits ?? 'userSpaceOnUse') !== 'userSpaceOnUse') fail(cp, 'clipPathUnits must be userSpaceOnUse');
    const shapes = cp.children.filter((c) => c.name && !IGNORED.has(c.name));
    if (shapes.length !== 1 || !SHAPES.has(shapes[0].name)) fail(cp, 'a clip is one shape (a path, rect, circle, ellipse or polygon): the painters clip to one path');
    if ((shapes[0].attrs['clip-rule'] ?? cp.attrs['clip-rule'] ?? 'nonzero') !== 'nonzero') fail(shapes[0], 'clip-rule evenodd: the painters clip nonzero');
    const geom = geometry(shapes[0]);
    if (!geom) fail(shapes[0], 'an empty clip would hide everything');
    const t = mul(mul(m, parseTransform(cp.attrs.transform, (msg) => fail(cp, msg))), parseTransform(shapes[0].attrs.transform, (msg) => fail(shapes[0], msg)));
    return serialize(mapSegs(geom.segs, t));
  };

  /*
   * What a <use> draws is compiled once, as a part, in its own coordinates. As in SVG, it inherits
   * paint from the <use> (and so from the <use>'s ancestors), not from where it is defined: the
   * same shape used under two different inherited paints is two parts, `-2` onwards in the order
   * the file uses them.
   */
  const partFor = (target, from, inherited) => {
    const base = `${id}--${String(target.attrs.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
    const paint = JSON.stringify(inherited);
    const variants = Object.keys(parts).filter((k) => parts[k].base === base);
    if (variants.some((k) => parts[k].source !== target)) fail(from, `two shapes' ids both become the part ${base}; rename one`);
    const hit = variants.find((k) => parts[k].paint === paint);
    if (hit) return hit;
    const pid = variants.length ? `${base}-${variants.length + 1}` : base;
    if (parts[pid]) fail(from, `two shapes' ids both become the part ${pid}; rename one`);
    if (building.has(target)) fail(from, `<use> reaches ${describe(target)} through itself`);
    building.add(target);
    inPart++;
    const items = target.name === 'symbol'
      ? target.children.filter((c) => c.name).flatMap((c) => walk(c, IDENTITY, paintOf(target, inherited)))
      : walk(target, IDENTITY, inherited);
    inPart--;
    building.delete(target);
    if (!items.length) fail(target, 'is used, but draws nothing');
    parts[pid] = { source: target, base, paint, items };
    return pid;
  };

  /** A node drawn through the transform `ctm` with the inherited paint `inherited`. */
  function walk(node, ctm, inherited) {
    if (IGNORED.has(node.name) || node.name.includes(':')) return [];
    if (['defs', 'linearGradient', 'radialGradient', 'clipPath', 'symbol', 'stop'].includes(node.name)) return [];
    if (node.attrs.display?.trim() === 'none' || /^(hidden|collapse)$/.test(node.attrs.visibility?.trim() ?? '')) return [];
    const tfail = (msg) => fail(node, msg);
    const m = node.name === 'svg' ? ctm : mul(ctm, parseTransform(node.attrs.transform, tfail));
    const st = paintOf(node, inherited);

    if (inPart && (node.attrs['data-zone'] !== undefined || node.attrs['data-clip'] !== undefined)) {
      fail(node, 'a data-zone or data-clip inside something a <use> draws would be read in the wrong place, once per use: mark it on the drawing itself');
    }
    if (node.attrs['data-zone'] !== undefined) {
      const kind = node.attrs['data-zone'];
      if (!ZONES.has(kind)) fail(node, `data-zone="${kind}" is not text, face or busy`);
      if (!isAxisAligned(m)) fail(node, 'a zone must stay an upright rectangle: take the rotation or skew off it');
      const g = geometry(node);
      if (!g) fail(node, 'an empty zone');
      const [x, y, w, h] = segBBox(mapSegs(g.segs, m));
      zones.push({ kind, x: r2(x), y: r2(y), w: r2(w), h: r2(h) });
      return [];
    }
    if (node.attrs['data-clip'] !== undefined) {
      if (clip) fail(node, 'a second data-clip: a frame has one opening');
      const g = geometry(node);
      if (!g) fail(node, 'an empty opening');
      const segs = mapSegs(g.segs, m);
      clip = { d: serialize(segs), box: segBBox(segs).map(r2) };
      return [];
    }
    if (node.name === 'g' && node.attrs['data-asset'] !== undefined) {
      const ref = node.attrs['data-asset'];
      if (!ID.test(ref)) fail(node, `data-asset="${ref}" is not a drawing id`);
      if (ref === id) fail(node, 'a drawing cannot place itself');
      assetRefs.add(ref);
      const placed = use(ref, { tf: m, op: opacityOf(node, node.attrs.opacity, 'opacity') });
      return [node.attrs['clip-path'] === undefined ? placed : group([placed], { clip: clipFor(node, m) })];
    }
    if (node.name === 'use') {
      const href = hrefOf(node);
      if (!href || !href.startsWith('#')) fail(node, `href="${href ?? ''}": a <use> names a shape in this file (#id); to place another drawing, wrap a copy of it in <g data-asset="its-id">`);
      const target = byId.get(href.slice(1));
      if (!target) fail(node, `href="${href}" names nothing in this file`);
      if (!['g', 'symbol', ...SHAPES].includes(target.name)) fail(node, `href="${href}" names a <${target.name}>, which cannot be drawn`);
      const tf = mul(m, [1, 0, 0, 1, numAttr(node, 'x', 0), numAttr(node, 'y', 0)]);
      return [use(partFor(target, node, st), { tf, op: opacityOf(node, node.attrs.opacity, 'opacity') })];
    }
    if (SHAPES.has(node.name)) return shape(node, m, st);

    // <svg> and <g>
    const items = node.children.filter((c) => c.name).flatMap((c) => walk(c, m, st));
    if (node.children.some((c) => c.text !== undefined)) fail(node, 'holds text');
    if (node.name === 'svg') return items;
    const op = opacityOf(node, node.attrs.opacity, 'opacity');
    const clipD = node.attrs['clip-path'] !== undefined ? clipFor(node, m) : undefined;
    if (!items.length) return [];
    if (clipD === undefined && op === 1) return items;
    // One item under an opacity is that item at that opacity, exactly: no group needed.
    if (clipD === undefined && items.length === 1) {
      const it = { ...items[0] };
      const o = r2((it.op ?? 1) * op);
      if (o === 1) delete it.op; else it.op = o;
      return [it];
    }
    return [group(items, { clip: clipD, op })];
  }

  if (root.attrs.viewBox === undefined) fail(root, 'the <svg> needs a viewBox: it is the drawing\'s own coordinate box, which draw.js scales onto the page');
  const vb = root.attrs.viewBox.trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !vb.every(Number.isFinite) || !(vb[2] > 0 && vb[3] > 0)) fail(root, `viewBox="${root.attrs.viewBox}" is not four numbers with a positive size`);
  let anchor = [vb[0] + vb[2] / 2, vb[1] + vb[3] / 2];
  const da = root.attrs['data-anchor'];
  if (da !== undefined) {
    const pt = da.trim().split(/[\s,]+/);
    try {
      anchor = pt.length === 2 && pt.every((v) => Number.isFinite(Number(v)) && v !== '') ? pt.map(Number) : anchorPoint(vb, da.trim());
    } catch (e) { fail(root, `data-anchor="${da}": ${e.message.replace(/^art: /, '')}`); }
  }
  const items = walk(root, IDENTITY, DEFAULT_PAINT);
  if (!items.length) fail(root, 'draws nothing');

  const entry = { kind, vb: vb.map(r2), anchor: anchor.map(r2) };
  if (zones.length) entry.zones = zones;
  if (clip) { entry.clip = clip.d; entry.opening = clip.box; }
  entry.items = items;
  const symbols = { [id]: entry };
  for (const pid of Object.keys(parts).sort()) symbols[pid] = { items: parts[pid].items };
  return { id, kind, file, symbols, gradients, assetRefs: [...assetRefs].sort() };
}

/* ------------------------------------------------------------------------- the whole set */

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');

/**
 * How many bytes a compiled drawing costs a book that uses it: its items, its parts' items and its
 * gradients - what crosses the WebView bridge in `book.symbols` and `book.defs`. The placement
 * metadata (viewBox, anchor, zones, a frame's opening) stays in the composer and is not counted.
 */
export const costOf = (c) => bytes(Object.values(c.symbols).map((s) => s.items)) + bytes(c.gradients);

/** Every token and gradient a symbol's items name, as a check that nothing dangles. */
function tokensIn(items, out = new Set()) {
  for (const it of items) {
    if (typeof it.fill === 'string') out.add(it.fill);
    if (it.stroke) out.add(it.stroke);
    if (it.t === 'group') tokensIn(it.items, out);
  }
  return out;
}

/**
 * Compiles every source under `srcDir` into the five module texts. Every drawing's problems are
 * collected before failing, so one run names them all.
 */
export function compileAll(srcDir = SRC_DIR, { swatches, keys = PAPERCUT_PALETTE_KEYS } = {}) {
  const errors = [];
  swatches ??= readSwatches(path.join(srcDir, 'swatches.json'));
  errors.push(...swatchDrift(swatches, keys));
  const compiled = [];
  for (const dir of Object.keys(KINDS)) {
    const full = path.join(srcDir, dir);
    const files = existsSync(full) ? readdirSync(full).filter((f) => f.endsWith('.svg')).sort() : [];
    for (const f of files) {
      const file = `${dir}/${f}`;
      try {
        compiled.push(compileSvg(readFileSync(path.join(full, f), 'utf8'), { file, id: f.slice(0, -4), kind: KINDS[dir], swatches }));
      } catch (e) {
        if (!(e instanceof ArtError)) throw e;
        errors.push(e.message);
      }
    }
  }
  const byId = new Map();
  for (const c of compiled) {
    if (byId.has(c.id)) errors.push(`${c.file}: the id "${c.id}" is taken by ${byId.get(c.id).file}; drawing ids are shared by every kind`);
    else byId.set(c.id, c);
  }
  for (const c of compiled) {
    for (const ref of c.assetRefs) if (!byId.has(ref)) errors.push(`${c.file}: data-asset="${ref}" names no drawing under src/papercut/`);
    const cost = costOf(c), budget = BUDGETS[c.kind];
    if (cost > budget) errors.push(`${c.file}: compiles to ${cost} bytes, over the ${c.kind} budget of ${budget} (${budget / 1024} KB). Draw repeated shapes once and <use> them, and simplify paths`);
  }
  if (!errors.length) {
    // Every drawing must be a book a painter can draw: build one per drawing and validate it.
    const symbols = {}, gradients = {};
    for (const c of compiled) { Object.assign(symbols, c.symbols); Object.assign(gradients, c.gradients); }
    const hex = '#000000';
    const paint = (items) => items.map((it) => {
      const o = { ...it };
      if (typeof o.fill === 'string') o.fill = hex;
      if (o.stroke) o.stroke = hex;
      if (o.t === 'group') o.items = paint(o.items);
      return o;
    });
    const all = Object.fromEntries(Object.entries(symbols).map(([k, s]) => [k, { items: paint(s.items) }]));
    const defs = Object.fromEntries(Object.entries(gradients).map(([k, g]) => [k, { ...g, stops: g.stops.map(([o, , a]) => (a === undefined ? [o, hex] : [o, hex, a])) }]));
    for (const c of compiled) {
      const book = { format: 2, size: { ...PAGE }, fonts: {}, defs, symbols: all, pages: [{ label: c.id, items: [use(c.id)] }] };
      const problems = validateBook(book);
      if (problems.length) errors.push(`${c.file}: the painters could not draw it: ${problems.slice(0, 5).join('; ')} (MAX_SYMBOL_DEPTH is ${MAX_SYMBOL_DEPTH})`);
      for (const s of Object.values(c.symbols)) for (const t of tokensIn(s.items)) if (!keys.includes(t)) errors.push(`${c.file}: token ${t} is not in the paper-cut palette`);
      for (const g of Object.values(c.gradients)) for (const [, t] of g.stops) if (!keys.includes(t)) errors.push(`${c.file}: gradient token ${t} is not in the paper-cut palette`);
    }
  }
  if (errors.length) throw new ArtError(errors.join('\n'));
  const modules = {};
  for (const [dir, kind] of Object.entries(KINDS)) {
    const mine = compiled.filter((c) => c.kind === kind).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    modules[dir] = renderModule(dir, mine);
  }
  return { modules, report: compiled.map((c) => ({ file: c.file, bytes: costOf(c), budget: BUDGETS[c.kind] })) };
}

function renderModule(dir, compiled) {
  const header = '// generated by tools/book_art.mjs — do not edit.\n'
    + `// Compiled from site/book/art/src/papercut/${dir}/*.svg; regenerate with: node tools/book_art.mjs\n`
    + '// Colours are palette tokens (template.js PAPERCUT_PALETTE_KEYS); art/draw.js resolves them.\n';
  const map = (entries) => (entries.length ? `{\n${entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join('')}}` : '{}');
  const symbols = compiled.flatMap((c) => Object.entries(c.symbols));
  const gradients = compiled.flatMap((c) => Object.entries(c.gradients));
  return `${header}export const symbols = ${map(symbols)};\nexport const gradients = ${map(gradients)};\n`;
}

/* ------------------------------------------------------------------------------ the sheet */

/** Every compiled drawing, placed with its paper shadow, painted by svg.js: one page to look at. */
export async function sheet(swatches) {
  const { createArt } = await import('../site/book/art/draw.js');
  const { LIBRARY } = await import('../site/book/art/index.js');
  const { paintPage } = await import('../site/book/svg.js');
  const { rect: r, text: t } = await import('../site/book/format.js');
  const P = Object.fromEntries(Object.entries(swatches).map(([h, tok]) => [tok, h]));
  const defs = {};
  const art = createArt({ P, gradient: (gid, def) => { defs[gid] = def; return { ref: gid }; } }, LIBRARY);
  const ids = Object.keys(LIBRARY.symbols).filter((k) => LIBRARY.symbols[k].vb).sort();
  const items = [r(0, 0, PAGE.w, PAGE.h, { fill: P.paper })];
  const cols = 3, cw = (PAGE.w - 60) / cols, ch = 190;
  ids.forEach((aid, i) => {
    const x = 30 + (i % cols) * cw, y = 40 + Math.floor(i / cols) * ch;
    const [, , vw, vh] = LIBRARY.symbols[aid].vb;
    const k = Math.min((cw - 30) / vw, (ch - 50) / vh);
    items.push(art.place(aid, { x: x + cw / 2, y: y + (ch - 40) / 2, s: k, anchor: 'center', shadow: LIBRARY.symbols[aid].kind === 'frame' ? 'soft' : true }));
    items.push(t(x + cw / 2, y + ch - 18, aid, 'text', 9, P.inkSoft, { align: 'middle' }));
  });
  const book = { format: 2, size: { ...PAGE }, fonts: { text: 'book_text' }, defs, symbols: art.symbols(), pages: [{ label: 'art sheet', items }] };
  const problems = validateBook(book);
  if (problems.length) throw new ArtError(`the sheet does not validate: ${problems.join('; ')}`);
  return paintPage(book, 0, { photo: () => null, font: (k) => k });
}

/* -------------------------------------------------------------------------------- the CLI */

async function main(argv) {
  const check = argv.includes('--check');
  const sheetAt = argv.indexOf('--sheet');
  let result;
  try {
    result = compileAll();
  } catch (e) {
    if (!(e instanceof ArtError)) throw e;
    console.error(`book_art: the art does not compile:\n  ${e.message.split('\n').join('\n  ')}`);
    return 1;
  }
  for (const { file, bytes: b, budget } of result.report) console.log(`  ${String(b).padStart(6)} / ${budget}  ${file}`);
  if (sheetAt >= 0) {
    const out = argv[sheetAt + 1];
    if (!out) { console.error('book_art: --sheet needs an output path'); return 1; }
    writeFileSync(out, await sheet(readSwatches(path.join(SRC_DIR, 'swatches.json'))));
    console.log(`  wrote ${out}`);
    return 0;
  }
  let stale = 0;
  const expected = new Set(Object.keys(result.modules).map((d) => `${d}.js`));
  for (const [dir, text] of Object.entries(result.modules)) {
    const out = path.join(OUT_DIR, `${dir}.js`);
    const rel = path.relative(repoRoot, out);
    if (check) {
      const existing = existsSync(out) ? readFileSync(out, 'utf8') : null;
      if (existing === text) console.log(`  ok    ${rel}`);
      else { stale++; console.log(existing === null ? ` FAIL   ${rel} is missing` : ` FAIL   ${rel} is stale: regenerate with 'node tools/book_art.mjs'`); }
    } else {
      writeFileSync(out, text);
      console.log(`  wrote ${rel}`);
    }
  }
  for (const f of existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []) {
    if (f.endsWith('.js') && !expected.has(f)) { stale++; console.log(` FAIL   site/book/art/papercut/${f} is not a kind the compiler writes: delete it`); }
  }
  if (check && stale) { console.log(`\n${stale} art module(s) out of date.`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
