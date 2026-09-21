/*
 * story/kin.js: the featured person's family, partitioned into circles (#250).
 *
 * Each synthetic family is built inline, small enough to read, and asserts the exact circle of the
 * people it was built to test. The property tests then run over every fixture - these, the book's
 * own fixtures and the sample family - with several featured choices each: everyone in scope is in
 * exactly one circle, F is self, and the answer does not move across runs or input orders.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { kinOf, CIRCLES, ROLES, spouseStatus } from './story/kin.js';
import { readFamily } from './family.js';
import { resolveFeatured } from './story/featured.js';
import { relate } from '../playground/model.js';
import { openArchive, parseDocument } from '../playground/archive.js';
import { importClosure, bannedApiViolations, stripComments } from './qa/closure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/* ------------------------------------------------------------------ building families */

const M = (id, name, birthDate, extra = {}) => ({ id, name, gender: 'MALE', birthDate, ...extra });
const W = (id, name, birthDate, extra = {}) => ({ id, name, gender: 'FEMALE', birthDate, ...extra });
const parent = (from, ...children) => children.map((to) => ({ type: 'PARENT', from, to }));
const parents = (a, b, ...children) => [...parent(a, ...children), ...parent(b, ...children)];
const married = (a, b, subtype = 'MARRIED') => ({ type: 'SPOUSE', from: a, to: b, subtype });
const sibling = (a, b, subtype) => ({ type: 'SIBLING', from: a, to: b, ...(subtype ? { subtype } : {}) });
const tree = (people, relationships) => ({
  format: 'f-tree', version: 1, people,
  relationships: relationships.flat().map((r, i) => ({ id: `r${i}`, ...r })),
});

const kin = (doc, featured, options = {}, allowance = {}) => {
  const family = readFamily(doc, options, allowance);
  return { family, k: kinOf(family, featured, options) };
};
const circleOf = (k, id) => k.people.get(id)?.circle;
const pick = (k, id, ...fields) => Object.fromEntries(fields.map((f) => [f, k.people.get(id)[f]]));

/**
 * Three generations up and two down from Ankit, both sides, with an in-law or two, a nephew and a
 * stranger. Every circle but 'elsewhere' is reached from somewhere real.
 */
const BIG = tree([
  M('ggf', 'Ram Prasad', '1890'),                       // father's father's father
  M('gf', 'Shyam Lal', '1920'), W('gm', null, '1925'),   // paternal grandparents; her name is lost
  M('mgf', 'Hari Om', '1922'), W('mgm', 'Kamla', '1926'),  // maternal grandparents
  M('dad', 'Rajesh', '1950'), W('mum', 'Sunita', '1955'),
  M('tau', 'Mahesh', '1945'), W('tai', 'Geeta', '1947'), M('cousin', 'Vikas', '1970'), W('cousinwife', 'Neha', '1972'), M('cousinkid', 'Aarav', '2000'),
  M('chacha', 'Naresh', '1958'),
  W('bua', 'Poonam', '1952'),
  M('mama', 'Anil', '1957'),
  M('ankit', 'Ankit', '1995'), W('sis', 'Priya', '1992'), M('jija', 'Rohit', '1990'), M('nephew', 'Kabir', '2020'),
  W('wife', 'Meera', '1996'), M('sasur', 'Vinod', '1965'), M('sala', 'Arjun', '1999'),
  M('son', 'Dev', '2020'), W('granddaughter', 'Tara', '2045'), W('bahu', 'Isha', '2021'),
  M('stranger', 'Nobody', '1980'),
], [
  parent('ggf', 'gf'),
  parents('gf', 'gm', 'dad', 'tau', 'chacha', 'bua'),
  parents('mgf', 'mgm', 'mum', 'mama'),
  married('gf', 'gm'), married('mgf', 'mgm'), married('dad', 'mum'), married('tau', 'tai'),
  parents('dad', 'mum', 'ankit', 'sis'),
  parents('tau', 'tai', 'cousin'), married('cousin', 'cousinwife'), parent('cousin', 'cousinkid'),
  married('sis', 'jija'), parents('sis', 'jija', 'nephew'),
  married('ankit', 'wife'), parent('sasur', 'wife', 'sala'),
  parents('ankit', 'wife', 'son'), married('son', 'bahu'), parent('son', 'granddaughter'),
]);

