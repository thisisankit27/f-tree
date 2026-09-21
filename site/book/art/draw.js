/*
 * Placing compiled paper-cut art on a page (#247).
 *
 * The art under art/papercut/ is compiled by tools/book_art.mjs from authored SVG: every shape is
 * already a Book item (format.js), but its colours are palette TOKENS ('clay', 'gold'), not
 * colours, so one drawing serves every template. This module is the only thing a page needs to
 * draw that art. It turns tokens into the template's colours, turns a placement into a `use`, casts
 * the paper shadow, and remembers which symbols the book has used so that `book.symbols` carries
 * those and nothing else.
 *
 *   const art = createArt(ctx, LIBRARY);          // once per book; index.js does this for you
 *   items.push(art.place('diya', { x, y, w: 24, shadow: true }));
 *   items.push(art.frame('arch-jharokha', box, innerItems));
 *   book.symbols = art.symbols();                // undefined when nothing was placed
 *
 * Every coordinate a caller passes or gets back is in page points. A drawing's own units (its
 * viewBox) never leak out of here.
 *
 * Composer code: deterministic, no clock, no locale, no DOM, static relative imports only.
 */

import { use, group, r2 } from '../format.js';

/** Book symbol ids for compiled art are `pc-<asset id>`, so they never meet a procedural symbol's. */
export const SYMBOL_PREFIX = 'pc-';

/**
 * The paper shadow (docs/book-design-system.md): the same shape, offset down and to the right, in
 * ink at about a fifth opacity. `soft` is the lightbox shadow, three offsets fading out, for a layer
 * that stands well off the one behind it (a frame, a band).
 */
export const SHADOW = Object.freeze({ dx: 1.7, dy: 2.3, op: 0.22, colour: 'ink' });
const SOFT = [[3, 0.35], [2, 0.3], [1, 0.45]];

const ANCHOR_X = { left: 0, center: 0.5, right: 1 };
const ANCHOR_Y = { top: 0, center: 0.5, bottom: 1 };

/**
 * A named anchor ('bottom-center', 'top-left', 'center', ...) or an explicit point, as a point in
 * the drawing's viewBox units. Shared with tools/book_art.mjs, which reads `data-anchor` with it.
 */
export function anchorPoint(vb, anchor) {
  const [vx, vy, vw, vh] = vb;
  if (Array.isArray(anchor)) {
    if (anchor.length !== 2 || !anchor.every(Number.isFinite)) throw new Error(`art: anchor ${JSON.stringify(anchor)} is not an [x, y] point`);
    return [anchor[0], anchor[1]];
  }
  const name = anchor === 'center' ? 'center-center' : String(anchor);
  const [v, h] = name.split('-');
  if (!(v in ANCHOR_Y) || !(h in ANCHOR_X) || name.split('-').length !== 2) {
    throw new Error(`art: anchor "${anchor}" is not one of top|center|bottom-left|center|right, "center", or an [x, y] point`);
  }
  return [vx + vw * ANCHOR_X[h], vy + vh * ANCHOR_Y[v]];
}

