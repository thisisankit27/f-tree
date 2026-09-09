/*
 * TreeImporterTest.kt, for a tree held in memory rather than a database.
 *
 * Every case the Kotlin's instrumented test makes is made here, in its own terms. Two are not:
 * `aFileThatIsNotAnArchiveIsRefused` and `aFileFromANewerVersionIsRefusedRatherThanPartlyUnderstood`
 * belong to `parseDocument` in `archive.js`, which refuses both before an import ever sees them,
 * and re-asserting them here would test a function this file does not call.
 *
 * The backup cases are replaced rather than dropped. The phone writes a backup file because it
 * commits to a database the moment it is told to; here an import is one `tree.edit`, so the same
 * promise -- "backing out leaves the tree untouched" -- is kept by undo, and is tested as that.
 */

import test from 'node:test';
import assert from 'node:assert';

import { Tree } from './document.js';
import { planImport, applyImport, ImportRefused } from './import.js';
import { MatchTier } from './matching.js';

const OTHER_TREE = 'tree-from-a-cousin';
const MY_TREE = 'tree-of-mine';

/** A document in the exchange shape, as `archive.js` would hand one over. */
function document({ sourceTreeId = OTHER_TREE, people = [], relationships = [] }) {
  return { format: 'f-tree', version: 1, exportedAt: '', sourceTreeId, people, relationships };
}

const person = (id, name, fields = {}) => ({ id, name, ...fields });
const parentOf = (from, to) => ({ id: `${from}-${to}`, from, to, type: 'PARENT' });
const spouseOf = (from, to) => ({ id: `${from}-${to}`, from, to, type: 'SPOUSE' });

/** A tree with somebody in it, built the way the app builds one. */
function treeWith(people, relationships = []) {
  const tree = new Tree({ sourceTreeId: MY_TREE, people, relationships }, { ownTreeId: MY_TREE });
  tree.markSaved();
  return tree;
}

/** Plan and apply in one go, taking every default decision, as confirming without touching does. */
function importInto(tree, doc, { ownTreeId = MY_TREE, decisions = null } = {}) {
  const plan = planImport({ document: doc, tree, ownTreeId });
  return {
    plan,
    result: applyImport({ tree, plan, decisions: decisions ?? plan.defaultDecisions }),
  };
}

const namesIn = (tree) => tree.people.map((p) => p.name).sort();

test('importing into an empty tree reproduces the original', () => {
  const tree = treeWith([]);
  const doc = document({
    people: [person('a', 'Asha'), person('b', 'Bhim')],
    relationships: [parentOf('a', 'b')],
  });

  const { result } = importInto(tree, doc);

  assert.strictEqual(result.peopleAdded, 2);
  assert.strictEqual(result.peopleMerged, 0);
  assert.strictEqual(result.relationshipsAdded, 1);
  assert.deepStrictEqual(namesIn(tree), ['Asha', 'Bhim']);

  // The shape survived, not just the count: the edge still joins the same two people.
  const [edge] = tree.relationships;
  const byName = new Map(tree.people.map((p) => [p.id, p.name]));
  assert.strictEqual(byName.get(edge.from), 'Asha');
  assert.strictEqual(byName.get(edge.to), 'Bhim');
});

test('my own people are not touched by an import', () => {
  const tree = treeWith([person('mine', 'Asha', { birthDate: '1970', notes: 'my note' })]);
  const doc = document({
    people: [person('theirs', 'Asha', { birthDate: '1970', notes: 'their note' })],
  });

  importInto(tree, doc);

  const asha = tree.people.find((p) => p.name === 'Asha');
  assert.strictEqual(asha.notes, 'my note', 'an imported value overwrote one already here');
  assert.strictEqual(asha.birthDate, '1970');
});

test('importing the same file twice changes nothing the second time', () => {
  const tree = treeWith([]);
  const doc = document({
    people: [person('a', 'Asha'), person('b', 'Bhim')],
    relationships: [parentOf('a', 'b')],
  });

  importInto(tree, doc);
  const afterFirst = tree.signature();

  const { result } = importInto(tree, doc);

  assert.strictEqual(result.peopleAdded, 0, 'the second import added somebody again');
  assert.strictEqual(result.peopleMerged, 2);
  assert.strictEqual(result.relationshipsAdded, 0);
  assert.strictEqual(result.relationshipsAlreadyPresent, 1);
  assert.strictEqual(tree.signature(), afterFirst, 'the second import changed the tree');
});

