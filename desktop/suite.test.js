// Every test file this directory holds is actually run by a script here.
//
// The bug this exists for: `identity.test.js` was written, passed, and then ran nowhere for
// several releases, because the `test` script names its files one by one and nobody added it.
// Eight tests guarding the installation identity -- the thing that stops two desktop-made trees
// claiming the same origin and merging strangers -- were dead the whole time, and a dead suite
// looks exactly like a passing one from the outside.
//
// The list stays explicit rather than becoming a glob: `package.test.js` reads a built artifact
// and belongs to `test:package`, which runs after `pack:linux`. So the check is not "use a
// glob", it is "every file is claimed by some script", and a new test file that nobody wired up
// fails here.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// The scripts that run tests, and the directories a test file may live in. Both are stated
// rather than discovered, so adding either is a deliberate edit to this file.
const RUNNERS = ['test', 'test:package'];
const TEST_DIRS = ['.', 'renderer'];

function testFiles() {
  const found = [];
  for (const dir of TEST_DIRS) {
    for (const name of fs.readdirSync(path.join(__dirname, dir))) {
      if (name.endsWith('.test.js')) found.push(dir === '.' ? name : `${dir}/${name}`);
    }
  }
  return found.sort();
}

// The file arguments a script passes to `node --test`, unquoted. Split into whole tokens rather
// than matched as substrings: `renderer/*.test.js` *contains* `*.test.js`, so a substring test
// would report every top-level file as covered by the renderer glob -- which is the exact hole
// this file exists to close, found by removing identity.test.js and watching the check pass.
function argumentsOf(script) {
  return script.split(/\s+/).map((token) => token.replace(/^"|"$/g, '')).filter(Boolean);
}

// A script "claims" a file if it names it outright or by the glob over its own directory.
// Deliberately literal: this is not a shell, and a pattern it cannot understand should read as
// unclaimed rather than be waved through.
function claims(script, file) {
  const dir = path.dirname(file);
  const patterns = new Set([file, dir === '.' ? '*.test.js' : `${dir}/*.test.js`]);
  return argumentsOf(script).some((arg) => patterns.has(arg));
}

test('every test file is run by some npm script', () => {
  const scripts = RUNNERS.map((name) => pkg.scripts[name] || '');
  const orphans = testFiles().filter((file) => !scripts.some((s) => claims(s, file)));
  assert.deepStrictEqual(
    orphans,
    [],
    `these test files are never run -- add them to "${RUNNERS[0]}" in package.json: ${orphans.join(', ')}`,
  );
});

test('the scripts do not name test files that no longer exist', () => {
  const present = new Set(testFiles());
  const named = [];
  for (const name of RUNNERS) {
    for (const file of argumentsOf(pkg.scripts[name] || '')) {
      if (file.endsWith('.test.js') && !file.includes('*')) named.push(file);
    }
  }
  assert.deepStrictEqual(named.filter((f) => !present.has(f)), []);
});

test('identity.test.js in particular is run', () => {
  // Named on purpose. The general check above would pass again if this file were deleted along
  // with the tests, and the installation identity is not a thing to lose quietly.
  assert.ok(claims(pkg.scripts.test, 'identity.test.js'));
});