test('a whole family: every circle holds exactly who it should', () => {
  const { k } = kin(BIG, 'ankit');
  const expect = {
    self: ['ankit'],
    parents: ['dad', 'mum'],
    spouses: ['wife'],
    children: ['son'],
    siblings: ['sis'],
    grandparents: ['gf', 'gm', 'mgf', 'mgm'],
    descendants: ['granddaughter'],
    ancestors: ['ggf'],
    branches: ['tau', 'tai', 'cousin', 'cousinwife', 'cousinkid', 'bua', 'chacha', 'mama'],
    'in-laws': ['sasur', 'sala', 'jija', 'bahu'],
    lane: ['nephew'],
    elsewhere: ['stranger'],
  };
  for (const c of CIRCLES) assert.deepEqual([...k.circles[c]].sort(), [...expect[c]].sort(), c);

  assert.deepEqual(pick(k, 'dad', 'side', 'gen', 'role'), { side: 'paternal', gen: -1, role: 'parent' });
  assert.deepEqual(pick(k, 'mum', 'side', 'gen'), { side: 'maternal', gen: -1 });
  assert.deepEqual(pick(k, 'gm', 'side', 'gen', 'branch'), { side: 'paternal', gen: -2, branch: 'dad' });
  assert.deepEqual(pick(k, 'mgf', 'side', 'gen', 'branch'), { side: 'maternal', gen: -2, branch: 'mum' });
  assert.deepEqual(pick(k, 'ggf', 'side', 'gen', 'branch'), { side: 'paternal', gen: -3, branch: 'dad' });
  assert.deepEqual(pick(k, 'granddaughter', 'gen', 'branch', 'role'), { gen: 2, branch: 'son', role: 'grandchild' });

  // One branch per aunt or uncle, each on the right side, carrying its whole house.
  assert.deepEqual(pick(k, 'tau', 'role', 'side', 'gen', 'branch'), { role: 'aunt-uncle', side: 'paternal', gen: -1, branch: 'tau' });
  assert.deepEqual(pick(k, 'tai', 'role', 'branch'), { role: 'aunt-uncle-spouse', branch: 'tau' });
  assert.deepEqual(pick(k, 'cousin', 'role', 'gen', 'branch'), { role: 'cousin', gen: 0, branch: 'tau' });
  assert.deepEqual(pick(k, 'cousinwife', 'role', 'branch'), { role: 'cousin-spouse', branch: 'tau' });
  assert.deepEqual(pick(k, 'cousinkid', 'role', 'gen'), { role: 'cousin-descendant', gen: 1 });
  assert.deepEqual(pick(k, 'mama', 'side', 'branch'), { side: 'maternal', branch: 'mama' });

  assert.deepEqual(pick(k, 'sasur', 'role', 'gen', 'branch'), { role: 'spouse-parent', gen: -1, branch: 'wife' });
  assert.deepEqual(pick(k, 'sala', 'role', 'gen'), { role: 'spouse-sibling', gen: 0 });
  assert.deepEqual(pick(k, 'jija', 'role', 'branch'), { role: 'sibling-spouse', branch: 'sis' });
  assert.deepEqual(pick(k, 'bahu', 'role', 'gen'), { role: 'child-spouse', gen: 1 });
  assert.deepEqual(pick(k, 'nephew', 'gen', 'branch', 'via'), { gen: 1, branch: 'sis', via: 'sis' });
  assert.deepEqual(pick(k, 'stranger', 'gen', 'side', 'role'), { gen: null, side: 'none', role: 'unlinked' });

  // Paternal before maternal, and within a side the branches by their eldest member.
  assert.deepEqual(k.circles.grandparents, ['gf', 'gm', 'mgf', 'mgm']);
  assert.deepEqual(k.circles.branches, ['tau', 'tai', 'cousin', 'cousinwife', 'cousinkid', 'bua', 'chacha', 'mama']);
});

