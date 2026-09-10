/*
 * The rotating backups behind autosave (#149).
 *
 * The policy is the part worth pinning down, because it is the part nobody will notice is wrong
 * until the day they need a backup: one before the first write of a run, then one per ten minutes,
 * five kept. So it is a pure function under a table, and the file-handling around it is exercised
 * against a real temporary directory.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { KEEP, INTERVAL_MS, stampFor, timeOf, folderFor, plan, backUpBefore } = require('./backups');

const at = (iso) => new Date(iso);

/* ------------------------------------------------------------------ names */

test('a stamp sorts as text in time order and has no colon in it', () => {
  const a = stampFor(at('2026-09-11T09:05:07.001Z'));
  const b = stampFor(at('2026-09-11T10:00:00.000Z'));
  assert.ok(a < b);
  assert.ok(!a.includes(':'), 'a colon is not legal in a Windows file name');
  assert.strictEqual(timeOf(a), at('2026-09-11T09:05:07.001Z').getTime());
});

test('a file that is not a stamp is not counted as a backup', () => {
  assert.ok(Number.isNaN(timeOf('README.txt')));
  assert.ok(Number.isNaN(timeOf('family.ftree')));
});

test('two trees with the same name in different folders get different backup folders', () => {
  const a = folderFor('/b', '/home/a/family.ftree');
  const b = folderFor('/b', '/home/b/family.ftree');
  assert.notStrictEqual(a, b);
  assert.match(path.basename(a), /^family-[0-9a-f]{10}$/, 'named for the tree, so a person can tell');
});

test('a name with nothing usable in it still gets a folder', () => {
  assert.match(path.basename(folderFor('/b', '/x/%%%.ftree')), /^tree-[0-9a-f]{10}$/);
});

/* ------------------------------------------------------------------ when */

const stamps = (...isos) => isos.map((iso) => stampFor(at(iso)));

test('the first write of a run always takes one, however recent the last', () => {
  // Opening a tree and spoiling it must always leave the version that was opened.
  const existing = stamps('2026-09-11T10:00:00Z');
  const now = at('2026-09-11T10:00:05Z');
  assert.strictEqual(plan({ existing, takenThisRun: false, now }).take, true);
});

test('after that, not again until ten minutes have passed', () => {
  const existing = stamps('2026-09-11T10:00:00Z');
  const soon = at('2026-09-11T10:09:59Z');
  const later = new Date(at('2026-09-11T10:00:00Z').getTime() + INTERVAL_MS);
  assert.strictEqual(plan({ existing, takenThisRun: true, now: soon }).take, false);
  assert.strictEqual(plan({ existing, takenThisRun: true, now: later }).take, true);
});

test('a folder with nothing in it takes one', () => {
  assert.strictEqual(plan({ existing: [], takenThisRun: true, now: at('2026-09-11T10:00:00Z') }).take,
    true);
});

test('five are kept, and the oldest go first', () => {
  const existing = stamps('2026-09-11T08:00:00Z', '2026-09-11T08:20:00Z', '2026-09-11T08:40:00Z',
    '2026-09-11T09:00:00Z', '2026-09-11T09:20:00Z');
  const { take, prune } = plan({ existing, takenThisRun: true, now: at('2026-09-11T10:00:00Z') });
  assert.strictEqual(KEEP, 5);
  assert.strictEqual(take, true);
  assert.deepStrictEqual(prune, [existing[0]], 'one in, the oldest out');
});

test('nothing is pruned on a write that takes nothing', () => {
  const existing = stamps('2026-09-11T08:00:00Z', '2026-09-11T08:20:00Z', '2026-09-11T08:40:00Z',
    '2026-09-11T09:00:00Z', '2026-09-11T09:55:00Z');
  const { take, prune } = plan({ existing, takenThisRun: true, now: at('2026-09-11T10:00:00Z') });
  assert.strictEqual(take, false);
  assert.deepStrictEqual(prune, []);
});

test('a README among the backups is neither counted nor pruned', () => {
  const existing = ['README.txt', ...stamps('2026-09-11T08:00:00Z')];
  const { prune } = plan({ existing, takenThisRun: false, now: at('2026-09-11T10:00:00Z'), keep: 1 });
  assert.deepStrictEqual(prune, stamps('2026-09-11T08:00:00Z'));
});

/* ------------------------------------------------------------------ on a real disk */

async function scratch() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ftree-backups-'));
}

test('the version on disk is copied before it is replaced, and the folder says whose it is', async () => {
  const dir = await scratch();
  const target = path.join(dir, 'family.ftree');
  const root = path.join(dir, 'backups');
  await fs.writeFile(target, 'as opened');

  const written = await backUpBefore(target, { root, takenThisRun: new Set(),
    now: at('2026-09-11T10:00:00Z') });

  assert.strictEqual(await fs.readFile(written, 'utf8'), 'as opened');
  const readme = await fs.readFile(path.join(path.dirname(written), 'README.txt'), 'utf8');
  assert.ok(readme.includes(target), 'names the tree it holds versions of');
  assert.deepStrictEqual((await fs.readdir(dir)).sort(), ['backups', 'family.ftree'],
    'nothing is left beside the reader’s file');
});

test('a new file has nothing to back up', async () => {
  const dir = await scratch();
  const written = await backUpBefore(path.join(dir, 'new.ftree'),
    { root: path.join(dir, 'backups'), takenThisRun: new Set() });
  assert.strictEqual(written, null);
});

test('a run of writes a second apart makes one backup, not one each', async () => {
  const dir = await scratch();
  const target = path.join(dir, 'family.ftree');
  const root = path.join(dir, 'backups');
  const takenThisRun = new Set();
  let clock = at('2026-09-11T10:00:00Z').getTime();

  for (let i = 0; i < 20; i += 1) {
    await fs.writeFile(target, `version ${i}`);
    await backUpBefore(target, { root, takenThisRun, now: new Date(clock) });
    clock += 1000;
  }
  const kept = (await fs.readdir(folderFor(root, target))).filter((n) => n.endsWith('.ftree'));
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(await fs.readFile(path.join(folderFor(root, target), kept[0]), 'utf8'),
    'version 0', 'and it is the version from before the first write');
});

test('an afternoon of writing keeps five, the newest five', async () => {
  const dir = await scratch();
  const target = path.join(dir, 'family.ftree');
  const root = path.join(dir, 'backups');
  const takenThisRun = new Set();
  let clock = at('2026-09-11T13:00:00Z').getTime();

  for (let i = 0; i < 9; i += 1) {
    await fs.writeFile(target, `version ${i}`);
    await backUpBefore(target, { root, takenThisRun, now: new Date(clock) });
    clock += INTERVAL_MS;
  }
  const folder = folderFor(root, target);
  const kept = (await fs.readdir(folder)).filter((n) => n.endsWith('.ftree')).sort();
  assert.strictEqual(kept.length, 5);
  assert.strictEqual(await fs.readFile(path.join(folder, kept[0]), 'utf8'), 'version 4');
  assert.strictEqual(await fs.readFile(path.join(folder, kept[4]), 'utf8'), 'version 8');
});
