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
