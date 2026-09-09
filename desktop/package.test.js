// What the Linux package promises the operating system.
//
// These read the built artifact, not the sources. The bug they exist for (#102) was not in
// anything this repo wrote: electron-builder generated a postinst whose sandbox probe is
// unsound on Ubuntu 24.04+, and the app core-dumped before drawing a window. A test that read
// package.json would have passed while the shipped deb was broken, so these open the deb.
//
// The deb tests skip, loudly, when there is no artifact to read -- so a missing build never
// masquerades as a passing suite. Run `npm run pack:linux` first, as CI does. The fixture test
// never skips: it proves these assertions reject the postinst that actually shipped broken.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DIST = path.join(__dirname, 'dist');
const SANDBOX = "'/opt/f-tree/chrome-sandbox'";

function newestDeb() {
  if (!fs.existsSync(DIST)) return null;
  const debs = fs.readdirSync(DIST)
    .filter((f) => f.endsWith('.deb'))
    .map((f) => path.join(DIST, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return debs[0] || null;
}

function postinstOf(deb) {
  return execFileSync('dpkg-deb', ['--info', deb, 'postinst'], { encoding: 'utf8' });
}

// The script that runs, with the prose stripped out. Our postinst explains the bug it fixes,
// and that explanation names the probe it removed -- so a search over the raw text would find
// `unshare` in a comment and call the bug present. Assert against what bash executes.
function code(postinst) {
  return postinst.split('\n').filter((line) => !line.trim().startsWith('#'));
}

// Whether the chmod is reached on every path, or sits in one branch of an if.
function chmodIsConditional(lines) {
  const at = lines.findIndex((l) => l.includes('chmod 4755'));
  if (at < 0) return 'there is no chmod 4755 at all';

  let closed = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (line === 'fi' || line.endsWith('; fi')) closed += 1;
    else if (line.startsWith('if ') || line.startsWith('elif ') || line === 'else') {
      if (closed === 0) return `it sits inside a conditional opened by: ${line}`;
      if (line.startsWith('if ')) closed -= 1;
    }
  }
  return null;
}

// Every way this postinst could leave Chromium without a usable sandbox helper.
function sandboxComplaints(postinst) {
  const lines = code(postinst);
  const script = lines.join('\n');
  const found = [];

  if (!script.includes(`chmod 4755 ${SANDBOX}`)) found.push('never sets the SUID bit');
  if (!script.includes(`chown root:root ${SANDBOX}`)) found.push('never gives root the file');
  // The defect itself. `unshare --user true` answers "can a namespace be created", but
  // Chromium needs "does a created namespace keep CAP_SYS_ADMIN" -- and under Ubuntu's
  // apparmor_restrict_unprivileged_userns those answers differ.
  if (script.includes('unshare --user')) found.push('decides by probing for user namespaces');
  if (script.includes(`chmod 0755 ${SANDBOX}`)) found.push('has a branch that strips the bit');

  const conditional = chmodIsConditional(lines);
  if (conditional) found.push(conditional);
  return found;
}

const deb = newestDeb();
const noDeb = deb ? false : 'no .deb in dist/ -- run `npm run pack:linux` first';

test('the deb hands Chromium a sandbox helper it can use', { skip: noDeb }, () => {
  assert.deepStrictEqual(sandboxComplaints(postinstOf(deb)), []);
});

test('replacing the stock postinst kept everything else it did', { skip: noDeb }, () => {
  const script = postinstOf(deb);
  assert.match(script, /update-alternatives --install '\/usr\/bin\/f-tree-desktop'/,
    'the binary has to land on PATH');
  assert.match(script, /update-mime-database/, 'the .ftree association needs this');
  assert.match(script, /update-desktop-database/, 'the launcher entry needs this');
});

test('these assertions reject the postinst that actually shipped broken', () => {
  const shipped = fs.readFileSync(
    path.join(__dirname, 'test-fixtures', 'stock-electron-builder-postinst.sh'), 'utf8');

  assert.deepStrictEqual(sandboxComplaints(shipped), [
    'never gives root the file',
    'decides by probing for user namespaces',
    'has a branch that strips the bit',
    'it sits inside a conditional opened by: '
      + 'if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then',
  ]);
});

/*
 * ---------------------------------------------------------------------------------------------
 * Whether the package contains the app.
 *
 * 0.4.0 shipped dead. `main.js` requires `./atomic` and `./identity`; the `files` list in
 * package.json was an allowlist of four filenames written before either existed, so neither was
 * packaged, and the app threw `Cannot find module './atomic'` before it drew a window.
 *
 * Every test in this repo was green. The smoke test starts `npx electron .` from a checkout,
 * where every file is present by definition -- it can never see a packaging mistake. The tests
 * above read the built deb but only ever asked about the postinst. Nothing asked the one
 * question that mattered: does the thing we are about to upload contain its own source.
 *
 * So these walk the require graph from the entry point recorded in the packaged package.json and
 * insist every relative specifier resolves *inside the archive*. The `files` list is now an
 * exclusion list rather than an allowlist -- forgetting an exclusion wastes a few KB, forgetting
 * an inclusion bricks the release -- and this is what holds that decision in place.
 *
 * These read `linux-unpacked`, which every `--linux` build writes, and which holds the same
 * `resources/` the deb, the tarball and the AppImage are each built from.
 */

const asar = require('@electron/asar');

// Defaults to the build just made, but can be pointed at any installed copy -- an unpacked deb,
// or /opt/f-tree itself. That is not test scaffolding: it is how these assertions were shown to
// reject the 0.4.0 that shipped, rather than only to accept the build that replaced it.
const RESOURCES = process.env.FTREE_PACKAGE_UNDER_TEST
  || path.join(DIST, 'linux-unpacked', 'resources');
const ARCHIVE = path.join(RESOURCES, 'app.asar');
const noPackage = fs.existsSync(ARCHIVE)
  ? false
  : 'no dist/linux-unpacked -- run `npx electron-builder --linux` first';

// Node's own resolution order for a relative specifier, which is what `require` will do at run
// time. Checking only for the literal path would miss `require('./atomic')` finding `atomic.js`.
function resolveIn(files, fromDir, specifier) {
  const base = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [base, `${base}.js`, `${base}.json`, path.posix.join(base, 'index.js')];
  return candidates.find((c) => files.has(c)) || null;
}

const RELATIVE_REQUIRE = /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g;

test('every module the main process requires is inside the package', { skip: noPackage }, () => {
  const files = new Set(
    asar.listPackage(ARCHIVE).map((f) => f.replace(/^[/\\]/, '').split(path.sep).join('/')));
  const read = (f) => asar.extractFile(ARCHIVE, f).toString('utf8');

  const entry = JSON.parse(read('package.json')).main;
  assert.ok(files.has(entry), `package.json names "${entry}" as main and it is not packaged`);

  const missing = [];
  const seen = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || !file.endsWith('.js')) continue;
    seen.add(file);

    const dir = path.posix.dirname(file);
    for (const [, specifier] of read(file).matchAll(RELATIVE_REQUIRE)) {
      const target = resolveIn(files, dir, specifier);
      if (target) queue.push(target);
      else missing.push(`${file} requires '${specifier}', which is not in the package`);
    }
  }

  assert.deepStrictEqual(missing, []);
  // A graph that walked nowhere would pass the assertion above while proving nothing.
  assert.ok(seen.size > 1, `only reached ${seen.size} file(s) from ${entry}; the walk found nothing`);
});