test('kin words: English from the app, Hindi from the vocabulary, पिताजी / माँ for parents', () => {
  const { k } = kin(BIG, 'ankit', { words: 'hi' });
  const w = (id) => k.words(id);
  assert.deepEqual(w('dad'), { en: 'father', hi: 'पिताजी', term: 'PITA', word: 'पिताजी' });
  assert.deepEqual(w('mum'), { en: 'mother', hi: 'माँ', term: 'MATA', word: 'माँ' });
  assert.equal(w('gm').hi, 'दादी');
  assert.equal(w('gm').en, 'grandmother');
  assert.equal(w('mgf').hi, 'नाना');
  assert.equal(w('ggf').hi, 'परदादा');
  assert.equal(w('ggf').en, 'great-grandfather');
  // Elder and younger than Ankit's father, by the record's years.
  assert.equal(w('tau').hi, 'ताऊ');
  assert.equal(w('tai').hi, 'ताई');
  assert.equal(w('tai').en, 'aunt');
  assert.equal(w('chacha').hi, 'चाचा');
  assert.equal(w('bua').hi, 'बुआ');
  assert.equal(w('mama').hi, 'मामा');
  assert.deepEqual(w('cousin'), { en: 'first cousin', hi: 'चचेरा भाई', term: 'CHACHERA_BHAI', word: 'चचेरा भाई' });
  assert.equal(w('sis').hi, 'बहन');
  assert.equal(w('jija').hi, 'जीजा');
  assert.equal(w('jija').en, 'brother-in-law');
  assert.equal(w('sasur').hi, 'ससुर');
  assert.equal(w('sala').hi, 'साला');
  assert.equal(w('wife').hi, 'पत्नी');
  assert.equal(w('son').hi, 'बेटा');
  assert.equal(w('bahu').hi, 'बहू');
  assert.equal(w('granddaughter').hi, 'पोती');
  assert.equal(w('nephew').hi, 'भांजा');
  // Where Hindi has no word, the English one is printed.
  assert.deepEqual(w('cousinkid'), { en: 'first cousin once removed', hi: null, term: null, word: 'first cousin once removed' });
  // F and the unlinked have no kin word at all.
  assert.deepEqual(w('ankit'), { en: null, hi: null, term: null, word: null });
  assert.deepEqual(w('stranger'), { en: null, hi: null, term: null, word: null });
  assert.equal(w('not-a-person'), null);

  const en = kin(BIG, 'ankit').k;
  assert.equal(en.words('dad').word, 'father');
  assert.equal(en.words('tau').word, 'uncle');
});

test('a person whose name is lost is named by relation', () => {
  const { k } = kin(BIG, 'ankit');
  assert.deepEqual(k.people.get('gm').namedBy, { id: 'gf', word: 'wife' });   // "Shyam Lal's wife"
  assert.equal(k.people.get('gf').namedBy, null);

  const lonely = kin(tree([M('a', 'A', '1950'), W('x', null), M('y', null)], [married('x', 'y'), married('a', 'x')]), 'a').k;
  assert.deepEqual(lonely.people.get('x').namedBy, { id: 'a', word: 'wife' });
  // Only unnamed people around him: no named relative to be called after.
  assert.equal(lonely.people.get('y').namedBy, null);

  const mother = kin(tree([W('u', null), M('c', 'Ramesh', '1970')], [parent('u', 'c')]), 'c').k;
  assert.deepEqual(mother.people.get('u').namedBy, { id: 'c', word: 'mother' });
});