test('re-importing my own export is a no-op', () => {
  // The identity rule: a file this installation wrote names people by ids this tree still uses,
  // so everybody is matched outright without a single name being compared.
  const tree = treeWith([person('p1', 'Asha'), person('p2', 'Bhim')], [parentOf('p1', 'p2')]);
  const doc = document({
    sourceTreeId: MY_TREE,
    people: [person('p1', 'Asha'), person('p2', 'Bhim')],
    relationships: [parentOf('p1', 'p2')],
  });

  const before = tree.signature();
  const { plan, result } = importInto(tree, doc);

  assert.ok(plan.matches.every((m) => m.tier === MatchTier.CERTAIN));
  assert.strictEqual(result.peopleAdded, 0);
  assert.strictEqual(tree.signature(), before);
});

test('a merge fills gaps and never overwrites', () => {
  const tree = treeWith([
    person('mine', 'Asha', { birthDate: '1970', notes: 'kept', deceased: false }),
  ]);
  const doc = document({
    sourceTreeId: MY_TREE,
    people: [person('mine', 'Asha', {
      birthDate: '1971', deathDate: '2001', notes: 'ignored', gender: 'FEMALE', deceased: true,
    })],
  });

  const { result } = importInto(tree, doc);
  const asha = tree.person(tree.people[0].id);

  assert.strictEqual(result.peopleMerged, 1);
  assert.strictEqual(asha.birthDate, '1970', 'a filled field was overwritten');
  assert.strictEqual(asha.notes, 'kept');
  assert.strictEqual(asha.deathDate, '2001', 'an empty field was not filled');
  assert.strictEqual(asha.gender, 'FEMALE', 'an unset gender was not filled');
  assert.strictEqual(asha.deceased, true, 'deceased did not stay true once set');

  // Disagreements are reported rather than resolved, so nothing is lost silently.
  assert.deepStrictEqual(
    result.conflicts.map((c) => [c.field, c.kept, c.ignored]).sort(),
    [['born', '1970', '1971'], ['notes', 'kept', 'ignored']]);
});

test('a weak match is kept separate unless asked for', () => {
  const tree = treeWith([person('mine', 'Asha')]);
  const doc = document({ people: [person('theirs', 'Asha')] });

  const plan = planImport({ document: doc, tree, ownTreeId: MY_TREE });
  const [match] = plan.matches;
  assert.strictEqual(match.tier, MatchTier.WEAK);
  assert.strictEqual(plan.defaultDecisions.get('theirs'), false, 'a weak match merged by default');

  applyImport({ tree, plan, decisions: plan.defaultDecisions });
  assert.strictEqual(tree.people.length, 2, 'two people with one name were silently combined');

  // ...and merged when it is asked for.
  const second = treeWith([person('mine', 'Asha')]);
  const secondPlan = planImport({ document: doc, tree: second, ownTreeId: MY_TREE });
  applyImport({ tree: second, plan: secondPlan, decisions: new Map([['theirs', true]]) });
  assert.strictEqual(second.people.length, 1);
});

test("the wife's family joins mine through the person we share", () => {
  /*
   * The case the whole matcher exists for. Her file holds her, her father and her mother; mine
   * holds her and me. She matches on name, and once she is settled her parents arrive as new
   * people attached to the person we both know -- not as a second disconnected family.
   */
  const tree = treeWith(
    [person('me', 'Ankit'), person('her', 'Priya')],
    [spouseOf('me', 'her')]);
  const doc = document({
    people: [person('w', 'Priya'), person('f', 'Rajesh'), person('m', 'Sunita')],
    relationships: [parentOf('f', 'w'), parentOf('m', 'w'), spouseOf('f', 'm')],
  });

  const plan = planImport({ document: doc, tree, ownTreeId: MY_TREE });
  // She is only a weak match on her own -- one name, nothing corroborating it -- so the merge is
  // a decision somebody makes. That is the point of the review screen.
  applyImport({ tree, plan, decisions: new Map([['w', true]]) });

  assert.deepStrictEqual(namesIn(tree), ['Ankit', 'Priya', 'Rajesh', 'Sunita']);

  const byName = new Map(tree.people.map((p) => [p.name, p.id]));
  const parents = tree.parentsOf(byName.get('Priya')).sort();
  assert.deepStrictEqual(
    parents.map((id) => tree.person(id).name).sort(), ['Rajesh', 'Sunita'],
    'her parents did not attach to the Priya we already had');
});

