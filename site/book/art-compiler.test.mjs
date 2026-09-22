/*
 * tools/book_art.mjs, the paper-cut art compiler (#247), held to what it promises: authored SVG in,
 * only what the painters draw out, every colour a palette token, and the same bytes every time.
 * The fixture SVGs are in fixtures/art/, one per conversion case.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compileSvg, compileAll, readSwatches, swatchDrift, parsePath, serialize, arcToCubics, segBBox,
  BUDGETS, KINDS, SRC_DIR, OUT_DIR, ArtError,
} from '../../tools/book_art.mjs';
import { pathPoints } from './format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'art');
const SWATCHES = readSwatches(path.join(SRC_DIR, 'swatches.json'));
const fixture = (name) => readFileSync(path.join(FIX, name), 'utf8');

const compile = (src, { id = 'fx', kind = 'motif', file = 'fx.svg' } = {}) => compileSvg(src, { id, kind, file, swatches: SWATCHES });
const compileFixture = (name, o = {}) => compile(fixture(name), { file: name, ...o });
/** The drawing's items, found by the order they were drawn in. */
const items = (name) => compileFixture(name).symbols.fx.items;
const svg = (body, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const refuses = (src, pattern) => assert.throws(() => compile(src), (e) => e instanceof ArtError && pattern.test(e.message), `expected ${pattern}`);

/** Points along a compiled path's cubics, for checking geometry rather than strings. */
function sample(d) {
  const segs = parsePath(d, (m) => { throw new Error(m); });
  const out = [];
  let x = 0, y = 0;
  for (const [c, ...p] of segs) {
    if (c === 'C') {
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        out.push([u * u * u * x + 3 * u * u * t * p[0] + 3 * u * t * t * p[2] + t * t * t * p[4], u * u * u * y + 3 * u * u * t * p[1] + 3 * u * t * t * p[3] + t * t * t * p[5]]);
      }
    }
    if (c !== 'Z') [x, y] = p.slice(-2);
  }
  return out;
}

test('relative commands, H and V, and a moveto\'s implicit linetos become absolute M L Z', () => {
  const [a, b] = items('relative.svg');
  assert.equal(a.d, 'M10 10L20 10 20 20 10 20ZM15 15L16 16 17 17');
  assert.equal(b.d, 'M1 1L2 2 3 3');
});

test('S and T reflect the previous control point, or take the current point when there is none', () => {
  const [s, t, alone, relative] = items('smooth.svg');
  assert.equal(s.d, 'M0 0C0 10 10 10 10 0 10-10 20-10 20 0');
  assert.equal(t.d, 'M0 0Q5 10 10 0 15-10 20 0');
  assert.equal(alone.d, 'M0 0L5 5C5 5 10 10 15 5');
  assert.equal(relative.d, 'M0 0C0 10 10 10 10 0 10-10 20-10 20 0Q25 10 30 0 35-10 40 0');
});

test('arcs become cubics that stay on the circle, through the side the flags choose', () => {
  const [half, large, scaled, small, flat] = items('arcs.svg');
  for (const [it, r, cx, cy] of [[half, 10, 0, 0], [large, 10, 0, 0], [scaled, 5, -5, 0], [small, 10, 10, 10]]) {
    assert.match(it.d, /^M[^A-Za-z]*C/);
    for (const [x, y] of sample(it.d)) assert.ok(Math.abs(Math.hypot(x - cx, y - cy) - r) < 0.05, `${it.d}: (${x}, ${y}) is off the radius-${r} circle`);
  }
  // sweep 1 goes through (0, 10); large arc with sweep 0 goes the long way round, through (0, -10)
  assert.ok(sample(half.d).some(([x, y]) => Math.abs(x) < 0.5 && Math.abs(y - 10) < 0.1));
  assert.ok(sample(large.d).some(([x, y]) => Math.abs(x) < 0.5 && Math.abs(y + 10) < 0.1));
  assert.equal(parsePath(large.d, assert.fail).filter(([c]) => c === 'C').length, 3, 'three quarter turns, one cubic each');
  assert.ok(scaled.d.endsWith(' 0 0'), 'ends exactly where the arc was told to');
  assert.equal(flat.d, 'M0 0L5 5', 'a zero radius is a straight line');
  assert.deepEqual(arcToCubics(1, 1, 5, 5, 0, 0, 1, 1, 1), [], 'an arc to its own start draws nothing');
});

