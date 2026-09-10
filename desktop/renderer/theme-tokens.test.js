/*
 * Every colour the desktop asks for exists, in both themes.
 *
 * #145: four tokens -- --paper, --danger, --accent and --sunk -- were used seventeen times and
 * defined nowhere. Each use carried an inline fallback, and every fallback was a daytime colour, so
 * the page looked right by day purely by accident and drew near-white text on a near-white toast by
 * night (about 1.09:1). Nothing was looking, which is the part worth fixing.
 *
 * So this reads the two stylesheets the desktop loads and asserts the whole class rather than the
 * four instances: nothing used is undefined, nothing hides behind a fallback, every colour the day
 * theme sets the night theme sets too, and the pairs a person has to read clear 4.5:1 in both.
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND = readFileSync(path.join(here, '..', '..', 'site', 'playground', 'playground.css'), 'utf8');
const EDITOR = readFileSync(path.join(here, 'editor.css'), 'utf8');

/** The declarations inside the first rule whose selector line is exactly `selector {`. */
function block(css, selector) {
  const start = css.indexOf(`\n${selector} {\n`);
  assert.ok(start >= 0, `no rule for ${selector} -- has the stylesheet been restructured?`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const tokens = new Map();
  for (const [, name, value] of body.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    tokens.set(name, value.trim());
  }
  return tokens;
}

const LIGHT = block(PLAYGROUND, '.viewer');
const DARK = block(PLAYGROUND, ':root[data-theme="dark"] .viewer');

/** Tokens the editor defines for itself, on its own elements. */
const EDITOR_OWN = new Set([...EDITOR.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

/*
 * Colours that are deliberately the same by day and by night, each with its reason. Anything not
 * here that the day theme sets as a colour must be set again for the night.
 */
const SAME_IN_BOTH = new Map([
  ['--sage', 'the pale green is the same hue in both themes; only its role changes, via --forest'],
  ['--forest-deep', 'a scrim and the day hover; darkening what is behind a sheet is right in both'],
]);

const isColour = (value) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(value);

test('every token either stylesheet uses is defined', () => {
  const used = new Set();
  for (const css of [PLAYGROUND, EDITOR]) {
    for (const [, name] of css.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(name);
  }
  const missing = [...used].filter((name) => !LIGHT.has(name) && !EDITOR_OWN.has(name));
  assert.deepStrictEqual(missing, [], `used but never defined: ${missing.join(', ')}`);
});

test('no var() carries a fallback that could stand in for a missing token', () => {
  // A fallback is how #145 stayed hidden: the token did not exist, and the fallback was a daytime
  // colour that looked right half the time. Without one, a missing token shows at once.
  for (const [file, css] of [['playground.css', PLAYGROUND], ['editor.css', EDITOR]]) {
    const found = [...css.matchAll(/var\(--[a-z0-9-]+\s*,[^)]*\)/g)].map((m) => m[0]);
    assert.deepStrictEqual(found, [], `${file} has fallbacks: ${found.join(' ')}`);
  }
});

test('every colour the day theme sets, the night theme sets too', () => {
  const unthemed = [...LIGHT]
    // An alias follows whatever it points at, so it flips with its target.
    .filter(([, value]) => isColour(value) && !value.startsWith('var('))
    .map(([name]) => name)
    .filter((name) => !DARK.has(name) && !SAME_IN_BOTH.has(name));
  assert.deepStrictEqual(unthemed, [], `set by day and never by night: ${unthemed.join(', ')}`);
});

test('the tokens #145 found missing are defined in both themes, or alias one that is', () => {
  for (const name of ['--paper', '--danger', '--accent', '--sunk']) {
    assert.ok(LIGHT.has(name), `${name} is not defined for the day theme`);
    const value = LIGHT.get(name);
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
    assert.ok(DARK.has(name) || (alias && DARK.has(alias)),
      `${name} does not change for the night theme`);
  }
  // A darkening wash on a dark surface is invisible, so the well has to go the other way at night.
  assert.notStrictEqual(LIGHT.get('--sunk'), DARK.get('--sunk'));
});

/* ------------------------------------------------------------------ contrast */

function resolve(theme, name, seen = new Set()) {
  const value = theme.get(name);
  assert.ok(value, `${name} has no value`);
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
  if (!alias) return value;
  assert.ok(!seen.has(alias), `${name} is an alias loop`);
  return resolve(theme, alias, seen.add(alias));
}

function luminance(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* The pairs a person has to read, as the stylesheets pair them: [text, ground, where]. */
const PAIRS = [
  ['--paper', '--ink', 'the ordinary toast'],
  ['--on-danger', '--danger', 'a refusal toast'],
  ['--ink', '--brass-surface', 'a warning toast'],
  ['--danger', '--raised', '"Delete this person" on the panel'],
  ['--ink', '--raised', 'the panel itself'],
];

for (const [label, overrides] of [['day', new Map()], ['night', DARK]]) {
  test(`every pair a person has to read clears 4.5:1 by ${label}`, () => {
    const theme = new Map([...LIGHT, ...overrides]);
    const failing = [];
    for (const [text, ground, where] of PAIRS) {
      const ratio = contrast(resolve(theme, text), resolve(theme, ground));
      if (ratio < 4.5) failing.push(`${where}: ${text} on ${ground} is ${ratio.toFixed(2)}:1`);
    }
    assert.deepStrictEqual(failing, []);
  });
}