test('imported ids are remapped so they cannot collide', () => {
  // Both files call somebody "p1", and they are different people. Reusing the id would overwrite
  // mine or attach their relationships to him.
  const tree = treeWith([person('p1', 'Asha')]);
  const doc = document({ people: [person('p1', 'Bhim')] });

  importInto(tree, doc);

  assert.deepStrictEqual(namesIn(tree), ['Asha', 'Bhim']);
  const bhim = tree.people.find((p) => p.name === 'Bhim');
  assert.notStrictEqual(bhim.id, 'p1', 'an imported id was reused as-is');
  assert.strictEqual(tree.person('p1').name, 'Asha');
});

test('a relationship already recorded is not duplicated', () => {
  const tree = treeWith([person('p1', 'Asha'), person('p2', 'Bhim')], [parentOf('p1', 'p2')]);
  const doc = document({
    sourceTreeId: MY_TREE,
    people: [person('p1', 'Asha'), person('p2', 'Bhim')],
    relationships: [parentOf('p1', 'p2')],
  });

  const { result } = importInto(tree, doc);

  assert.strictEqual(result.relationshipsAdded, 0);
  assert.strictEqual(result.relationshipsAlreadyPresent, 1);
  assert.strictEqual(tree.relationships.length, 1);
});

test('a symmetric connection recorded the other way round is not duplicated', () => {
  /*
   * Added here, and not in the Kotlin, because the desktop refuses it for a reason the phone does
   * not have. "A is a spouse of B" and "B is a spouse of A" are one connection stored in one
   * direction, so a literal duplicate check sees two. The phone's database sees two as well.
   */
  const tree = treeWith([person('p1', 'Asha'), person('p2', 'Bhim')], [spouseOf('p1', 'p2')]);
  const doc = document({
    sourceTreeId: MY_TREE,
    people: [person('p1', 'Asha'), person('p2', 'Bhim')],
    relationships: [spouseOf('p2', 'p1')],
  });

  const { result } = importInto(tree, doc);

  assert.strictEqual(result.relationshipsAdded, 0, 'the same marriage was recorded twice');
  assert.strictEqual(result.relationshipsAlreadyPresent, 1);
  assert.strictEqual(tree.relationships.length, 1);
});

test('a connection that would make somebody their own ancestor is refused, not written', () => {
  /*
   * Added here. Merging is what makes this reachable: their file says Asha's parent is Bhim,
   * mine says Bhim's parent is Asha, and merging both pairs closes the loop. No hand edit can
   * create this, and the layout has never had to survive it.
   */
  const tree = treeWith([person('a', 'Asha'), person('b', 'Bhim')], [parentOf('a', 'b')]);
  const doc = document({
    sourceTreeId: MY_TREE,
    people: [person('a', 'Asha'), person('b', 'Bhim')],
    relationships: [parentOf('b', 'a')],
  });

  const { result } = importInto(tree, doc);

  assert.strictEqual(result.relationshipsAdded, 0);
  assert.deepStrictEqual(result.relationshipsRefused.map((r) => r.reason), ['ANCESTOR_CYCLE']);
  assert.strictEqual(tree.relationships.length, 1, 'a cycle was written into the tree');
});

test('unknown people arrive as real nodes, not placeholders', () => {
  const tree = treeWith([person('mine', 'Asha')]);
  const doc = document({
    people: [person('x', 'Chandra', { birthDate: '1955', gender: 'MALE', notes: 'a note' })],
  });

  importInto(tree, doc);

  const chandra = tree.people.find((p) => p.name === 'Chandra');
  assert.ok(chandra, 'the new person is not in the tree');
  assert.strictEqual(chandra.birthDate, '1955');
  assert.strictEqual(chandra.gender, 'MALE');
  assert.strictEqual(chandra.notes, 'a note');
});

test('a file with nobody in it is refused', () => {
  const tree = treeWith([person('mine', 'Asha')]);
  assert.throws(
    () => planImport({ document: document({ people: [] }), tree, ownTreeId: MY_TREE }),
    ImportRefused);
});

test('planning changes nothing at all', () => {
  const tree = treeWith([person('mine', 'Asha')]);
  const before = tree.signature();

  planImport({
    document: document({ people: [person('a', 'Asha'), person('b', 'Bhim')] }),
    tree,
    ownTreeId: MY_TREE,
  });

  assert.strictEqual(tree.signature(), before, 'planning an import modified the tree');
  assert.strictEqual(tree.isDirty, false);
});