test('transforms are baked in: points move, circles stay circles, strokes scale with them', () => {
  const [turned, round, doubled, squashed, ring, rounded] = items('transforms.svg');
  assert.equal(turned.d, 'M100 50L100 60');
  assert.equal(turned.sw, 2);
  assert.deepEqual(round, { t: 'circle', cx: 100, cy: 60, r: 3, fill: 'gold' });
  assert.deepEqual(doubled, { t: 'rect', x: 12, y: 14, w: 6, h: 8, r: 1, fill: 'clay' });
  // a filled circle under a non-uniform scale is baked into the ellipse it becomes...
  assert.equal(squashed.t, 'path');
  const [bx, by, bw, bh] = segBBox(parsePath(squashed.d, assert.fail));
  assert.deepEqual([bx, by, bw, bh].map((v) => Math.round(v * 100) / 100), [10, 5, 20, 10]);
  // ...and a stroked one keeps its transform, as a group, so its stroke is stretched exactly as SVG does
  assert.deepEqual(ring, { t: 'group', items: [{ t: 'circle', cx: 10, cy: 10, r: 5, stroke: 'ink', sw: 1 }], tf: [2, 0, 0, 1, 0, 0] });
  // rounded to 0.01, with no leading zero and no "-0"
  assert.equal(rounded.d, 'M.12 1L2 0');
});

test('ellipse, polygon, polyline, line and rect become paths, or native circles and rects where exact', () => {
  const [ellipse, circleItem, polygon, polyline, line, rectItem, roundedRect, ...rest] = items('shapes.svg');
  assert.equal(ellipse.t, 'path');
  assert.deepEqual(segBBox(parsePath(ellipse.d, assert.fail)).map((v) => Math.round(v)), [30, 40, 40, 20]);
  assert.deepEqual(circleItem, { t: 'circle', cx: 50, cy: 50, r: 5, fill: 'saffron' }, 'an ellipse with equal radii is a circle; hex case does not matter');
  assert.equal(polygon.d, 'M0 0L10 0 5 8Z');
  assert.equal(polyline.d, 'M0 0L10 10 20 0');
  assert.equal(line.d, 'M1 2L3 4');
  assert.equal(line.fill, undefined, 'a line is never filled, even by SVG\'s default black');
  assert.deepEqual(rectItem, { t: 'rect', x: 10, y: 20, w: 30, h: 5, fill: 'card' });
  assert.equal(roundedRect.t, 'path', 'unequal corner radii are not a Book rect');
  assert.deepEqual(rest, [], 'a zero-width rect draws nothing');
});

test('every path the compiler writes is one both painters read', () => {
  for (const f of readdirSync(FIX).filter((n) => n.endsWith('.svg') && !n.startsWith('refuse') && n !== 'unmapped.svg')) {
    const walk = (list) => list.forEach((it) => {
      if (it.t === 'path') assert.ok(pathPoints(it.d), `${f}: ${it.d}`);
      if (it.t === 'group') { walk(it.items); if (it.clip) assert.ok(pathPoints(it.clip), `${f}: clip ${it.clip}`); }
    });
    for (const s of Object.values(compileFixture(f).symbols)) walk(s.items);
  }
});

test('a representative drawing compiles to its reference output exactly', () => {
  const c = compileFixture('representative.svg', { id: 'lamp-on-step' });
  const expected = JSON.parse(fixture('representative.expected.json'));
  assert.deepEqual({ symbols: c.symbols, gradients: c.gradients }, expected);
  // and the reference itself is right: the flame's first point is (0, -2) scaled by 1.5, turned
  // -10 degrees and moved to (30, 40), worked out here independently of the compiler
  const a = (-10 * Math.PI) / 180;
  const [x, y] = [30 + -3 * -Math.sin(a), 40 + -3 * Math.cos(a)];
  assert.ok(expected.symbols['lamp-on-step'].items[1].d.startsWith(`M${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}C`));
});

