/*
 * Every colour the site asks for exists, in both themes.
 *
 * The desktop found four undefined tokens in #145; the site had its own four, found while taking
 * the "beta" note off the download pages. `--raised`, `--ground`, `--paper` and `--sage-container`
 * were names from the desktop's stylesheet, used on the site's download cards, copy buttons and
 * recommended file, and defined nowhere here. So the cards had no ground at all, and the copy
 * button's hover fell back to white text on the night theme's pale green. The same checks the
 * desktop runs, pointed at style.css.
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(path.join(here, file), 'utf8');

const CSS = read('style.css');
// The pages set a few colours inline, and app.js writes markup that carries them too.
const USERS = ['style.css', 'index.html', 'thanks/index.html', 'desktop/index.html',
  'desktop/thanks/index.html', 'app.js'].map(read);

/** The declarations in the first rule whose selector line is exactly `selector {`. */
function block(selector) {
  const start = CSS.indexOf(`\n${selector} {\n`);
  assert.ok(start >= 0, `no rule for ${selector} -- has the stylesheet been restructured?`);
  const body = CSS.slice(start, CSS.indexOf('\n}', start));
  return new Map([...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)]
    .map(([, name, value]) => [name, value.trim()]));
}

/** The night palette as the media query writes it, indented one level inside its @media. */
function mediaBlock() {
  const start = CSS.indexOf('  :root:not([data-theme="light"]) {\n');
  assert.ok(start >= 0, 'no prefers-color-scheme block');
  const body = CSS.slice(start, CSS.indexOf('\n  }', start));
  return new Map([...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)]
    .map(([, name, value]) => [name, value.trim()]));
}

const DAY = block(':root');
const NIGHT = block(':root[data-theme="dark"]');
const NIGHT_BY_SYSTEM = mediaBlock();

test('every token the site uses is defined', () => {
  const used = new Set(USERS.flatMap((text) => [...text.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])));
  const missing = [...used].filter((name) => !DAY.has(name));
  assert.deepStrictEqual(missing, [], `used but never defined: ${missing.join(', ')}`);
});

test('no var() carries a fallback that could stand in for a missing token', () => {
  const found = [...CSS.matchAll(/var\(--[a-z0-9-]+\s*,[^)]*\)/g)].map((m) => m[0]);
  assert.deepStrictEqual(found, [], `fallbacks: ${found.join(' ')}`);
});

test('the two ways into the night theme are the same palette', () => {
  // style.css says so in a comment: "edit one, edit the other". This is the part that checks.
  assert.deepStrictEqual(Object.fromEntries(NIGHT_BY_SYSTEM), Object.fromEntries(NIGHT));
});