test('F is the eldest: nothing above, the story flows down', () => {
  const doc = tree([
    M('f', 'Elder', '1900'), W('w', 'Wife', '1905'), M('c1', 'C1', '1930'), W('c2', 'C2', '1932'),
    W('g1', 'G1', '1960'), M('gg1', 'GG1', '1990'), W('c1w', 'C1W', '1933'),
  ], [married('f', 'w'), parents('f', 'w', 'c1', 'c2'), married('c1', 'c1w'), parents('c1', 'c1w', 'g1'), parent('g1', 'gg1')]);
  const { k } = kin(doc, 'f');
  for (const c of ['parents', 'grandparents', 'ancestors', 'branches', 'siblings']) assert.deepEqual(k.circles[c], [], c);
  assert.deepEqual(k.circles.children, ['c1', 'c2']);
  assert.deepEqual(k.circles.descendants, ['g1', 'gg1']);
  assert.deepEqual(pick(k, 'gg1', 'role', 'gen', 'branch'), { role: 'descendant', gen: 3, branch: 'c1' });
  assert.deepEqual(k.circles['in-laws'], ['c1w']);
});

test('F is a leaf child: no spouses, no children', () => {
  const { k } = kin(BIG, 'granddaughter');
  assert.deepEqual(k.circles.spouses, []);
  assert.deepEqual(k.circles.children, []);
  assert.deepEqual(k.circles.parents, ['son']);
  assert.deepEqual(k.circles.grandparents, ['ankit', 'wife']);   // her mother is not recorded
  assert.equal(k.people.get('wife').side, 'paternal');
  assert.deepEqual([...k.circles.ancestors].sort(), ['dad', 'gf', 'ggf', 'gm', 'mgf', 'mgm', 'mum', 'sasur']);
  assert.deepEqual(pick(k, 'ggf', 'gen', 'side', 'branch'), { gen: -5, side: 'paternal', branch: 'son' });
  assert.equal(circleOf(k, 'bahu'), 'in-laws');          // her father's wife, not her mother
  assert.equal(k.people.get('bahu').role, 'parent-spouse');
  assert.equal(k.words('bahu').en, 'stepmother');
  assert.equal(k.words('ankit').hi, 'दादा');
});

test('a remarriage: half-siblings grouped by the parents they share, apart from the full ones', () => {
  const doc = tree([
    M('dad', 'Dad', '1950'), W('first', 'First Wife', '1952'), W('mum', 'Mum', '1958'), M('other', 'Mum Second', '1950'),
    M('h1', 'Half One', '1975'), W('h2', 'Half Two', '1977'),
    M('f', 'Featured', '1985'), W('full', 'Full Sister', '1988'),
    M('m1', 'Maternal Half', '1995'),
  ], [
    married('dad', 'first', 'DIVORCED'), parents('dad', 'first', 'h1', 'h2'),
    married('dad', 'mum'), parents('dad', 'mum', 'f', 'full'),
    parents('mum', 'other', 'm1'),
  ]);
  const { k } = kin(doc, 'f');
  assert.deepEqual(k.circles.siblings, ['h1', 'h2', 'full', 'm1']);
  assert.deepEqual(k.circles.siblings.map((id) => k.people.get(id).role), ['half', 'half', 'full', 'half']);
  const branch = (id) => k.people.get(id).branch;
  assert.equal(branch('h1'), 'dad first');
  assert.equal(branch('h2'), 'dad first');
  assert.equal(branch('full'), 'dad mum');
  assert.equal(branch('m1'), 'mum other');
  assert.equal(k.words('h2').en, 'half-sister');
  assert.equal(k.words('h2').hi, 'बहन');
  assert.equal(k.words('full').en, 'sister');
  // Dad's first wife is not F's mother: one marriage away, through him.
  assert.deepEqual(pick(k, 'first', 'circle', 'role', 'side', 'branch'), { circle: 'in-laws', role: 'parent-spouse', side: 'paternal', branch: 'dad' });
  assert.equal(circleOf(k, 'other'), 'lane');
});