test('colours map to palette tokens, and a colour that is no swatch fails naming file, element and colour', () => {
  assert.throws(() => compileFixture('unmapped.svg'), (e) => {
    assert.match(e.message, /^unmapped\.svg: <circle id="petal"> \(line 3\): fill #f2a71c is not a swatch/);
    assert.match(e.message, /nearest is #f2a71b \(marigold\)/);
    return true;
  });
  refuses(svg('<rect width="1" height="1"/>'), /fill #000000 \(SVG's default black: nothing sets a fill here\) is not a swatch/);
  refuses(svg('<rect width="1" height="1" fill="#fff"/>'), /fill #ffffff is not a swatch/);
  refuses(svg('<rect width="1" height="1" fill="red"/>'), /fill "red" is not a #rrggbb colour/);
  refuses(svg('<rect width="1" height="1" fill="#fff8ec" stroke="#123456"/>'), /stroke #123456 is not a swatch/);
  refuses(svg('<linearGradient id="g" gradientUnits="userSpaceOnUse" x2="1"><stop stop-color="#fff8ec"/><stop offset="1" stop-color="#010101"/></linearGradient><rect width="1" height="1" fill="url(#g)"/>'), /<stop> \(line 1\): stop-color #010101 is not a swatch/);
  const g = compile(svg('<g fill="#2A1A33"><rect width="1" height="1"/></g>')).symbols.fx.items;
  assert.equal(g[0].fill, 'ink', 'fill is inherited from a group');
});

test('filter, mask, pattern, image, text, style and class are refused, with the reason', () => {
  const cases = {
    'refuse-filter.svg': /<filter id="blur"> \(line 1\): <filter> is refused: the painters draw no filters/,
    'refuse-mask.svg': /<mask> is refused/,
    'refuse-pattern.svg': /<pattern> is refused/,
    'refuse-image.svg': /<image> is refused: art is vector only/,
    'refuse-text.svg': /<text> is refused: no text inside art/,
    'refuse-style.svg': /<style> is refused: no stylesheets/,
    'refuse-style-attribute.svg': /the style attribute is refused: .*presentation attributes/,
    'refuse-class.svg': /the class attribute is refused/,
  };
  for (const [f, pattern] of Object.entries(cases)) {
    assert.throws(() => compileFixture(f), (e) => e instanceof ArtError && e.message.startsWith(`${f}: `) && pattern.test(e.message), f);
  }
  refuses(svg('<rect width="1" height="1" fill="#fff8ec" mix-blend-mode="multiply"/>'), /mix-blend-mode attribute is refused/);
  refuses(svg('<rect width="1" height="1" fill="#fff8ec" data-zones="text"/>'), /the attribute data-zones="text" is not one the compiler reads on <rect>/);
  refuses(svg('<blink/>'), /<blink> is not something the painters can draw/);
});

test('data-anchor, data-zone and data-clip are read into the metadata and never drawn', () => {
  const m = compileFixture('metadata.svg').symbols.fx;
  assert.deepEqual(m.vb, [0, 0, 100, 50]);
  assert.deepEqual(m.anchor, [50, 50], 'bottom-center');
  assert.deepEqual(m.zones, [
    { kind: 'text', x: 10, y: 5, w: 30, h: 10 },
    { kind: 'face', x: 55, y: 5, w: 10, h: 10 },
    { kind: 'busy', x: 0, y: 40, w: 100, h: 10 },
  ]);
  assert.deepEqual(m.opening, [35, 10, 30, 30]);
  assert.ok(pathPoints(m.clip));
  assert.deepEqual(m.items, [{ t: 'rect', x: 0, y: 0, w: 100, h: 50, fill: 'clay' }], 'only the wall is drawn: zones and the opening are stripped');
  assert.doesNotMatch(JSON.stringify(m.items), /data-|sindoor/);

  assert.deepEqual(compile(svg('<rect width="1" height="1" fill="#fff8ec"/>', 'viewBox="0 0 10 20" data-anchor="3 4"')).symbols.fx.anchor, [3, 4]);
  assert.deepEqual(compile(svg('<rect width="1" height="1" fill="#fff8ec"/>', 'viewBox="0 0 10 20"')).symbols.fx.anchor, [5, 10], 'the centre by default');
  refuses(svg('<rect width="1" height="1" fill="#fff8ec"/>', 'viewBox="0 0 10 20" data-anchor="bottom-middle"'), /data-anchor="bottom-middle"/);
  refuses(svg('<rect data-zone="quiet" width="1" height="1"/>'), /data-zone="quiet" is not text, face or busy/);
  refuses(svg('<rect data-zone="text" width="1" height="1" transform="rotate(10)"/>'), /a zone must stay an upright rectangle/);
  refuses(svg('<circle data-clip="" r="1"/><circle data-clip="" r="2"/>'), /a second data-clip/);
  refuses(svg('<rect width="1" height="1" fill="#fff8ec"/>', ''), /needs a viewBox/);
});

test('gradients: linear and radial with token stops, baked with the shape, shared when identical', () => {
  const c = compileFixture('gradients.svg');
  const [flame, lit, tall, again] = c.symbols.fx.items;
  assert.deepEqual(flame.fill, { ref: 'fx-g0' });
  assert.deepEqual(again.fill, { ref: 'fx-g0' }, 'the same gradient through the same transform is one def');
  assert.deepEqual(c.gradients['fx-g0'], { type: 'linear', x1: 10, y1: 30, x2: 10, y2: 10, stops: [[0, 'saffron'], [0.35, 'gold', 0.5], [1, 'flame']] },
    'its stops come through the href chain, its ends through the group transform');
  assert.equal(lit.t, 'circle');
  assert.deepEqual(c.gradients[lit.fill.ref], { type: 'radial', units: 'item', cx: 0, cy: -0.2, r: 1, stops: [[0, 'gold'], [1, 'gold', 0]] },
    'an objectBoundingBox radial on a circle is the Book\'s item-relative glow');
  assert.deepEqual(c.gradients[tall.fill.ref], { type: 'linear', x1: 60, y1: 0, x2: 60, y2: 40, stops: [[0, 'saffron'], [1, 'flame']] });
  const stops = '<stop stop-color="#fff8ec"/><stop offset="1" stop-color="#2a1a33"/>';
  refuses(svg(`<radialGradient id="g">${stops}</radialGradient><rect width="1" height="1" fill="url(#g)"/>`), /only works on a circle/);
  refuses(svg(`<linearGradient id="g" gradientUnits="userSpaceOnUse" gradientTransform="skewX(20)" x2="1">${stops}</linearGradient><rect width="1" height="1" fill="url(#g)"/>`), /skewed or stretched/);
  refuses(svg(`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="5" fx="1">${stops}</radialGradient><circle r="1" fill="url(#g)"/>`), /focal point/);
  refuses(svg('<linearGradient id="g"><stop stop-color="#fff8ec"/></linearGradient><rect width="1" height="1" fill="url(#g)"/>'), /at least two stops/);
  refuses(svg(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x2="1">${stops}</linearGradient><path d="M0 0L1 1" fill="none" stroke="url(#g)"/>`), /a gradient stroke/);
  // SVG's defaults for these are percentages of the viewport, which a drawing has no fixed one of
  refuses(svg(`<linearGradient id="g" gradientUnits="userSpaceOnUse">${stops}</linearGradient><rect width="1" height="1" fill="url(#g)"/>`), /x2 is missing, and in userSpaceOnUse SVG would take it as 100% of the viewport/);
  refuses(svg(`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="1" cy="1">${stops}</radialGradient><rect width="1" height="1" fill="url(#g)"/>`), /r is missing/);
});

test('what a <use> draws inherits the <use>\'s paint, one part per inherited paint', () => {
  const c = compile(svg('<defs><path id="p" d="M0 0L1 0 1 1Z"/></defs><g fill="#5a8a3c" stroke="#2a1a33" stroke-width="2"><use href="#p"/></g><g fill="#c23b2e"><use href="#p" x="5"/><use href="#p" x="9"/></g>'));
  assert.deepEqual(c.symbols['fx--p'].items, [{ t: 'path', d: 'M0 0L1 0 1 1Z', fill: 'leaf', stroke: 'ink', sw: 2 }]);
  assert.deepEqual(c.symbols['fx--p-2'].items, [{ t: 'path', d: 'M0 0L1 0 1 1Z', fill: 'sindoor' }]);
  assert.deepEqual(c.symbols.fx.items.map((u) => u.ref), ['fx--p', 'fx--p-2', 'fx--p-2']);
  refuses(svg('<defs><g id="a"><rect data-zone="text" width="1" height="1"/></g></defs><use href="#a"/>'), /inside something a <use> draws would be read in the wrong place/);
  refuses(svg('<defs><path id="Leaf" d="M0 0L1 1" fill="#fff8ec"/><path id="leaf" d="M0 0L2 2" fill="#fff8ec"/></defs><use href="#Leaf"/><use href="#leaf"/>'), /both become the part fx--leaf/);
});

test('a fill on a <use> or a <g data-asset> is a silhouette: one part, the shadow and the shape share it', () => {
  // the hair, its paper shadow (the same shape, offset, in ink) and a silver copy: one part, three uses
  const c = compile(svg('<defs><path id="hair" d="M0 0L4 0 4 4Z" fill="#2a1a33"/></defs>'
    + '<use href="#hair" fill="#2a1a33" opacity="0.22" x="0.5" y="0.75"/><use href="#hair"/><use href="#hair" fill="#d9d2ca" x="9"/>'
    + '<g data-asset="marigold" fill="#5a8a3c" transform="translate(20 0)"/>'));
  assert.deepEqual(Object.keys(c.symbols).sort(), ['fx', 'fx--hair']);
  assert.deepEqual(c.symbols.fx.items, [
    { t: 'use', ref: 'fx--hair', tf: [1, 0, 0, 1, 0.5, 0.75], fill: 'ink', op: 0.22 },
    { t: 'use', ref: 'fx--hair', tf: [1, 0, 0, 1, 0, 0] },
    { t: 'use', ref: 'fx--hair', tf: [1, 0, 0, 1, 9, 0], fill: 'silver' },
    { t: 'use', ref: 'marigold', tf: [1, 0, 0, 1, 20, 0], fill: 'leaf' },
  ]);
  // a shape with no fill of its own takes the silhouette's as its part's colour, once
  const bare = compile(svg('<defs><path id="cloth" d="M0 0L4 0 4 4Z"/></defs><use href="#cloth" fill="#3b4a8c"/><use href="#cloth" fill="#0f7b7a" x="5"/>'));
  assert.deepEqual(bare.symbols['fx--cloth'].items, [{ t: 'path', d: 'M0 0L4 0 4 4Z', fill: 'indigo' }]);
  assert.deepEqual(bare.symbols.fx.items.map((u) => [u.ref, u.fill]), [['fx--cloth', 'indigo'], ['fx--cloth', 'peacock']]);
  refuses(svg('<defs><path id="p" d="M0 0L1 1Z"/></defs><use href="#p" fill="none"/>'), /fill="none" on a <use> is a silhouette colour/);
  refuses(svg('<g data-asset="diya" fill="#123456"/>'), /the silhouette fill #123456 is not a swatch/);
});

test('nothing an author sets is silently dropped: opacity, clips on placed drawings, zero strokes', () => {
  refuses(svg('<rect width="1" height="1" fill="#fff8ec"/>', 'viewBox="0 0 1 1" opacity="0.3"'), /opacity on the <svg> is not read/);
  refuses(svg('<symbol id="s" opacity="0.3"><rect width="1" height="1" fill="#fff8ec"/></symbol><use href="#s"/>'), /opacity on the <symbol> is not read/);
  const clipped = compile(svg('<clipPath id="c"><rect width="10" height="10"/></clipPath><g data-asset="diya" clip-path="url(#c)" transform="translate(5 0)"/>')).symbols.fx.items;
  assert.deepEqual(clipped, [{ t: 'group', items: [{ t: 'use', ref: 'diya', tf: [1, 0, 0, 1, 5, 0] }], clip: 'M5 0L15 0 15 10 5 10Z' }]);
  // Android draws a zero-width stroke as a hairline; SVG draws nothing. So does the compiler.
  const zero = compile(svg('<rect width="4" height="4" fill="#fff8ec" stroke="#2a1a33" stroke-width="0"/>')).symbols.fx.items;
  assert.deepEqual(zero, [{ t: 'rect', x: 0, y: 0, w: 4, h: 4, fill: 'card' }], 'the fill stays, the zero stroke goes');
  assert.equal(compile(svg('<rect width="4" height="4" fill="#fff8ec"/><path d="M0 0L1 1" fill="none" stroke="#2a1a33" stroke-width="0.004"/>')).symbols.fx.items.length, 1, 'a stroke that rounds to nothing, on nothing, draws nothing');
});

test('uses become parts drawn once, other drawings are placed by id, and opacity and clips become groups', () => {
  const c = compileFixture('parts.svg');
  const [a, b, d, asset, single, pair, clipped] = c.symbols.fx.items;
  assert.deepEqual(c.symbols['fx--leaf'], { items: [{ t: 'path', d: 'M0 0Q5 5 0 10-5 5 0 0Z', fill: 'leaf' }] });
  assert.deepEqual(a, { t: 'use', ref: 'fx--leaf', tf: [1, 0, 0, 1, 10, 10] });
  assert.deepEqual(b, { t: 'use', ref: 'fx--leaf', tf: [0, 1, -1, 0, 100, 0], op: 0.5 });
  assert.deepEqual(d, { t: 'use', ref: 'fx--leaf', tf: [1, 0, 0, 1, 30, 0] });
  assert.deepEqual(asset, { t: 'use', ref: 'marigold', tf: [0.5, 0, 0, 0.5, 60, 60] }, 'the pasted preview inside data-asset is not compiled (its colour is no swatch)');
  assert.deepEqual(c.assetRefs, ['marigold']);
  assert.deepEqual(single, { t: 'rect', x: 0, y: 0, w: 5, h: 5, fill: 'card', op: 0.5 }, 'one shape under an opacity is that shape at that opacity');
  assert.equal(pair.t, 'group');
  assert.equal(pair.op, 0.5, 'two shapes under one opacity are one layer, never darker where they overlap');
  assert.deepEqual(clipped, { t: 'group', items: [{ t: 'circle', cx: 35, cy: 25, r: 40, fill: 'sky' }], clip: 'M10 0L60 0 60 50 10 50Z' });
  refuses(svg('<g id="x"><use href="#x"/></g>'), /reaches <g id="x"> \(line 1\) through itself/);
  refuses(svg('<use href="other.svg#x"/>'), /wrap a copy of it in <g data-asset/);
  refuses(svg('<clipPath id="c"><rect width="1" height="1"/><rect width="2" height="2"/></clipPath><g clip-path="url(#c)"><rect width="1" height="1" fill="#fff8ec"/></g>'), /a clip is one shape/);
  refuses(svg('<rect width="1" height="1" fill="#fff8ec" stroke="#2a1a33" fill-opacity="0.5"/>'), /fill-opacity 0.5 and stroke-opacity 1 differ/);
  refuses(svg('<path d="M0 0L1 1" fill="none" stroke="#2a1a33" stroke-miterlimit="10"/>'), /the painters use 4/);
});

test('the XML reader reports where a file is broken', () => {
  refuses('<svg viewBox="0 0 1 1"><g></svg>', /fx\.svg:1: <\/svg> closes <g>/);
  refuses('<svg viewBox="0 0 1 1">\n<rect x="1" x="2"/></svg>', /fx\.svg:2: <rect> has the attribute x twice/);
  refuses('<svg viewBox="0 0 1 1"><rect width="1" height="1" fill="&nbsp;"/></svg>', /the entity &nbsp; is not one this reader knows/);
  refuses('<?xml version="1.0"?><g/>', /the root element must be <svg>/);
  refuses('<svg viewBox="0 0 1 1"><path d="M0 0 X1 1" fill="#fff8ec"/></svg>', /"X" is not a path command/);
  refuses('<svg viewBox="0 0 1 1"><path d="L0 0" fill="#fff8ec"/></svg>', /must start with M/);
  // what an editor writes around the drawing is read and ignored
  const inkscape = '<?xml version="1.0"?>\n<!-- Created with Inkscape -->\n<svg xmlns:sodipodi="x" xmlns:inkscape="y" viewBox="0 0 1 1" sodipodi:docname="a.svg">'
    + '<sodipodi:namedview inkscape:zoom="1"/><metadata><rdf:RDF/></metadata><g inkscape:label="Layer 1" inkscape:groupmode="layer">'
    + '<rect width="1" height="1" fill="#fff8ec"/><rect width="1" height="1" fill="#fff8ec" display="none"/></g></svg>';
  assert.deepEqual(compile(inkscape).symbols.fx.items, [{ t: 'rect', x: 0, y: 0, w: 1, h: 1, fill: 'card' }]);
});

test('serialize writes the shortest form the path grammar allows, and it reads back the same', () => {
  const segs = [['M', 0.5, -0.25], ['L', 1.5, 0.5], ['L', -3, 4], ['C', 1, 2, 3, 4, 5, 6], ['Z']];
  assert.equal(serialize(segs), 'M.5-.25L1.5.5-3 4C1 2 3 4 5 6Z');
  assert.deepEqual(pathPoints(serialize(segs)), [[0.5, -0.25], [1.5, 0.5], [-3, 4], [1, 2], [3, 4], [5, 6]]);
});

/* ------------------------------------------------------------------------- the whole set */

/** A throwaway source tree, with the real swatches and the given drawings. */
function sources(files, swatches = JSON.parse(readFileSync(path.join(SRC_DIR, 'swatches.json'), 'utf8'))) {
  const dir = mkdtempSync(path.join(tmpdir(), 'book-art-'));
  writeFileSync(path.join(dir, 'swatches.json'), JSON.stringify(swatches));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const withSources = (files, fn, swatches) => {
  const dir = sources(files, swatches);
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('byte budgets per kind fail the build with the size and the budget', () => {
  assert.deepEqual({ avatar: BUDGETS.avatar, frame: BUDGETS.frame, scene: BUDGETS.scene }, { avatar: 2560, frame: 4096, scene: 40960 });
  const rects = (n) => svg(Array.from({ length: n }, (_, i) => `<rect x="${i}.25" y="${i}.75" width="1.5" height="2.5" fill="#fff8ec"/>`).join(''));
  // about 60 bytes a rect: 40 fit an avatar, 50 do not
  withSources({ 'avatars/ok.svg': rects(40) }, (dir) => assert.doesNotThrow(() => compileAll(dir)));
  withSources({ 'avatars/big.svg': rects(50), 'frames/big-frame.svg': rects(80), 'scenes/fine.svg': rects(80) }, (dir) => {
    assert.throws(() => compileAll(dir), (e) => {
      assert.match(e.message, /avatars\/big\.svg: compiles to \d+ bytes, over the avatar budget of 2560 \(2\.5 KB\)/);
      assert.match(e.message, /frames\/big-frame\.svg: compiles to \d+ bytes, over the frame budget of 4096 \(4 KB\)/);
      assert.doesNotMatch(e.message, /scenes\/fine/, 'a scene may be ten times a frame');
      return true;
    });
  });
});

test('the build fails when swatches.json and template.js\'s paper-cut palette disagree', () => {
  assert.deepEqual(swatchDrift(SWATCHES), [], 'the committed swatches are the palette');
  const real = JSON.parse(readFileSync(path.join(SRC_DIR, 'swatches.json'), 'utf8'));
  // the drift #262 found: dayHaze and dayMid missing, a pre-approval token present
  const drifted = { ...real, swatches: Object.fromEntries(Object.entries(real.swatches).filter(([, t]) => t !== 'dayHaze' && t !== 'dayMid')) };
  drifted.swatches['#101010'] = 'dusk2';
  withSources({ 'motifs/dot.svg': svg('<circle r="1" fill="#fff8ec"/>') }, (dir) => {
    assert.throws(() => compileAll(dir), (e) => {
      assert.match(e.message, /no swatch for the palette token\(s\) dayHaze, dayMid that template\.js's PAPERCUT_PALETTE_KEYS lists/);
      assert.match(e.message, /maps to dusk2, which template\.js's PAPERCUT_PALETTE_KEYS does not list/);
      return true;
    });
  }, drifted);
});

test('ids are unique across kinds, and a placed drawing must exist', () => {
  const dot = svg('<circle r="1" fill="#fff8ec"/>');
  withSources({ 'motifs/dot.svg': dot, 'ornaments/dot.svg': dot }, (dir) => assert.throws(() => compileAll(dir), /ornaments\/dot\.svg: the id "dot" is taken by motifs\/dot\.svg/));
  withSources({ 'scenes/yard.svg': svg('<g data-asset="lamp"/>') }, (dir) => assert.throws(() => compileAll(dir), /data-asset="lamp" names no drawing/));
  withSources({ 'motifs/Diya Big.svg': dot }, (dir) => assert.throws(() => compileAll(dir), /"Diya Big" is not a drawing id/));
});

test('every compiled drawing validates as a Book the painters can draw, symbols nested within the limit', () => {
  const lamp = svg('<defs><circle id="c" r="1" fill="#fff8ec"/></defs><use href="#c"/>');
  withSources({ 'motifs/lamp.svg': lamp, 'scenes/yard.svg': svg('<g data-asset="lamp"/><g data-asset="lamp" transform="translate(5 0)"/>') }, (dir) => {
    const { modules } = compileAll(dir);
    assert.match(modules.scenes, /"ref":"lamp"/);
    assert.match(modules.motifs, /"lamp--c"/);
  });
  // five deep: page -> a -> b -> c -> d -> d's part is past MAX_SYMBOL_DEPTH
  const chain = {
    'motifs/d.svg': lamp,
    'motifs/c.svg': svg('<g data-asset="d"/>'),
    'motifs/b.svg': svg('<g data-asset="c"/>'),
    'motifs/a.svg': svg('<g data-asset="b"/>'),
  };
  withSources(chain, (dir) => assert.throws(() => compileAll(dir), /motifs\/a\.svg: the painters could not draw it: .*nested 5 deep/));
});

test('the compiler is deterministic, and the committed modules are exactly what the sources compile to', () => {
  const first = compileAll();
  const second = compileAll();
  assert.deepEqual(first.modules, second.modules);
  for (const dir of Object.keys(KINDS)) {
    const committed = readFileSync(path.join(OUT_DIR, `${dir}.js`), 'utf8');
    assert.equal(committed, first.modules[dir], `art/papercut/${dir}.js is stale: run node tools/book_art.mjs`);
    assert.ok(committed.startsWith('// generated by tools/book_art.mjs — do not edit.\n'));
  }
  // and the seed drawings are really there
  const ids = first.report.map((r) => r.file);
  for (const f of ['motifs/diya.svg', 'motifs/marigold.svg', 'frames/arch-jharokha.svg']) assert.ok(ids.includes(f), f);
});

test('a shape used many times costs its bytes once, and each use only its own', () => {
  // a flower of eight petals, about 400 bytes; twenty copies are 8 KB, twenty uses about 1 KB
  const petal = Array.from({ length: 8 }, (_, k) => `M0 0C${4 + k}.25 2.75 ${8 + k}.5 2.25 12.75 ${k}.5C8.25-2.75 4.5-2.25 0 0Z`).join('');
  const copies = svg(Array.from({ length: 20 }, (_, i) => `<path d="${petal}" fill="#f2a71b" transform="translate(${i} ${i})"/>`).join(''));
  const uses = svg(`<defs><path id="petal" d="${petal}" fill="#f2a71b"/></defs>${Array.from({ length: 20 }, (_, i) => `<use href="#petal" x="${i}" y="${i}"/>`).join('')}`);
  withSources({ 'avatars/copies.svg': copies }, (dir) => assert.throws(() => compileAll(dir), /copies\.svg: compiles to \d+ bytes, over the avatar budget/));
  withSources({ 'avatars/uses.svg': uses }, (dir) => {
    const [{ bytes }] = compileAll(dir).report;
    const one = JSON.stringify({ t: 'use', ref: 'uses--petal', tf: [1, 0, 0, 1, 19, 19] }).length;
    assert.ok(bytes < 20 * (one + 1) + petal.length + 100, `${bytes} bytes: twenty uses and one flower`);
  });
});

test('the jharokha keeps its lace, as dotted strokes along the arch, inside the frame budget', () => {
  const { report, library } = compileAll();
  const arch = library.symbols['arch-jharokha'];
  const lace = arch.items.filter((it) => it.t === 'path' && it.dash && it.cap === 'round');
  assert.equal(lace.length, 2, 'big and small holes, alternating');
  for (const it of lace) {
    assert.equal(it.dash[0], 0.01, 'a dash that is all cap: a dot');
    assert.equal(it.fill, undefined);
    assert.equal(it.stroke, 'ink');
  }
  const { bytes, budget } = report.find((r) => r.file === 'frames/arch-jharokha.svg');
  assert.ok(bytes <= budget, `${bytes} of ${budget}`);
});