/*
 * The other half of the app, which does not travel in the asar at all.
 *
 * The window's page ships through `extraResources`, and its modules import across a directory
 * boundary that only exists once packaged: the renderer sits at `page/renderer` and reaches the
 * viewer engine at `page/site/playground` through `../../site/playground/`. That works in a
 * checkout for a different reason than it works in a package, so a wrong `to:` in extraResources
 * would leave the window blank with the failure visible only in a devtools console nobody opens.
 *
 * Browsers resolve module specifiers literally, so unlike require there is no extension guessing.
 */
test('the window\'s page and every module it imports are packaged', { skip: noPackage }, () => {
  const main = asar.extractFile(ARCHIVE, 'main.js').toString('utf8');
  const viewer = main.match(/process\.resourcesPath\s*,\s*((?:\s*'[^']+'\s*,?)+)\)/);
  assert.ok(viewer, 'main.js no longer builds the packaged page path in a readable way');

  // Read the path out of main.js rather than restating it here. A test that hard-codes the
  // layout agrees with itself when the layout is what moved.
  const entry = path.posix.join(...[...viewer[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const abs = (f) => path.join(RESOURCES, f);
  assert.ok(fs.existsSync(abs(entry)), `main.js loads ${entry} and it is not packaged`);

  const html = fs.readFileSync(abs(entry), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*\bsrc=['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(scripts.length, `${entry} loads no scripts; this test would prove nothing`);

  const missing = [];
  const seen = new Set();
  const queue = scripts.map((s) => path.posix.join(path.posix.dirname(entry), s));

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fs.existsSync(abs(file))) {
      missing.push(`${file} is imported and not packaged`);
      continue;
    }
    const source = fs.readFileSync(abs(file), 'utf8');
    const specifiers = [
      ...[...source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]),
      ...[...source.matchAll(/\bimport\s*\(?\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]),
    ];
    for (const specifier of specifiers) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
    }
  }

  assert.deepStrictEqual(missing, []);
  assert.ok(seen.size > 1, `only reached ${seen.size} module(s) from ${entry}`);
});