test('explicit siblings with no shared parents, followed transitively', () => {
  const doc = tree([
    M('f', 'F', '1980'), W('x', 'X', '1978'), M('y', 'Y', '1975'), W('z', 'Z', '1970', { gender: 'UNSPECIFIED' }),
    M('p', 'P', '1950'), M('q', 'Q', '1982'),
  ], [sibling('f', 'x'), sibling('x', 'y'), sibling('y', 'z', 'HALF'), parent('p', 'f', 'q'), sibling('q', 'y')]);
  const { k } = kin(doc, 'f');
  // The explicit group first: its eldest (Z, 1970) is older than Q's group.
  assert.deepEqual(k.circles.siblings, ['z', 'y', 'x', 'q']);
  assert.equal(k.people.get('q').role, 'full');
  for (const id of ['x', 'y', 'z']) {
    assert.equal(k.people.get(id).role, 'explicit', id);
    assert.equal(k.people.get(id).branch, null, id);
  }
  assert.equal(k.words('y').en, 'brother');
  assert.equal(k.words('z').en, 'half-sibling');   // a HALF link, and no gender: English says so, Hindi has none
  assert.equal(kinOf(readFamily(doc), 'f', { words: 'hi' }).words('z').word, 'half-sibling');
});

test('explicit links are followed only through full siblings, and a HALF link stays half', () => {
  // H is F's half-brother through Dad; M is explicitly H's sister, from H's mother's side - no kin of F's.
  const doc = tree([
    M('dad', 'Dad', '1950'), W('mum', 'Mum', '1955'), W('step', 'Step', '1952'),
    M('f', 'F', '1980'), M('h', 'H', '1975'), W('m', 'M', '1972'),
    W('b', 'B', '1982'), M('c', 'C', '1984'),
  ], [parents('dad', 'mum', 'f'), parents('dad', 'step', 'h'), sibling('h', 'm'), sibling('f', 'b', 'HALF'), sibling('b', 'c')]);
  const { k } = kin(doc, 'f');
  assert.equal(k.people.get('h').role, 'half');
  assert.notEqual(circleOf(k, 'm'), 'siblings');
  assert.notEqual(k.words('m').en, 'sister');
  assert.equal(k.words('b').en, 'half-sister');
  assert.notEqual(circleOf(k, 'c'), 'siblings');   // B is only a half-sister: her own siblings are not F's
});

test('a family of twelve: eleven siblings, eldest first', () => {
  const kids = Array.from({ length: 12 }, (_, i) => (i % 2 ? W : M)(`k${String(i).padStart(2, '0')}`, `Child ${i}`, String(1960 + i)));
  const doc = tree([M('dad', 'Dad', '1930'), W('mum', 'Mum', '1935'), ...kids.reverse()], [married('dad', 'mum'), parents('dad', 'mum', ...kids.map((c) => c.id))]);
  const { k } = kin(doc, 'k05');
  const expected = Array.from({ length: 12 }, (_, i) => `k${String(i).padStart(2, '0')}`).filter((id) => id !== 'k05');
  assert.deepEqual(k.circles.siblings, expected);
  assert.ok(k.circles.siblings.every((id) => k.people.get(id).role === 'full' && k.people.get(id).branch === 'dad mum'));
});

