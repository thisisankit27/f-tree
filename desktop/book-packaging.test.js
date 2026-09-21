// Which of site/book the packaged desktop app carries (#247).
//
// The book's page ships through `extraResources`, filtered by the patterns in package.json. The
// storybook's authored art (site/book/art/src: SVG sources, swatches) and the style frames are for
// people making the art, and must stay out; the compiled art (site/book/art/papercut/*.js) and
// the procedural generators (site/book/art/procedural/*.js) are what the composer imports, and
// must ship, or the book screen fails to load its modules. This runs the real site/book tree
// through electron-builder's own FileMatcher with the patterns package.json declares, so it
// answers the question without building a package: a wrong pattern fails here, in `npm test`.
// package.test.js asks the same of a built linux-unpacked when there is one.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { FileMatcher } = require('app-builder-lib/out/fileMatcher');

const BOOK = path.resolve(__dirname, '..', 'site', 'book');

/** electron-builder's own filter for the site/book extraResources entry. */
function bookFilter() {
  const entry = require('./package.json').build.extraResources.find((e) => e.from === '../site/book');
  assert.ok(entry, 'package.json no longer ships ../site/book as an extraResource');
  // the one macro these patterns use, as platformPackager.js expands it
  const expand = (s) => s.replace(/\$\{\/\*\}/g, '{,/**/*}');
  const filter = new FileMatcher(BOOK, entry.to, expand, entry.filter).createFilter();
  return (rel) => filter(path.join(BOOK, rel), fs.statSync(path.join(BOOK, rel)));
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(path.join(BOOK, dir))) {
    const rel = path.join(dir, name);
    if (fs.statSync(path.join(BOOK, rel)).isDirectory()) walk(rel, out);
    else out.push(rel.split(path.sep).join('/'));
  }
  return out;
}

test('the packaged book carries the compiled art and leaves out the authored sources', () => {
  const ships = bookFilter();
  const files = walk('art');
  const compiled = files.filter((f) => /^art\/(papercut|procedural)\/[^/]+\.js$/.test(f));
  const authored = files.filter((f) => f.startsWith('art/src/') || f.startsWith('art/style-frames/'));
  assert.ok(compiled.length >= 5, `expected the five compiled art modules, found ${compiled.join(', ')}`);
  assert.ok(authored.some((f) => f.endsWith('.svg')), 'expected authored SVG under art/src to test against');
  assert.deepStrictEqual(compiled.filter((f) => !ships(f)), [], 'compiled art the composer imports must ship');
  assert.deepStrictEqual(authored.filter((f) => ships(f)), [], 'authored art sources and style frames must not ship');
  for (const f of ['art/draw.js', 'art/index.js', 'art/seed.js']) assert.ok(ships(f), `${f} must ship`);
  assert.ok(!ships('art/README.md'), 'art/README.md must not ship');
  assert.ok(!ships('fixtures/art/relative.svg'), 'the compiler\'s test fixtures must not ship');
});
