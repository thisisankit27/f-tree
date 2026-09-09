/*
 * The update rules, as a table.
 *
 * Run with `node --test desktop/`. These are the same awkward cases the Android app settles in
 * `ReleaseTest.kt`, asked of the desktop's own rules - a draft, a beta nobody asked for, a release
 * with no file this platform can use, a tag that is not a version, and the stable build that
 * overtakes a beta.
 */
const test = require('node:test');
const assert = require('node:assert');
const { parseVersion, compareVersions, chooseUpdate } = require('./update');

const exe = (v) => ({ name: `f-tree.Setup.${v}.exe`, size: 1, digest: 'sha256:' + 'a'.repeat(64),
  browser_download_url: `https://example.invalid/f-tree.Setup.${v}.exe` });
const appimage = (v) => ({ name: `f-tree-${v}.AppImage`, size: 1, digest: 'sha256:' + 'b'.repeat(64),
  browser_download_url: `https://example.invalid/f-tree-${v}.AppImage` });
const deb = (v) => ({ name: `f-tree-desktop_${v}_amd64.deb`, size: 1,
  browser_download_url: `https://example.invalid/x.deb` });

const release = (tag, assets, extra = {}) => ({
  tag_name: tag, assets, html_url: 'https://example.invalid/r', body: 'notes', ...extra,
});

const ask = (releases, opts = {}) => chooseUpdate({
  releases, currentVersion: '0.1.1', platform: 'win32', ...opts,
});

test('a newer stable release is offered', () => {
  const found = ask([release('desktop-v0.2.0', [exe('0.2.0')])]);
  assert.equal(found.kind, 'newer');
  assert.equal(found.version, '0.2.0');
  assert.equal(found.file.sha256, 'a'.repeat(64));
});

test('the same version is up to date, not an update', () => {
  assert.equal(ask([release('desktop-v0.1.1', [exe('0.1.1')])]).kind, 'up-to-date');
});

test('an older release is never offered', () => {
  assert.equal(ask([release('desktop-v0.1.0', [exe('0.1.0')])]).kind, 'up-to-date');
});

test('a beta is ignored unless the reader asked for betas', () => {
  const betas = [release('desktop-v0.2.0-beta.1', [exe('0.2.0-beta.1')])];
  assert.equal(ask(betas).kind, 'up-to-date');
  assert.equal(ask(betas, { allowPreRelease: true }).kind, 'newer');
});

test('a stable release supersedes a newer-looking beta of the same number', () => {
  const found = ask([
    release('desktop-v0.2.0-beta.2', [exe('0.2.0-beta.2')]),
    release('desktop-v0.2.0', [exe('0.2.0')]),
  ], { allowPreRelease: true });
  assert.equal(found.version, '0.2.0');
});

test('drafts never count', () => {
  assert.equal(ask([release('desktop-v0.9.0', [exe('0.9.0')], { draft: true })]).kind,
    'no-usable-release');
});

test("the Android app's own releases are not desktop releases", () => {
  // The single most important case: a phone release must never be offered to a laptop.
  assert.equal(ask([release('v9.9.9', [{ name: 'f-tree-9.9.9.apk', size: 1,
    browser_download_url: 'https://example.invalid/a.apk' }])]).kind, 'no-usable-release');
});

/*
 * The bug that started this: an AppImage will not start at all on a system whose `fusermount` is
 * FUSE 3, which is every Ubuntu from 24.04. Handing one to somebody who installed the .deb would
 * be handing them a file that does nothing when they double-click it.
 */
test('an AppImage is offered only to somebody already running one', () => {
  const releases = [release('desktop-v0.2.0', [appimage('0.2.0'), deb('0.2.0')])];

  const fromDeb = ask(releases, { platform: 'linux' });
  assert.equal(fromDeb.kind, 'newer', 'a .deb install should still be told there is a new version');
  assert.equal(fromDeb.file, null, 'but handed no file it cannot install');

  const fromAppImage = ask(releases, { platform: 'linux', linuxFormat: 'appimage' });
  assert.equal(fromAppImage.kind, 'newer');
  assert.match(fromAppImage.file.name, /\.AppImage$/);
});

test('Windows is always handed its installer', () => {
  const found = ask([release('desktop-v0.2.0', [exe('0.2.0'), deb('0.2.0')])]);
  assert.match(found.file.name, /\.exe$/);
});

test('a missing or malformed digest is reported as absent rather than trusted', () => {
  const found = ask([release('desktop-v0.2.0',
    [{ ...exe('0.2.0'), digest: 'md5:whatever' }])]);
  assert.equal(found.file.sha256, null);
});

test('a download that is not https is never handed over', () => {
  // The release is still announced - it exists - but the app will not fetch it over plain http,
  // so there is no file to offer and the reader is sent to the page instead.
  const found = ask([release('desktop-v0.2.0', [{ ...exe('0.2.0'),
    browser_download_url: 'http://example.invalid/x.exe' }])]);
  assert.equal(found.kind, 'newer');
  assert.equal(found.file, null);
});

test('version ordering', () => {
  assert.equal(compareVersions(parseVersion('desktop-v0.10.0'), parseVersion('desktop-v0.9.0')), 1);
  assert.equal(compareVersions(parseVersion('v1.0.0'), parseVersion('v1.0')), 0);
  assert.equal(parseVersion('desktop-vnope'), null);
  assert.equal(parseVersion(''), null);
});