test('three spouses: current, former and late, and their children by each', () => {
  const doc = tree([
    M('f', 'F', '1940'),
    W('late', 'Late Wife', '1942', { deceased: true, deathDate: '1970' }), W('former', 'Former Wife', '1945'), W('now', 'Wife Now', '1950'),
    M('a', 'A', '1962'), W('b', 'B', '1972'), M('c', 'C', '1980'), W('d', 'D', '1965'),
  ], [
    married('f', 'late', 'WIDOWED'), married('f', 'former', 'DIVORCED'), married('f', 'now'),
    parents('f', 'late', 'a', 'd'), parents('f', 'former', 'b'), parents('f', 'now', 'c'),
  ]);
  const { k } = kin(doc, 'f', { words: 'hi' });
  const role = (id) => k.people.get(id).role;
  assert.deepEqual([role('late'), role('former'), role('now')], ['late', 'former', 'current']);
  assert.deepEqual(k.words('late'), { en: 'late wife', hi: 'पत्नी', term: 'PATNI', word: 'पत्नी' });
  assert.deepEqual(k.words('former'), { en: 'former wife', hi: null, term: null, word: 'former wife' });
  assert.deepEqual(k.words('now'), { en: 'wife', hi: 'पत्नी', term: 'PATNI', word: 'पत्नी' });
  // Children grouped by the other parent, the groups in order of their eldest child.
  assert.deepEqual(k.circles.children, ['a', 'd', 'b', 'c']);
  assert.deepEqual(k.circles.children.map((id) => k.people.get(id).branch), ['f late', 'f late', 'f former', 'f now']);
  assert.equal(spouseStatus({ deceased: false }, 'WIDOWED'), 'current');   // the survivor is not "late"
});

test('an unlinked F is self alone; everybody else is elsewhere', () => {
  const doc = tree([M('f', 'Alone', '1990'), M('a', 'A', '1950'), W('b', 'B', '1955')], [married('a', 'b')]);
  const { k } = kin(doc, 'f');
  assert.deepEqual(k.circles.self, ['f']);
  assert.deepEqual(k.circles.elsewhere, ['a', 'b']);
  for (const c of CIRCLES.filter((c) => c !== 'self' && c !== 'elsewhere')) assert.deepEqual(k.circles[c], [], c);

  // Nobody to feature: everyone is elsewhere.
  const none = kinOf(readFamily(doc), null);
  assert.equal(none.featured, null);
  assert.deepEqual(none.circles.elsewhere, ['f', 'a', 'b'].sort());
  assert.equal(kinOf(readFamily(doc), 'not-in-scope').featured, null);
});

test('a one-person tree with no relationships key, as Android exports it', () => {
  const family = readFamily({ format: 'f-tree', version: 1, people: [{ id: 'solo', name: 'Solo' }] });
  const k = kinOf(family, resolveFeatured(family));
  assert.deepEqual([...k.people.keys()], ['solo']);
  assert.equal(k.people.get('solo').circle, 'self');
  const empty = kinOf(readFamily({}), null);
  assert.equal(empty.people.size, 0);
  assert.deepEqual(Object.keys(empty.circles), [...CIRCLES]);
});

test('unknown gender: no side, the neutral English word, no Hindi', () => {
  const doc = tree([{ id: 'p', name: 'Parent' }, M('gp', 'Grandpa', '1920'), M('f', 'F', '1980')], [parent('p', 'f'), parent('gp', 'p')]);
  const { k } = kin(doc, 'f', { words: 'hi' });
  assert.deepEqual(pick(k, 'p', 'side', 'role'), { side: 'none', role: 'parent' });
  assert.deepEqual(k.words('p'), { en: 'parent', hi: null, term: null, word: 'parent' });
  assert.equal(k.people.get('gp').side, 'none');
  assert.equal(k.words('gp').word, 'grandfather');
});

