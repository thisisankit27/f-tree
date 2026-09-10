/*
 * The editable tree.
 *
 * What is being defended here is somebody's family record, so the cases that matter are the ones
 * where an editor quietly loses something: an undo that half-restores, a delete that leaves edges
 * pointing at nobody, a screen that saves a field it never showed as empty.
 */

import test from 'node:test';
import assert from 'node:assert';

import { Tree, RelationshipType, Rejection } from './document.js';
import { writeTreeArchive } from '../../site/playground/write.js';
import { openArchive, parseDocument } from '../../site/playground/archive.js';

const { PARENT, SPOUSE, SIBLING } = RelationshipType;

function family() {
  const tree = new Tree();
  const father = tree.addPerson({ name: 'Shyam', gender: 'MALE' }).id;
  const mother = tree.addPerson({ name: 'Kamla', gender: 'FEMALE' }).id;
  const child = tree.addPerson({ name: 'Ravi', gender: 'MALE' }).id;
  tree.addRelationship({ from: father, to: child, type: PARENT });
  tree.addRelationship({ from: mother, to: child, type: PARENT });
  tree.addRelationship({ from: father, to: mother, type: SPOUSE });
  return { tree, father, mother, child };
}

/* ---------------------------------------------------------------- people */

test('a person is added with an id and read back', () => {
  const tree = new Tree();
  const added = tree.addPerson({ name: 'Ada', gender: 'FEMALE' });
  assert.ok(added.ok && added.id);
  assert.strictEqual(tree.person(added.id).name, 'Ada');
  assert.strictEqual(tree.people.length, 1);
});

test('fields the format does not have are ignored, not stored', () => {
  const tree = new Tree();
  const { id } = tree.addPerson({ name: 'Ada', favouriteColour: 'green', id: 'chosen' });
  assert.strictEqual(id, 'chosen');
  assert.ok(!('favouriteColour' in tree.person(id)));
});

test('a name typed and then cleared is absent, not empty', () => {
  const tree = new Tree();
  const { id } = tree.addPerson({ name: '   ' });
  assert.ok(!('name' in tree.person(id)), JSON.stringify(tree.person(id)));
});

test('deceased is stored only when true, as the format does', () => {
  const tree = new Tree();
  const alive = tree.addPerson({ name: 'A', deceased: false }).id;
  const gone = tree.addPerson({ name: 'B', deceased: true }).id;
  assert.ok(!('deceased' in tree.person(alive)));
  assert.strictEqual(tree.person(gone).deceased, true);
});

test('editing one field leaves the others alone', () => {
  const tree = new Tree();
  const { id } = tree.addPerson({ name: 'Ada', birthDate: '1815', notes: 'first' });
  tree.updatePerson(id, { notes: 'still first' });
  const after = tree.person(id);
  assert.strictEqual(after.name, 'Ada');
  assert.strictEqual(after.birthDate, '1815');
  assert.strictEqual(after.notes, 'still first');
});

test('a field named as empty is cleared, one not named is kept', () => {
  const tree = new Tree();
  const { id } = tree.addPerson({ name: 'Ada', birthDate: '1815', notes: 'first' });
  tree.updatePerson(id, { birthDate: '' });
  assert.ok(!('birthDate' in tree.person(id)));
  assert.strictEqual(tree.person(id).notes, 'first');
});

test('a returned person cannot be edited behind the tree back', () => {
  const tree = new Tree();
  const { id } = tree.addPerson({ name: 'Ada' });
  assert.throws(() => { tree.person(id).name = 'Changed'; }, TypeError);
  assert.strictEqual(tree.person(id).name, 'Ada');
});

test('origins survive an edit, because an import depends on them', () => {
  const tree = new Tree({ people: [{ id: 'p', name: 'Ada', origins: [{ treeId: 't', personId: 'x' }] }] });
  tree.updatePerson('p', { name: 'Ada Lovelace' });
  assert.deepStrictEqual(tree.person('p').origins, [{ treeId: 't', personId: 'x' }]);
});

/* ---------------------------------------------------------------- relationships */

test('the rules are enforced on the way in', () => {
  const { tree, father, child } = family();
  assert.deepStrictEqual(
    tree.addRelationship({ from: child, to: father, type: PARENT }),
    { ok: false, reason: Rejection.ANCESTOR_CYCLE });
  assert.deepStrictEqual(
    tree.addRelationship({ from: father, to: child, type: SIBLING }),
    { ok: false, reason: Rejection.CONTRADICTS_EXISTING });
  assert.deepStrictEqual(
    tree.addRelationship({ from: father, to: child, type: PARENT }),
    { ok: false, reason: Rejection.DUPLICATE });
});