test('backing out of an import leaves the tree untouched', () => {
  // The phone writes a backup file for this. Here it is one edit, so undo is the whole promise.
  const tree = treeWith([person('mine', 'Asha')], []);
  const before = tree.signature();

  importInto(tree, document({
    people: [person('a', 'Bhim'), person('b', 'Chandra')],
    relationships: [parentOf('a', 'b')],
  }));
  assert.notStrictEqual(tree.signature(), before);

  const undone = tree.undo();

  assert.strictEqual(undone.ok, true);
  assert.strictEqual(tree.signature(), before, 'undoing an import did not restore the tree');
  assert.deepStrictEqual(namesIn(tree), ['Asha']);
});

test('a whole import is one step on the undo stack, not one per person', () => {
  const tree = treeWith([person('mine', 'Asha')]);
  importInto(tree, document({
    people: [person('a', 'Bhim'), person('b', 'Chandra'), person('c', 'Devi')],
    relationships: [parentOf('a', 'b'), parentOf('a', 'c')],
  }));

  tree.undo();
  assert.strictEqual(tree.canUndo, false, 'an import left more than one step to undo');
});

test('origins are recorded for everybody, so the next import is a lookup', () => {
  const tree = treeWith([]);
  const doc = document({ people: [person('a', 'Asha')] });

  importInto(tree, doc);
  const asha = tree.people[0];
  assert.deepStrictEqual(asha.origins, [{ treeId: OTHER_TREE, personId: 'a' }]);

  // A second file from the same tree now matches her by provenance rather than by her name.
  const second = document({ people: [person('a', 'Asha Kumari')] });
  const plan = planImport({ document: second, tree, ownTreeId: MY_TREE });
  assert.strictEqual(plan.matches[0].tier, MatchTier.CERTAIN,
    'a person known by origin was not recognised on the next import');
});

test("origins already on an imported record are carried across, not dropped", () => {
  // Her file records that she originally came from a third tree. Losing that would make the next
  // import from *that* tree a name guess instead of a fact.
  const tree = treeWith([]);
  const doc = document({
    people: [person('a', 'Asha', { origins: [{ treeId: 'grandmothers-tree', personId: 'g1' }] })],
  });

  importInto(tree, doc);

  assert.deepStrictEqual(tree.people[0].origins, [
    { treeId: OTHER_TREE, personId: 'a' },
    { treeId: 'grandmothers-tree', personId: 'g1' },
  ]);
});

test('photos arrive under names that cannot overwrite one already held', () => {
  const tree = treeWith([person('mine', 'Asha', { photo: 'photos/1.jpg' })]);
  const photos = new Map([['photos/1.jpg', new Uint8Array([1, 1, 1])]]);
  const doc = document({ people: [person('x', 'Bhim', { photo: 'photos/1.jpg' })] });

  const plan = planImport({ document: doc, tree, ownTreeId: MY_TREE });
  const result = applyImport({
    tree,
    plan,
    decisions: plan.defaultDecisions,
    photos,
    importedPhotos: new Map([['photos/1.jpg', new Uint8Array([2, 2, 2])]]),
  });

  assert.strictEqual(result.photosAdded, 1);
  assert.deepStrictEqual([...photos.get('photos/1.jpg')], [1, 1, 1], "Asha's photo was overwritten");
  const bhim = tree.people.find((p) => p.name === 'Bhim');
  assert.notStrictEqual(bhim.photo, 'photos/1.jpg');
  assert.deepStrictEqual([...photos.get(bhim.photo)], [2, 2, 2]);
});

test('the plan says what confirming would do before it is confirmed', () => {
  const tree = treeWith([person('mine', 'Asha')]);
  const doc = document({ people: [person('a', 'Asha'), person('b', 'Bhim')] });

  const plan = planImport({ document: doc, tree, ownTreeId: MY_TREE });

  assert.deepStrictEqual(plan.outcomeUnder(plan.defaultDecisions), { added: 2, merged: 0 });
  assert.deepStrictEqual(plan.outcomeUnder(new Map([['a', true]])), { added: 1, merged: 1 });

  // And the count it promised is the count it delivers.
  const result = applyImport({ tree, plan, decisions: new Map([['a', true]]) });
  assert.strictEqual(result.peopleAdded, 1);
  assert.strictEqual(result.peopleMerged, 1);
});