/** Maps a compiled path's points through an affine. Compiled paths hold only M L C Q Z, all pairs. */
export function mapPath(d, [a, b, c, dd, e, f]) {
  let out = '';
  let pending = null;
  for (const m of String(d).matchAll(/([MLCQZ])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
    if (m[1]) { out += m[1]; continue; }
    const n = Number(m[2]);
    if (pending === null) { pending = n; continue; }
    const x = pending, y = n;
    pending = null;
    if (!/[MLCQ]$/.test(out)) out += ' ';
    out += `${r2(a * x + c * y + e)} ${r2(b * x + dd * y + f)}`;
  }
  if (pending !== null) throw new Error(`art: path data ${d} holds an odd count of numbers`);
  return out;
}

/**
 * @param ctx      the composer's context, or anything with the same two members:
 *                 `P` the template's palette (token -> "#rrggbb") and `gradient(id, def)`, which
 *                 files a gradient in the book's defs and returns `{ ref }`.
 * @param library  `{ symbols, gradients }` as index.js merges it from art/papercut/*.js.
 */
export function createArt(ctx, library) {
  const P = ctx.P;
  const used = new Map();   // book symbol id -> { items } once resolved, null while resolving

  const colour = (token, what) => {
    if (typeof token !== 'string' || !Object.hasOwn(P, token)) throw new Error(`art: ${what} uses the palette token "${token}", which this template's palette does not define`);
    return P[token];
  };

  const gradientRef = (ref, what) => {
    if (!Object.hasOwn(library.gradients, ref)) throw new Error(`art: ${what} fills with gradient "${ref}", which the art library does not hold - rerun node tools/book_art.mjs`);
    const g = library.gradients[ref];
    const stops = g.stops.map(([o, t, a]) => (a === undefined ? [o, colour(t, `gradient ${ref}`)] : [o, colour(t, `gradient ${ref}`), a]));
    return ctx.gradient(SYMBOL_PREFIX + ref, { ...g, stops });
  };

  const resolve = (items, what) => items.map((it) => {
    const o = { ...it };
    if (typeof o.fill === 'string') o.fill = colour(o.fill, what);
    else if (o.fill && typeof o.fill === 'object') o.fill = gradientRef(o.fill.ref, what);
    if (o.stroke !== undefined) o.stroke = colour(o.stroke, what);
    if (o.t === 'group') o.items = resolve(o.items, what);
    if (o.t === 'use') o.ref = add(o.ref);
    return o;
  });

  /** Files a symbol, and every symbol it uses, into the book. Returns its book id. */
  function add(id) {
    const bookId = SYMBOL_PREFIX + id;
    if (used.has(bookId)) return bookId;
    if (!Object.hasOwn(library.symbols, id)) throw new Error(`art: no drawing called "${id}" - the ids are the file names under art/src/papercut/`);
    used.set(bookId, null);
    used.set(bookId, { items: resolve(library.symbols[id].items, `"${id}"`) });
    return bookId;
  }

  /** A whole drawing (not one of its internal parts), with its viewBox. */
  function drawing(id) {
    const s = Object.hasOwn(library.symbols, id) ? library.symbols[id] : null;
    if (!s) throw new Error(`art: no drawing called "${id}" - the ids are the file names under art/src/papercut/`);
    if (!s.vb) throw new Error(`art: "${id}" is a part of another drawing, not a drawing to place`);
    return s;
  }

  /**
   * Where a placement puts a drawing: the affine that maps its viewBox onto the page, and the box
   * the viewBox lands in. Size by exactly one of `w`, `h` (points) or `s` (points per viewBox unit,
   * 1 by default). The anchor - the drawing's own, or `anchor` - lands on (x, y). `flip` mirrors the
   * drawing inside that same box: 'x' (or true) left-right, 'y' top-bottom, 'xy' both.
   */
  function layout(id, o = {}) {
    const a = drawing(id);
    const [vx, vy, vw, vh] = a.vb;
    const given = ['w', 'h', 's'].filter((k) => o[k] !== undefined);
    if (given.length > 1) throw new Error(`art: place "${id}" with one of w, h or s, not ${given.join(' and ')}`);
    const k = o.w !== undefined ? o.w / vw : o.h !== undefined ? o.h / vh : (o.s ?? 1);
    if (!(k > 0) || !Number.isFinite(k)) throw new Error(`art: "${id}" would be drawn at scale ${k}`);
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) throw new Error(`art: place "${id}" at a point: x and y are required numbers`);
    const [ax, ay] = o.anchor === undefined ? a.anchor : anchorPoint(a.vb, o.anchor);
    const box = { x: o.x - k * (ax - vx), y: o.y - k * (ay - vy), w: k * vw, h: k * vh };
    const flip = o.flip === true ? 'x' : (o.flip || '');
    if (!/^(x|y|xy|yx)?$/.test(flip)) throw new Error(`art: flip "${o.flip}" is not x, y or xy`);
    const fx = flip.includes('x'), fy = flip.includes('y');
    const tf = [
      fx ? -k : k, 0, 0, fy ? -k : k,
      fx ? box.x + k * (vw + vx) : box.x - k * vx,
      fy ? box.y + k * (vh + vy) : box.y - k * vy,
    ];
    return { a, tf, box };
  }

  const shadowOf = (shadow) => {
    if (!shadow) return null;
    const s = shadow === true ? { ...SHADOW } : shadow === 'soft' ? { ...SHADOW, soft: true } : { ...SHADOW, ...shadow };
    for (const k of ['dx', 'dy', 'op']) if (!Number.isFinite(s[k])) throw new Error(`art: shadow.${k} is not a number`);
    return s;
  };

  /** The drawing through `tf`, its shadow (if any) first: one `use`, or a group of shadow and art. */
  function drawAt(id, tf, { shadow, tint, op } = {}) {
    const ref = add(id);
    const art = use(ref, { tf, fill: tint === undefined ? undefined : colour(tint, `the tint on "${id}"`), op });
    const s = shadowOf(shadow);
    if (!s) return art;
    const ink = colour(s.colour, `the shadow of "${id}"`);
    const cast = (k, a) => use(ref, { tf: [tf[0], tf[1], tf[2], tf[3], tf[4] + s.dx * k, tf[5] + s.dy * k], fill: ink, op: s.op * a });
    const shadows = s.soft ? SOFT.map(([k, a]) => cast(k, a)) : [cast(1, 1)];
    return group([...shadows, art]);
  }

  return {
    /** Whether the library holds a drawing by this id. */
    has: (id) => Object.hasOwn(library.symbols, id) && !!library.symbols[id].vb,

    /**
     * Places a drawing. `{ x, y, w | h | s, anchor, flip, shadow, tint, op }`:
     *   shadow  true (the paper shadow), 'soft' (the lightbox shadow), or { dx, dy, op, soft, colour }
     *           to override any part of SHADOW. Offsets are page points, not drawing units.
     *   tint    a palette token: the whole drawing in that one colour (silhouette mode).
     *   op      one opacity over the whole drawing, as a layer.
     * Returns one item: a `use`, or with a shadow a group of the shadow's uses and the drawing's.
     */
    place(id, o = {}) {
      return drawAt(id, layout(id, o).tf, o);
    },

    /** The box, in page points, that a placement puts the drawing's viewBox in. Draws nothing. */
    box(id, o = {}) {
      const { box } = layout(id, o);
      return { x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h) };
    },

    /**
     * The drawing's marked zones (`data-zone` in its source) where a placement puts them, in page
     * points: `[{ kind: 'text' | 'face' | 'busy', x, y, w, h }]`. Words may sit in a text zone and
     * never on a busy one; a face zone is where a face would be. Draws nothing.
     */
    zones(id, o = {}) {
      const { a, tf } = layout(id, o);
      return (a.zones ?? []).map(({ kind, x, y, w, h }) => {
        const x0 = tf[0] * x + tf[4], x1 = tf[0] * (x + w) + tf[4];
        const y0 = tf[3] * y + tf[5], y1 = tf[3] * (y + h) + tf[5];
        return { kind, x: r2(Math.min(x0, x1)), y: r2(Math.min(y0, y1)), w: r2(Math.abs(x1 - x0)), h: r2(Math.abs(y1 - y0)) };
      });
    },

    /**
     * A frame around something: `inner` (items in page points) is clipped to the frame's opening
     * and the frame drawn over it, so the frame's own trim covers the clip edge. The opening is
     * fitted into `box` - kept in proportion and centred (`fit: 'contain'`, the default), or
     * stretched to fill it (`fit: 'stretch'`, for frames drawn to stretch). The frame casts the
     * soft paper shadow unless `shadow` says otherwise. Returns one group.
     */
    frame(id, box, inner = [], { fit = 'contain', shadow = 'soft', tint, op } = {}) {
      const a = drawing(id);
      if (!a.clip) throw new Error(`art: "${id}" has no opening (a data-clip shape in its source), so it cannot frame anything`);
      if (!['x', 'y', 'w', 'h'].every((k) => Number.isFinite(box?.[k])) || !(box.w > 0 && box.h > 0)) throw new Error(`art: frame "${id}" needs a box { x, y, w, h } with a positive size`);
      const [ox, oy, ow, oh] = a.opening;
      let kx = box.w / ow, ky = box.h / oh;
      if (fit === 'contain') kx = ky = Math.min(kx, ky);
      else if (fit !== 'stretch') throw new Error(`art: fit "${fit}" is not contain or stretch`);
      const tf = [kx, 0, 0, ky, box.x + (box.w - kx * ow) / 2 - kx * ox, box.y + (box.h - ky * oh) / 2 - ky * oy];
      const framed = drawAt(id, tf, { shadow, tint, op });
      return group(inner.length ? [group(inner, { clip: mapPath(a.clip, tf) }), framed] : [framed]);
    },

    /**
     * The symbols this book has used, for `book.symbols`: exactly those placed or framed and the
     * symbols they use in turn, in id order. `undefined` when there are none, because a book never
     * carries an empty symbols map (docs/family-book.md).
     */
    symbols() {
      if (!used.size) return undefined;
      return Object.fromEntries([...used.keys()].sort().map((k) => [k, used.get(k)]));
    },
  };
}
