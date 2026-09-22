/*
 * The storybook's scenes (#254): each compiles inside its budget, keeps to the design system's
 * layers and glows, declares zones a page can use, holds its chapter's copy in its text zones, and
 * the three night scenes are built differently. The scenes' source is tools/book_scenes.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { compileAll, compileSvg, readSwatches, BUDGETS, SRC_DIR } from '../../tools/book_art.mjs';
import { SCENES } from '../../tools/book_scenes.mjs';
import { LIBRARY, artFor } from './art/index.js';
import { PAPERCUT_PALETTE_KEYS } from './template.js';
import { METRICS } from './metrics/index.js';
import { SAMPLE_COPY, layoutCopy } from './qa/scene-copy.mjs';

const IDS = Object.keys(SCENES);
const NIGHT = ['ghat-night', 'remembrance-night', 'closing-sky'];
const source = (id) => readFileSync(path.join(SRC_DIR, 'scenes', `${id}.svg`), 'utf8');
const P = Object.fromEntries(PAPERCUT_PALETTE_KEYS.map((k) => [k, '#000000']));
const zonesOf = (id) => artFor({ P, gradient: (g) => ({ ref: g }) }).zones(id, { x: 0, y: 0, w: 595 });

test('the committed scene sources are what tools/book_scenes.mjs draws', () => {
  for (const [id, draw] of Object.entries(SCENES)) assert.equal(source(id), draw().svg(), `${id}.svg is stale: run node tools/book_scenes.mjs`);
});

test('every scene compiles inside the 40 KB scene budget', () => {
  const { report } = compileAll();
  for (const id of IDS) {
    const r = report.find((x) => x.file === `scenes/${id}.svg`);
    assert.ok(r, `${id} compiled`);
    assert.ok(r.bytes <= BUDGETS.scene, `${id}: ${r.bytes} bytes`);
  }
});

test('every scene has 3 to 6 layers, back to front', () => {
  for (const id of IDS) {
    const layers = [...source(id).matchAll(/^<g data-name="([^"]+)">$/gm)].map((m) => m[1]);
    assert.ok(layers.length >= 3 && layers.length <= 6, `${id}: ${layers.length} layers (${layers})`);
  }
});

/** A glow is a radial gradient or a translucent disc, counted as drawn: every use expanded. */
function glows(id) {
  const count = (items) => items.reduce((sum, it) => {
    if (it.t === 'group') return sum + count(it.items);
    if (it.t === 'use') return sum + count(LIBRARY.symbols[it.ref].items);
    const radial = typeof it.fill === 'object' && LIBRARY.gradients[it.fill.ref]?.type === 'radial';
    return sum + (radial || (it.t === 'circle' && it.op !== undefined && !it.stroke) ? 1 : 0);
  }, 0);
  return count(LIBRARY.symbols[id].items);
}

test('no scene spends more than ten glows on its own', () => {
  for (const id of IDS) assert.ok(glows(id) <= 10, `${id}: ${glows(id)} glows`);
});

test('every scene declares a text zone, and no text zone lies on a busy one', () => {
  for (const id of IDS) {
    const zones = zonesOf(id);
    const text = zones.filter((z) => z.kind === 'text'), busy = zones.filter((z) => z.kind === 'busy');
    assert.ok(text.some((z) => z.name === 'title' || z.name === 'story'), `${id} has a title zone`);
    for (const t of text) for (const b of busy) {
      const overlap = t.x < b.x + b.w && b.x < t.x + t.w && t.y < b.y + b.h && b.y < t.y + t.h;
      assert.ok(!overlap, `${id}: text zone ${t.name} overlaps busy zone ${b.name}`);
    }
    assert.ok(zones.every((z) => z.name), `${id}: every zone is named, so a page can ask for it`);
  }
});

test('each chapter\'s typical copy sets in its scene\'s text zones without truncating or overflowing', () => {
  for (const id of IDS) {
    assert.ok(SAMPLE_COPY[id], `${id} has sample copy`);
    const { problems } = layoutCopy(SAMPLE_COPY[id], zonesOf(id), METRICS);
    assert.deepEqual(problems, [], id);
  }
});

test('the cover keeps a lamps zone and a figures zone: the page places both, the scene counts nobody', () => {
  const names = zonesOf('ghat-night').map((z) => z.name);
  assert.ok(names.includes('lamps') && names.includes('figures'));
  assert.doesNotMatch(source('ghat-night'), /data-asset="diya/, 'no lamp is baked into the cover');
});

test('the three night scenes are built from different layers, so consecutive night pages differ', () => {
  const sig = NIGHT.map((id) => [...source(id).matchAll(/^<g data-name="([^"]+)">$/gm)].map((m) => m[1]).slice(1).join(','));
  assert.equal(new Set(sig).size, NIGHT.length, sig.join(' | '));
  const titles = NIGHT.map((id) => zonesOf(id).find((z) => z.name === 'title'));
  assert.equal(new Set(titles.map((t) => `${t.y}`)).size, NIGHT.length, 'their titles sit at different heights');
});

test('paper shadows are silhouettes of the same part, never copies', () => {
  for (const id of IDS) {
    const uses = [];
    const walk = (items) => items.forEach((it) => { if (it.t === 'use') uses.push(it); if (it.t === 'group') walk(it.items); });
    walk(LIBRARY.symbols[id].items);
    assert.ok(uses.some((u) => u.fill === 'ink' || u.fill === 'deep'), `${id} casts at least one silhouette shadow`);
  }
});

test('a zone keeps its data-name, and a name a page could not ask for fails', () => {
  const swatches = readSwatches(path.join(SRC_DIR, 'swatches.json'));
  const zone = (name) => compileSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L5 0 5 5Z" fill="#b5562a"/><rect data-zone="text" data-name="${name}" x="0" y="0" width="4" height="2"/></svg>`, { id: 'fx', kind: 'scene', swatches });
  assert.deepEqual(zone('title').symbols.fx.zones, [{ kind: 'text', name: 'title', x: 0, y: 0, w: 4, h: 2 }]);
  assert.throws(() => zone('Title Zone'), /data-name/);
});