test('an edge to somebody who does not exist is refused', () => {
  const { tree, father } = family();
  assert.deepStrictEqual(
    tree.addRelationship({ from: father, to: 'nobody', type: PARENT }),
    { ok: false, reason: 'NO_SUCH_PERSON' });
});

test('a refused edge changes nothing and leaves no undo step', () => {
  const { tree, father, child } = family();
  const before = tree.relationships.length;
  const steps = tree.past.length;
  tree.addRelationship({ from: child, to: father, type: PARENT });
  assert.strictEqual(tree.relationships.length, before);
  assert.strictEqual(tree.past.length, steps);
});

test('deleting a person takes their relationships with them', () => {
  const { tree, child } = family();
  const result = tree.removePerson(child);
  assert.strictEqual(result.removedEdges, 2);
  assert.strictEqual(tree.people.length, 2);
  assert.ok(tree.relationships.every((r) => r.from !== child && r.to !== child));
});

/* ---------------------------------------------------------------- undo */

test('undo restores a deleted person and every edge they had', () => {
  const { tree, child } = family();
  const before = tree.signature();
  tree.removePerson(child);
  tree.undo();
  assert.strictEqual(tree.signature(), before);
  assert.strictEqual(tree.person(child).name, 'Ravi');
  assert.strictEqual(tree.relationships.length, 3);
});

test('undo and redo walk the same path', () => {
  const tree = new Tree();
  const a = tree.addPerson({ name: 'A' }).id;
  tree.addPerson({ name: 'B' });
  tree.updatePerson(a, { name: 'A2' });

  assert.strictEqual(tree.people.length, 2);
  tree.undo(); tree.undo(); tree.undo();
  assert.strictEqual(tree.people.length, 0);
  assert.ok(!tree.canUndo);
  tree.redo(); tree.redo(); tree.redo();
  assert.strictEqual(tree.people.length, 2);
  assert.strictEqual(tree.person(a).name, 'A2');
  assert.ok(!tree.canRedo);
});

test('a new edit discards the redo branch', () => {
  const tree = new Tree();
  tree.addPerson({ name: 'A' });
  tree.undo();
  assert.ok(tree.canRedo);
  tree.addPerson({ name: 'B' });
  assert.ok(!tree.canRedo);
  assert.strictEqual(tree.people.length, 1);
  assert.strictEqual(tree.people[0].name, 'B');
});

test('an edit that changes nothing is not a step to undo', () => {
  const tree = new Tree();
  const { id } = tree.addPerson({ name: 'Ada' });
  const steps = tree.past.length;
  tree.updatePerson(id, { name: 'Ada' });
  assert.strictEqual(tree.past.length, steps);
});

test('undo says what it will take back', () => {
  const { tree, child } = family();
  tree.removePerson(child);
  assert.strictEqual(tree.undoLabel, 'Delete Ravi');
  tree.undo();
  assert.strictEqual(tree.redoLabel, 'Delete Ravi');
});

/* ---------------------------------------------------------------- unsaved */

test('a tree is unmodified until it is changed', () => {
  const { tree } = family();
  tree.markSaved();
  assert.ok(!tree.isDirty);
  tree.addPerson({ name: 'New' });
  assert.ok(tree.isDirty);
});

test('undoing back to the saved state is not unsaved work', () => {
  // A dirty flag would still be set here, and would nag somebody to save a file identical to
  // the one already on disk.
  const { tree } = family();
  tree.markSaved();
  const added = tree.addPerson({ name: 'Mistake' });
  assert.ok(tree.isDirty);
  tree.undo();
  assert.ok(!tree.isDirty, 'undoing the only change should leave nothing to save');
  assert.ok(!tree.person(added.id));
});

/* ---------------------------------------------------------------- out to disk */

