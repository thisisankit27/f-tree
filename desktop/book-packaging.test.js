// Which of site/book the packaged desktop app carries (#247).
//
// The book's page ships through `extraResources`, filtered by the patterns in package.json. The
// storybook's authored art (site/book/art/src: SVG sources, swatches) and the style frames are for
// people making the art, and must stay out; the compiled art (site/book/art/papercut/*.js) and
// the procedural generators (site/book/art/procedural/*.js) are what the composer imports, and
// must ship, or the book screen fails to load its modules. This reads the patterns themselves, so
// `npm test` catches a wrong one without building a package; package.test.js asks the same of a
// built linux-unpacked when there is one.

const test = require('node:test');
const assert = require('node:assert');

const entry = require('./package.json').build.extraResources.find((e) => e.from === '../site/book');

test('the packaged book leaves out the authored art and keeps the compiled art', () => {
  assert.ok(entry, 'package.json no longer ships ../site/book as an extraResource');
  const filter = entry.filter;
  assert.strictEqual(filter[0], '**/*', 'the book ships whole, less what is excluded');
  for (const out of ['!art/src${/*}', '!art/style-frames${/*}', '!art/README.md', '!fixtures${/*}']) {
    assert.ok(filter.includes(out), `package.json must exclude ${out.slice(1)} from the packaged book`);
  }
  // Nothing may exclude the art the composer imports: not the modules, not their directories,
  // not a pattern broad enough to catch them.
  const ships = ['art/papercut/motifs.js', 'art/procedural/x.js', 'art/draw.js', 'art/index.js', 'art/seed.js'];
  const excludes = filter.filter((p) => p.startsWith('!')).map((p) => p.slice(1).replace('${/*}', ''));
  // any glob but the test-file one is treated as broad enough to catch them: better loud than lost
  const catches = (p, file) => p !== '*.test.mjs' && (/[*?{[]/.test(p) || file === p || file.startsWith(`${p}/`));
  for (const file of ships) {
    const hit = excludes.find((p) => catches(p, file));
    assert.strictEqual(hit, undefined, `the exclusion !${hit} would keep ${file} out of the package`);
  }
});
