/*
 * The installation id.
 *
 * What is being defended: two trees created on two different desktops must never claim the same
 * origin, and one desktop must never change its mind about who it is. Both failures are silent
 * and both merge strangers into somebody's family on the next import.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { installationId, IDENTITY_FILE } = require('./identity');

const scratch = () => fs.mkdtemp(path.join(os.tmpdir(), 'ftree-identity-'));

test('an id is minted on first run', async () => {
  const dir = await scratch();
  const id = await installationId(dir);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('the same installation keeps the same id', async () => {
  const dir = await scratch();
  const first = await installationId(dir);
  const second = await installationId(dir);
  const third = await installationId(dir);
  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
});

test('two installations never share an id', async () => {
  const [a, b] = [await scratch(), await scratch()];
  assert.notStrictEqual(await installationId(a), await installationId(b));
});

test('the id survives a restart, because it is on disk not in memory', async () => {
  const dir = await scratch();
  const before = await installationId(dir);
  const written = JSON.parse(await fs.readFile(path.join(dir, IDENTITY_FILE), 'utf8'));
  assert.strictEqual(written.treeId, before);
});

test('a directory that does not exist yet is made', async () => {
  const dir = path.join(await scratch(), 'not', 'created', 'yet');
  assert.ok(await installationId(dir));
});

test('an unreadable identity file is replaced rather than refusing to start', async () => {
  // There is nothing to recover from a corrupt id, and refusing to open somebody's tree over it
  // would be a worse answer than starting again. It is still a real loss of continuity, so this
  // pins the behaviour rather than leaving it to chance.
  const dir = await scratch();
  await fs.writeFile(path.join(dir, IDENTITY_FILE), 'this is not json');
  const id = await installationId(dir);
  assert.ok(id);
  assert.strictEqual(await installationId(dir), id, 'and the replacement then sticks');
});

test('an identity file with an empty id is treated as absent', async () => {
  const dir = await scratch();
  await fs.writeFile(path.join(dir, IDENTITY_FILE), JSON.stringify({ treeId: '' }));
  const id = await installationId(dir);
  assert.ok(id, 'an empty id is exactly the value that must never be written to a tree');
});

test('nothing temporary is left behind', async () => {
  const dir = await scratch();
  await installationId(dir);
  assert.deepStrictEqual(await fs.readdir(dir), [IDENTITY_FILE]);
});