test('bad data: loops, duplicate links and a cousin who is also a spouse still partition', () => {
  const doc = tree([
    M('a', 'A', '1950'), M('b', 'B', '1970'), M('f', 'F', '1990'), W('cz', 'Cousin Wife', '1991'), W('mum', 'Mum', '1960'), M('u', 'Uncle', '1962'),
  ], [
    parent('a', 'b'), parent('b', 'a'),                // a parent loop
    parent('b', 'f'), parent('b', 'f'), parent('b', 'f'),  // the same link three times
    married('f', 'cz'), married('cz', 'f'),
    parent('mum', 'f'), parent('x', 'mum'),           // an edge to nobody
    parent('a', 'u'), parent('u', 'cz'),
  ]);
  const { family, k } = kin(doc, 'f');
  assertPartition(family, k, 'f');
  assert.equal(circleOf(k, 'cz'), 'spouses');         // spouse beats cousin
  // A is B's parent and B's child at once: as B's child he is F's half-brother, and the sibling
  // claim comes before the grandparent one. Wrong data gets a consistent answer, not a crash.
  assert.equal(circleOf(k, 'a'), 'siblings');
  assert.equal(circleOf(k, 'u'), 'branches');
});

test('branch scope and the allowance: only people in scope are partitioned', () => {
  const branch = kin(BIG, 'ankit', { scope: { kind: 'branch', personId: 'dad' } });
  assertPartition(branch.family, branch.k, 'ankit');
  assert.equal(branch.k.people.has('gf'), false);
  assert.equal(branch.k.people.has('tau'), false);
  assert.deepEqual(branch.k.circles.parents, ['dad', 'mum']);

  const cut = kin(BIG, 'ankit', {}, { maxGenerations: 3 });
  assertPartition(cut.family, cut.k, 'ankit');
  assert.equal(cut.k.people.has('granddaughter'), false);
  assert.equal(cut.k.people.size, cut.family.people.length);
});

/* ------------------------------------------------------------------ properties */

function assertPartition(family, k, featured) {
  const scope = new Set(family.people.map((p) => p.id));
  assert.equal(k.people.size, scope.size, 'everyone in scope, and nobody else');
  for (const id of scope) assert.ok(k.people.has(id), `${id} has no circle`);
  const seen = new Map();
  for (const c of CIRCLES) {
    for (const id of k.circles[c]) {
      assert.ok(!seen.has(id), `${id} is in both ${seen.get(id)} and ${c}`);
      seen.set(id, c);
      const e = k.people.get(id);
      assert.equal(e.circle, c);
      assert.ok(ROLES[c].includes(e.role), `${id}: role ${e.role} is not one of ${c}'s`);
      assert.ok(['paternal', 'maternal', 'none'].includes(e.side));
    }
  }
  assert.equal(seen.size, scope.size);
  if (featured !== null && scope.has(featured)) assert.deepEqual(k.circles.self, [featured]);
  else assert.deepEqual(k.circles.self, []);
}

/** A seeded shuffle, so a failure reproduces. */
function shuffled(list, seed) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const snapshot = (k) => JSON.stringify({ circles: k.circles, people: [...k.people.values()] });