test('an edited tree writes a file the reader accepts', async () => {
  const { tree, father, child } = family();
  tree.updatePerson(child, { birthDate: '1970', notes: 'moved to Kanpur' });

  const bytes = await writeTreeArchive(tree.toExchange());
  const archive = await openArchive(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const back = parseDocument(await archive.readText('tree.json'));

  assert.strictEqual(back.people.length, 3);
  assert.strictEqual(back.relationships.length, 3);
  const ravi = back.people.find((p) => p.id === child);
  assert.strictEqual(ravi.birthDate, '1970');
  assert.strictEqual(ravi.notes, 'moved to Kanpur');
  assert.ok(back.relationships.some((r) => r.from === father && r.to === child && r.type === PARENT));
});

test('sourceTreeId is carried through, not reissued', () => {
  // The importer recognises a file whose sourceTreeId matches its own and then matches people by
  // id with no name comparison at all. Rewriting it would send a desktop-edited tree back to the
  // phone as a stranger.
  const tree = new Tree({ sourceTreeId: 'the-phone', people: [{ id: 'a' }] },
    { ownTreeId: 'this-desktop' });
  assert.strictEqual(tree.toExchange().sourceTreeId, 'the-phone');
});

test('a tree that came from nowhere takes this installation id', () => {
  const tree = new Tree({}, { ownTreeId: 'this-desktop' });
  tree.addPerson({ name: 'The first person anybody adds here' });
  assert.strictEqual(tree.toExchange().sourceTreeId, 'this-desktop');
});

test('a tree started here is not written claiming the empty origin', () => {
  /*
   * The value that must never reach a file. Every desktop would be claiming it, so importing one
   * such tree into another would match people who share nothing but a position in a list.
   */
  const tree = new Tree({}, { ownTreeId: 'this-desktop' });
  assert.notStrictEqual(tree.toExchange().sourceTreeId, '');
});

test('an empty sourceTreeId in a file is replaced, not preserved', () => {
  // A file written by an older desktop build, before it had an identity of its own.
  const tree = new Tree({ sourceTreeId: '', people: [{ id: 'a' }] }, { ownTreeId: 'this-desktop' });
  assert.strictEqual(tree.toExchange().sourceTreeId, 'this-desktop');
});

test('exportedAt is stamped at save time', () => {
  const tree = new Tree({ people: [{ id: 'a' }] });
  const when = new Date('2026-01-02T03:04:05Z');
  assert.strictEqual(tree.toExchange(when).exportedAt, '2026-01-02T03:04:05.000Z');
});

/* ---------------------------------------------------------------- an addition nobody finished */

test('withdrawing an unfinished addition leaves no trace in the history', () => {
  const { tree } = family();
  const before = tree.signature();
  const steps = tree.undoLabel;
  const { id } = tree.addPerson({ name: '' });

  assert.ok(tree.canWithdraw(id));
  assert.deepStrictEqual(tree.withdraw(id), { ok: true });
  assert.strictEqual(tree.signature(), before, 'the tree is as it was');
  assert.strictEqual(tree.undoLabel, steps, 'and the history is as it was');
  assert.ok(!tree.canRedo, 'a blank person is not something to redo');
});

test('an addition can only be withdrawn while it is the newest step', () => {
  const { tree, father } = family();
  const { id } = tree.addPerson({ name: '' });
  tree.addRelationship({ from: father, to: id, type: PARENT });

  assert.ok(!tree.canWithdraw(id), 'something has happened since');
  assert.strictEqual(tree.withdraw(id).reason, 'NOT_THE_LATEST');
  assert.ok(tree.person(id), 'and the person is still there');
});

test('only the person the newest step added can be withdrawn', () => {
  const { tree, child } = family();
  tree.addPerson({ name: '' });
  assert.ok(!tree.canWithdraw(child));
  assert.ok(!new Tree().canWithdraw('nobody'), 'nothing to withdraw in an empty history');
});

test('finishing an addition as one step: withdraw, then add with the same id', () => {
  const tree = new Tree();
  const { id } = tree.addPerson({ name: '' });
  tree.withdraw(id);
  tree.addPerson({ id, name: 'Ravi' });

  assert.strictEqual(tree.undoLabel, 'Add Ravi');
  tree.undo();
  assert.strictEqual(tree.people.length, 0, 'one undo takes the whole addition back');
});

/* ---------------------------------------------------------------- keep as unknown */

test('keeping someone as unknown clears every detail and keeps every connection', () => {
  const { tree, father } = family();
  tree.updatePerson(father, { birthDate: '1938', deceased: true, notes: 'x', photo: 'photos/a.jpg' });
  const edges = tree.relationships.length;

  assert.deepStrictEqual(tree.clearDetails(father), { ok: true });
  assert.deepStrictEqual(tree.person(father), { id: father });
  assert.strictEqual(tree.relationships.length, edges, 'the family still joins up through them');
  assert.strictEqual(tree.undoLabel, 'Keep Shyam as unknown');

  tree.undo();
  assert.strictEqual(tree.person(father).name, 'Shyam', 'and undo gives them back');
});

test('keeping nobody as unknown is refused', () => {
  assert.strictEqual(new Tree().clearDetails('nobody').reason, 'NO_SUCH_PERSON');
});

/* ---------------------------------------------------------------- saved, as of when */

test('a tree is marked saved as of what was written, not as of now', () => {
  // Autosave takes the signature, writes, and marks saved afterwards. An edit made meanwhile must
  // still count as unsaved, or it is never written.
  const { tree, child } = family();
  const written = tree.signature();
  tree.updatePerson(child, { notes: 'typed while the write was in flight' });
  tree.markSaved(written);
  assert.ok(tree.isDirty);
  tree.markSaved();
  assert.ok(!tree.isDirty);
});
