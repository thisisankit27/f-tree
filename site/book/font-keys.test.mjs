/*
 * FONT_KEYS lives in five places that cannot import one another (site/book/template.js's own
 * comment on FONT_KEYS names all five), plus a sixth that just expects the file
 * (art/style-frames/render.sh). Nothing stopped one of them drifting from the rest - a font added
 * to the printer path but forgotten in `preview.html`, say, would fail silently: the preview would
 * simply fall back to a system face for that role and nobody would notice until a printed page
 * looked wrong.
 *
 * `font-keys.json` is the one list both this file and `FontKeysTest.kt` read, the same shape
 * `catalog-cases.json` holds the two shells' catalogue logic to. Four of the five sites here are
 * JavaScript, so this file can check them directly; `BookFonts.kt`'s hard-coded map is Kotlin's
 * job, in `FontKeysTest.kt`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_KEYS } from './template.js';
import { METRICS } from './metrics/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const read = (...parts) => readFileSync(path.join(...parts), 'utf8');

const { keys: EXPECTED } = JSON.parse(read(HERE, 'font-keys.json'));

test('template.js FONT_KEYS is exactly the shared list', () => {
  assert.deepStrictEqual(FONT_KEYS, EXPECTED);
});

test('metrics/index.js gathers exactly the shared list into METRICS', () => {
  assert.deepStrictEqual(Object.keys(METRICS), EXPECTED);
  for (const key of EXPECTED) assert.ok(METRICS[key]?.name === key, `METRICS.${key} is not ${key}'s own table`);
});

test('desktop/main.js BOOK_FONT_FILES names exactly the shared list, each with its own .ttf', () => {
  const src = read(ROOT, 'desktop', 'main.js');
  const block = src.match(/const BOOK_FONT_FILES = \[([\s\S]*?)\];/);
  assert.ok(block, 'BOOK_FONT_FILES was not found in desktop/main.js');
  const pairs = [...block[1].matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(pairs.map(([family]) => family), EXPECTED);
  for (const [family, file] of pairs) assert.strictEqual(file, `${family}.ttf`);
});

test('preview.html declares an @font-face for exactly the shared list', () => {
  const src = read(HERE, 'preview.html');
  const faces = [...src.matchAll(/@font-face\s*\{\s*font-family:\s*'([^']+)';\s*src:\s*url\('([^']+)'\)/g)]
    .map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(faces.map(([family]) => family), EXPECTED);
  for (const [family, url] of faces) assert.ok(url.endsWith(`/${family}.ttf`), `${family}'s @font-face does not point at ${family}.ttf`);
});

test('every shared key has a subset, committed .ttf', () => {
  for (const key of EXPECTED) {
    const bytes = readFileSync(path.join(ROOT, 'app', 'src', 'main', 'res', 'font', `${key}.ttf`));
    assert.ok(bytes.length > 0, `${key}.ttf is empty`);
  }
});

// render.sh (the sixth site) already fails without book_hand.ttf if the font list moves; this just
// keeps its own @font-face list from drifting the same way the other JS sites could.
test('the style-frames renderer declares an @font-face for exactly the shared list', () => {
  const src = read(HERE, 'art', 'style-frames', 'render.sh');
  const faces = [...src.matchAll(/@font-face\{font-family:([a-z_]+);src:url\(file:\/\/\$fonts\/([a-z_]+)\.ttf\)\}/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual(faces, EXPECTED);
});
