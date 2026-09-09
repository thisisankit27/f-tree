/*
 * The check that stands between a writer bug and somebody's family.
 *
 * The interesting cases are the ones where the writer is *wrong*, so most of these hand
 * `bytesForTree` a tree whose serialisation quietly loses something and assert that the save is
 * refused rather than performed. A test suite that only ever exercises a correct writer proves
 * the verification runs, not that it works.
 */

import test from 'node:test';
import assert from 'node:assert';

import { bytesForTree, SaveRefused } from './save.js';
import { Tree, RelationshipType } from './document.js';

const { PARENT } = RelationshipType;

function family(size = 3) {
  const tree = new Tree();
  const ids = [];
  for (let i = 0; i < size; i += 1) ids.push(tree.addPerson({ name: `P${i}` }).id);
  for (let i = 1; i < size; i += 1) {
    tree.addRelationship({ from: ids[0], to: ids[i], type: PARENT });
  }
  return { tree, ids };
}

test('a good tree produces bytes and reports what is in them', async () => {
  const { tree } = family(4);
  const saved = await bytesForTree(tree);
  assert.ok(saved.bytes.length > 0);
  assert.strictEqual(saved.people, 4);
  assert.strictEqual(saved.relationships, 3);
});

test('photos are carried and checked for', async () => {
  const { tree } = family(1);
  const photos = new Map([['photos/a.jpg', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]]);
  const saved = await bytesForTree(tree, photos);
  assert.ok(saved.bytes.length > 0);
});

/* ---------------------------------------------------------------- when the writer is wrong */

/** A tree whose serialisation is sabotaged, standing in for a writer or model bug. */
function brokenTree(sabotage) {
  const { tree } = family(5);
  const honest = tree.toExchange.bind(tree);
  tree.toExchange = (now) => sabotage(honest(now));
  return tree;
}

test('a save that would drop somebody is refused', async () => {
  /*
   * The document handed to the writer keeps all five people, but one of them carries a
   * relationship id in place of a person id, so the reader resolves fewer than were written.
   * Whatever the mechanism, the count disagrees and that is the whole point.
   */
  const tree = brokenTree((doc) => ({ ...doc, people: doc.people.slice(0, 4) }));
  await assert.rejects(() => bytesForTree(tree), (error) => {
    assert.ok(error instanceof SaveRefused);
    assert.match(error.detail, /5 people written, 4 read back|4 people written/);
    assert.match(error.detail, /file on disk is unchanged/);
    return true;
  });
});

test('a save that would drop a relationship is refused', async () => {
  const tree = brokenTree((doc) => ({ ...doc, relationships: doc.relationships.slice(0, 1) }));
  await assert.rejects(() => bytesForTree(tree), (error) => {
    assert.ok(error instanceof SaveRefused);
    assert.match(error.detail, /relationships written/);
    return true;
  });
});

test('the refusal names who went missing, not just how many', async () => {
  const tree = brokenTree((doc) => ({
    ...doc,
    people: doc.people.filter((p) => p.name !== 'P2'),
  }));
  await assert.rejects(() => bytesForTree(tree), (error) => {
    assert.match(error.detail, /P2/);
    return true;
  });
});

test('an unreadable archive is refused rather than written', async () => {
  const { tree } = family(2);
  // A person id that is not a string breaks the writer's own contract; whatever it produces,
  // it must not reach the disk unnoticed.
  const honest = tree.toExchange.bind(tree);
  tree.toExchange = (now) => {
    const doc = honest(now);
    doc.people[0] = { ...doc.people[0], id: undefined };
    return doc;
  };
  await assert.rejects(() => bytesForTree(tree), (error) => {
    assert.ok(error instanceof SaveRefused, `threw ${error.constructor.name}: ${error.message}`);
    return true;
  });
});

test('a refusal says nothing was saved, because nothing was', async () => {
  const tree = brokenTree((doc) => ({ ...doc, people: [] }));
  await assert.rejects(() => bytesForTree(tree), (error) => {
    assert.match(error.message, /f-tree/);
    assert.match(error.detail, /Nothing has been saved/);
    return true;
  });
});

/* ---------------------------------------------------------------- the empty tree */

test('an empty tree is still written, and reads back empty', async () => {
  // Not an error case: somebody who deleted everybody should be able to save that, and the
  // Android importer is the thing that decides an empty file is not worth importing.
  const saved = await bytesForTree(new Tree());
  assert.strictEqual(saved.people, 0);
  assert.strictEqual(saved.relationships, 0);
});