async function allFixtures() {
  const fixtures = { big: BIG };
  for (const f of readdirSync(path.join(here, 'fixtures')).filter((n) => n.endsWith('.json'))) {
    fixtures[f] = JSON.parse(readFileSync(path.join(here, 'fixtures', f), 'utf8'));
  }
  const buf = readFileSync(path.join(here, '../playground/sample-family.ftree'));
  const archive = await openArchive(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  fixtures.sample = parseDocument(await archive.readText('tree.json'));
  return fixtures;
}

/** Most connected, the eldest, a leaf, and one with no links - whichever of those exist. */
function featuredChoices(family) {
  const out = new Set([resolveFeatured(family)]);
  const byBirth = family.people.filter((p) => p.by !== null).sort((a, b) => a.by - b.by || (a.id < b.id ? -1 : 1));
  if (byBirth.length) out.add(byBirth[0].id);
  const leaf = family.people.find((p) => family.childrenOf(p.id).length === 0 && family.parentsOf(p.id).length > 0);
  if (leaf) out.add(leaf.id);
  if (family.elsewhere.length) out.add(family.elsewhere[0].id);
  return [...out];
}

test('property: on every fixture, everyone in scope is in exactly one circle and F is self', async () => {
  for (const [name, doc] of Object.entries(await allFixtures())) {
    const family = readFamily(doc);
    for (const f of [...featuredChoices(family), null]) {
      try { assertPartition(family, kinOf(family, f), f); } catch (e) { e.message = `${name}, F=${f}: ${e.message}`; throw e; }
    }
    // Every person of a small tree, featured in turn.
    if (family.people.length <= 40) for (const p of family.people) assertPartition(family, kinOf(family, p.id), p.id);
  }
});

test('property: the partition is identical across runs and under shuffled input order', async () => {
  for (const [name, doc] of Object.entries(await allFixtures())) {
    const family = readFamily(doc);
    for (const f of featuredChoices(family)) {
      const first = snapshot(kinOf(family, f));
      for (let run = 0; run < 3; run++) assert.equal(snapshot(kinOf(readFamily(doc), f)), first, `${name}, F=${f}: run ${run}`);
      for (const seed of [1, 7, 42]) {
        const moved = { ...doc, people: shuffled(doc.people ?? [], seed), relationships: shuffled(doc.relationships ?? [], seed + 1) };
        assert.equal(snapshot(kinOf(readFamily(moved), f)), first, `${name}, F=${f}: shuffled with seed ${seed}`);
      }
    }
  }
});

/* ------------------------------------------------------------------ the relate() budget */

test('relate() is never called by the partition, and at most once per person asked about', () => {
  // The largest fixture (180 people): the size a storybook is planned for.
  const family = readFamily(JSON.parse(readFileSync(path.join(here, 'fixtures/large.json'), 'utf8')));
  assert.ok(family.people.length >= 150);
  const calls = new Map();
  const counting = (graph, from, to) => { calls.set(to, (calls.get(to) ?? 0) + 1); return relate(graph, from, to); };
  const F = resolveFeatured(family);

  const k = kinOf(family, F, { relate: counting, words: 'hi' });
  assert.equal(calls.size, 0, 'kinOf itself must not call relate()');

  // A book shows at most about 150 people, and asks about each of them more than once (a portrait,
  // a caption, the register): the second and third asks must be free.
  const shown = [...k.people.keys()].slice(0, 150);
  const first = shown.map((id) => k.words(id));
  for (let page = 0; page < 2; page++) shown.forEach((id, i) => assert.strictEqual(k.words(id), first[i]));

  const total = [...calls.values()].reduce((a, b) => a + b, 0);
  assert.ok(total > 0, 'the fixture must reach somebody beyond one step, or this proves nothing');
  assert.ok(total <= shown.length, `${total} relate() calls for ${shown.length} people shown`);
  for (const [id, n] of calls) assert.equal(n, 1, `relate() ran ${n} times for ${id}`);
  // Never for F, the unlinked, or anyone one step from F.
  for (const id of calls.keys()) assert.ok(!['self', 'elsewhere', 'parents', 'spouses', 'children', 'siblings'].includes(k.people.get(id).circle));
});

test('kin.js and everything it imports stay deterministic, and never touch ageOf', () => {
  const files = importClosure(path.join(here, 'story/kin.js'));
  // The same two reviewed exceptions book.test.mjs grants the composer's closure, reached here
  // through family.js: ageOf's clock (never called) and byBirth's tie-break in layout.js.
  const allow = new Map([
    ['site/playground/model.js', [{ banned: 'new Date', fn: 'ageOf' }]],
    ['site/playground/layout.js', [{ banned: 'localeCompare', fn: 'byBirth' }]],
  ]);
  assert.deepEqual(bannedApiViolations(files, { allow, repoRoot }), []);
  const src = stripComments(readFileSync(path.join(here, 'story/kin.js'), 'utf8'));
  assert.doesNotMatch(src, /\bageOf\b/);
  assert.doesNotMatch(src, /localeCompare/);
  assert.doesNotMatch(src, /\bimport\s*\(/, 'static imports only: Android stages what compose.js reaches that way');
});
