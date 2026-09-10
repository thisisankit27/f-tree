/*
 * The last few inches, where a family tree meets a disk.
 *
 * Everything upstream of this has been checked in memory. What is left is the part memory cannot
 * help with: the machine losing power, the disk filling up, or the process dying between opening
 * a file and finishing it. The property under test is not "the bytes arrive" but **the path never
 * holds a partial file**, which is what a rename buys and what a plain write does not.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeTreeFile } = require('./atomic');

async function scratch() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ftree-atomic-'));
}

const bytes = (text) => new Uint8Array(Buffer.from(text));

test('a new file is written', async () => {
  const dir = await scratch();
  const target = path.join(dir, 'tree.ftree');
  await writeTreeFile(target, bytes('hello'));
  assert.strictEqual(await fs.readFile(target, 'utf8'), 'hello');
});

test('a second write replaces the first, and leaves nothing beside it', async () => {
  // No `.bak` any more: earlier versions are kept by backups.js, away from the reader's folder.
  const dir = await scratch();
  const target = path.join(dir, 'tree.ftree');
  for (const text of ['one', 'two', 'three']) await writeTreeFile(target, bytes(text));

  assert.strictEqual(await fs.readFile(target, 'utf8'), 'three');
  assert.deepStrictEqual(await fs.readdir(dir), ['tree.ftree']);
  assert.ok(!fssync.existsSync(`${target}.bak`));
});

test('nothing temporary is left behind', async () => {
  const dir = await scratch();
  await writeTreeFile(path.join(dir, 'tree.ftree'), bytes('x'));
  const left = await fs.readdir(dir);
  assert.deepStrictEqual(left, ['tree.ftree'], `left over: ${left.join(', ')}`);
});

test('a failure leaves the original exactly as it was', async () => {
  const dir = await scratch();
  const target = path.join(dir, 'tree.ftree');
  await writeTreeFile(target, bytes('the good version'));

  // A directory cannot be renamed over a file, so the rename fails after the temp file is
  // written -- the window this test exists for.
  const saboteur = path.join(dir, `.tree.ftree.saving-${process.pid}`);
  await assert.rejects(async () => {
    await fs.mkdir(saboteur, { recursive: true });
    await fs.writeFile(path.join(saboteur, 'in the way'), 'blocked');
    await writeTreeFile(target, bytes('the bad version'));
  });

  assert.strictEqual(await fs.readFile(target, 'utf8'), 'the good version',
    'the tree on disk must survive a failed save');
});

test('a save into a directory that does not exist fails without touching anything', async () => {
  const dir = await scratch();
  const target = path.join(dir, 'nowhere', 'tree.ftree');
  await assert.rejects(() => writeTreeFile(target, bytes('x')));
  assert.deepStrictEqual(await fs.readdir(dir), []);
});

test('binary content survives byte for byte', async () => {
  const dir = await scratch();
  const target = path.join(dir, 'tree.ftree');
  const payload = new Uint8Array(4096);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 7) % 256;

  await writeTreeFile(target, payload);
  const back = new Uint8Array(await fs.readFile(target));
  assert.deepStrictEqual(back, payload);
});

test('the target holds the old file until the moment it holds the new one', async () => {
  /*
   * The property a plain write cannot offer. Reading the path repeatedly while a much larger
   * version is written must never observe a truncated or partly-written file: every read is one
   * of the two complete versions.
   */
  const dir = await scratch();
  const target = path.join(dir, 'tree.ftree');
  const small = bytes('a'.repeat(1024));
  const large = bytes('b'.repeat(4 * 1024 * 1024));
  await writeTreeFile(target, small);

  let observations = 0;
  let torn = null;
  const watching = (async () => {
    while (torn === null && observations < 5000) {
      const seen = await fs.readFile(target).catch(() => null);
      if (seen === null) { torn = 'the path was empty'; break; }
      const text = seen.toString('utf8');
      const whole = (seen.length === small.length && text === 'a'.repeat(1024))
        || (seen.length === large.length && text === 'b'.repeat(large.length));
      if (!whole) { torn = `saw ${seen.length} bytes, neither version`; break; }
      observations += 1;
    }
  })();

  await writeTreeFile(target, large);
  torn ??= 'done';
  await watching;

  assert.strictEqual(torn, 'done', torn);
  assert.ok(observations > 0, 'the watcher never actually read the file');
});
