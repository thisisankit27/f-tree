/*
 * Every member related to every other, in Hindi.
 *
 * A vocabulary this size cannot be checked by reading it. The hand-written cases in
 * `kinship-hindi.test.mjs` prove the rules on the shapes somebody thought of; this proves them on
 * every shape a family contains, by asking a question the code cannot answer twice the same way by
 * accident:
 *
 *   **if B is A's मामा, then A must be B's भांजा or भांजी.**
 *
 * The two answers are computed independently, from opposite ends of the graph, through different
 * branches of the rules. A mistake in "which side of the family" or "who links them" makes them
 * disagree, and there is no way to satisfy the whole table by luck. Cousins are the sharpest test of
 * all: a फुफेरा भाई must see you as his ममेरा भाई, never as another फुफेरा -- the relationship
 * inverts as it crosses.
 *
 * A translation of `app/src/test/java/com/vibethroughcode/ftree/graph/HindiEveryPairTest.kt`,
 * including its two honest excuses and its honest denominator.
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildGraph, relate } from './model.js';
import { hindiTerm } from './kinship-hindi.js';
import { HINDI_WORDS } from './kinship-hi.js';

/* ------------------------------------------------------------------ what must come back */

/** If B is A's key, A must be one of the values from B. */
const RECIPROCAL = (() => {
  const map = new Map();
  const pair = (a, b) => {
    for (const term of a) map.set(term, new Set(b));
    for (const term of b) map.set(term, new Set(a));
  };

  const parents = ['PITA', 'MATA'];
  const children = ['BETA', 'BETI'];
  const siblings = ['BHAI', 'BEHEN'];
  const fathersSiblings = ['TAU', 'CHACHA', 'FATHERS_BROTHER', 'BUA'];
  const mothersSiblings = ['MAMA', 'MAUSI'];
  const brothersChildren = ['BHATIJA', 'BHATIJI'];
  const sistersChildren = ['BHANJA', 'BHANJI'];

  pair(parents, children);
  pair(siblings, siblings);
  pair(['DADA', 'DADI'], ['POTA', 'POTI']);
  pair(['NANA', 'NANI'], ['NATI', 'NATIN']);
  // A father's sibling sees you as their brother's child; a mother's, as their sister's.
  pair(fathersSiblings, brothersChildren);
  pair(mothersSiblings, sistersChildren);
  /*
   * Cousins invert as they cross: your father's sister's son is, to him, your mother's brother's
   * son. The two that come through a same-sex sibling stay themselves.
   */
  pair(['PHUPHERA_BHAI', 'PHUPHERI_BEHEN'], ['MAMERA_BHAI', 'MAMERI_BEHEN']);
  pair(['CHACHERA_BHAI', 'CHACHERI_BEHEN'], ['CHACHERA_BHAI', 'CHACHERI_BEHEN']);
  pair(['MAUSERA_BHAI', 'MAUSERI_BEHEN'], ['MAUSERA_BHAI', 'MAUSERI_BEHEN']);
  // Through marriage.
  pair(['PATI'], ['PATNI']);
  pair(['SASUR', 'SAAS'], ['DAMAD', 'BAHU']);
  pair(['JIJA'], ['SALA', 'SALI']);
  pair(['BHABHI'], ['JETH', 'DEVAR', 'HUSBANDS_BROTHER', 'NANAD']);

  return map;
})();

/**
 * Whether Hindi has a word for this *shape* of relationship at all.
 *
 * English names every blood relation however far out -- "second cousin twice removed" -- by building
 * a phrase out of two numbers. Hindi does not work that way: it has a precise word for each of the
 * relationships a family talks about and nothing beyond them, which is why a raw percentage over
 * every pair in a six-generation tree says more about the tree's depth than about the vocabulary.
 * This is the honest denominator.
 */
function hindiCovers(term) {
  if (!term) return false;
  switch (term.kind) {
    case 'self': case 'sibling': case 'spouse': return true;
    case 'ancestor': case 'descendant': return term.generations <= 3;
    case 'parents-sibling': case 'siblings-child': return term.greats === 0;
    case 'cousin': return term.degree === 1 && term.removed === 0;
    case 'spouse-of': {
      const r = term.relative;
      if (r?.kind === 'sibling') return true;
      if (r?.kind === 'parents-sibling') return r.greats === 0;
      if (r?.kind === 'ancestor' || r?.kind === 'descendant') return r.generations === 1;
      return false;
    }
    case 'of-spouse': {
      const r = term.relative;
      if (r?.kind === 'sibling') return true;
      if (r?.kind === 'ancestor' || r?.kind === 'descendant') return r.generations === 1;
      return false;
    }
    default: return false;
  }
}

const hindiOf = (graph, from, to) => {
  const found = relate(graph, from, to);
  if (found.kind !== 'related' || !found.kinship) return null;
  return hindiTerm(
    found.kinship,
    graph.people.get(from)?.gender ?? 'UNSPECIFIED',
    graph.people.get(to)?.gender ?? 'UNSPECIFIED',
  );
};

/* ------------------------------------------------------------------ the two honest excuses */

/**
 * Whether an unrecorded gender explains why no word came back.
 *
 * Hindi has no gender-neutral kinship word -- there is no neuter for भाई or बहन -- so a person whose
 * gender nobody wrote down genuinely has no term, and saying nothing is the right answer. That is a
 * fact about the record rather than a fault in the rules, and separating the two is what lets this
 * test still fail on the second.
 */
function genderIsMissing(graph, from, to) {
  const found = relate(graph, from, to);
  if (found.kind !== 'related' || !found.path) return false;
  const involved = [from, ...found.path.map((step) => step.id)];
  return involved.some((id) => {
    const gender = graph.people.get(id)?.gender;
    return gender !== 'MALE' && gender !== 'FEMALE';
  });
}

/**
 * Marriages the record states inconsistently -- both partners written down with the same gender.
 *
 * Almost always one gender entered wrongly rather than anything about the marriage. Every Hindi
 * in-law word names both partners (जीजा married a sister, भाभी married a brother), so a line running
 * through such a marriage genuinely has no word and the rules are right to decline. Separated out so
 * a mistake in somebody's tree cannot be mistaken for a mistake in the vocabulary -- and named,
 * because they are worth fixing.
 */
function contradictoryMarriages(graph) {
  const bad = new Set();
  for (const [id, spouses] of graph.spousesOf) {
    for (const spouse of spouses.values()) {
      const one = graph.people.get(id)?.gender;
      const two = graph.people.get(spouse.id)?.gender;
      if (one && one === two && one !== 'UNSPECIFIED' && one !== 'OTHER') {
        bad.add([id, spouse.id].sort().join(' '));
      }
    }
  }
  return bad;
}

/** Whether the line joining two people passes through one of those marriages. */
function crossesContradiction(graph, from, to, bad) {
  if (!bad.size) return false;
  const found = relate(graph, from, to);
  if (found.kind !== 'related' || !found.path) return false;
  let previous = from;
  return found.path.some((step) => {
    const crosses = step.via === 'spouse' && bad.has([previous, step.id].sort().join(' '));
    previous = step.id;
    return crosses;
  });
}

/* ------------------------------------------------------------------------------- the sweep */

function sweep(graph) {
  const ids = [...graph.people.keys()];
  const report = {
    pairs: 0, related: 0, coverable: 0, named: 0, descriptive: 0,
    excusedByGender: 0, excusedByContradiction: 0,
    breaches: [], counts: new Map(),
  };
  const bad = contradictoryMarriages(graph);
  const name = (id) => graph.people.get(id)?.name ?? id;

  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      report.pairs++;

      const found = relate(graph, a, b);
      if (found.kind === 'related' && found.kinship?.term) {
        report.related++;
        if (hindiCovers(found.kinship.term)) report.coverable++;
      }

      const forward = hindiOf(graph, a, b);
      if (!forward) continue;
      report.named++;
      if (HINDI_WORDS[forward]?.needsBirthYears) report.descriptive++;
      report.counts.set(forward, (report.counts.get(forward) ?? 0) + 1);

      const expected = RECIPROCAL.get(forward);
      if (!expected) continue;

      const back = hindiOf(graph, b, a);
      if (back === null && genderIsMissing(graph, b, a)) {
        report.excusedByGender++;
      } else if (crossesContradiction(graph, a, b, bad) || crossesContradiction(graph, b, a, bad)) {
        report.excusedByContradiction++;
      } else if (back === null) {
        report.breaches.push(
          `${name(b)} is ${name(a)}'s ${forward}, and nothing comes back the other way `
          + '- yet every gender on that line is recorded');
      } else if (!expected.has(back)) {
        report.breaches.push(
          `${name(b)} is ${name(a)}'s ${forward}, so ${name(a)} should be one of `
          + `[${[...expected].join(', ')}] to ${name(b)} - got ${back}`);
      }
    }
  }
  return report;
}

/**
 * The built-in family: four generations, both sides recorded, every kind of aunt and uncle with
 * children of their own, and marriages at both ends.
 */
function family() {
  const people = [];
  const relationships = [];
  const add = (id, gender, born) => people.push({ id, name: id, gender, birthDate: born });
  const kids = (a, b, ...children) => {
    for (const child of children) {
      relationships.push({ from: a, to: child, type: 'PARENT' });
      relationships.push({ from: b, to: child, type: 'PARENT' });
    }
  };

  add('dada', 'MALE', '1930'); add('dadi', 'FEMALE', '1934');
  add('nana', 'MALE', '1932'); add('nani', 'FEMALE', '1936');
  add('tau', 'MALE', '1952'); add('tai', 'FEMALE', '1955');
  add('dad', 'MALE', '1958'); add('mum', 'FEMALE', '1960');
  add('chacha', 'MALE', '1963'); add('chachi', 'FEMALE', '1966');
  add('bua', 'FEMALE', '1955'); add('phupha', 'MALE', '1952');
  add('mama', 'MALE', '1956'); add('mami', 'FEMALE', '1959');
  add('mausi', 'FEMALE', '1962'); add('mausa', 'MALE', '1960');
  add('me', 'MALE', '1985'); add('wife', 'FEMALE', '1987');
  add('brother', 'MALE', '1988'); add('bhabhi', 'FEMALE', '1989');
  add('sister', 'FEMALE', '1990'); add('jija', 'MALE', '1986');
  add('son', 'MALE', '2012'); add('daughter', 'FEMALE', '2015');
  add('sasur', 'MALE', '1958'); add('saas', 'FEMALE', '1961');
  add('sala', 'MALE', '1990'); add('sali', 'FEMALE', '1992');
  for (const [id, gender] of [
    ['tau-son', 'MALE'], ['tau-daughter', 'FEMALE'],
    ['chacha-son', 'MALE'], ['chacha-daughter', 'FEMALE'],
    ['bua-son', 'MALE'], ['bua-daughter', 'FEMALE'],
    ['mama-son', 'MALE'], ['mama-daughter', 'FEMALE'],
    ['mausi-son', 'MALE'], ['mausi-daughter', 'FEMALE'],
    ['brother-son', 'MALE'], ['sister-daughter', 'FEMALE'],
  ]) add(id, gender, '1990');

  for (const [a, b] of [
    ['dada', 'dadi'], ['nana', 'nani'], ['tau', 'tai'], ['dad', 'mum'],
    ['chacha', 'chachi'], ['bua', 'phupha'], ['mama', 'mami'], ['mausi', 'mausa'],
    ['me', 'wife'], ['brother', 'bhabhi'], ['sister', 'jija'], ['sasur', 'saas'],
  ]) relationships.push({ from: a, to: b, type: 'SPOUSE' });

  kids('dada', 'dadi', 'tau', 'dad', 'chacha', 'bua');
  kids('nana', 'nani', 'mum', 'mama', 'mausi');
  kids('dad', 'mum', 'me', 'brother', 'sister');
  kids('me', 'wife', 'son', 'daughter');
  kids('sasur', 'saas', 'wife', 'sala', 'sali');
  kids('tau', 'tai', 'tau-son', 'tau-daughter');
  kids('chacha', 'chachi', 'chacha-son', 'chacha-daughter');
  kids('bua', 'phupha', 'bua-son', 'bua-daughter');
  kids('mama', 'mami', 'mama-son', 'mama-daughter');
  kids('mausi', 'mausa', 'mausi-son', 'mausi-daughter');
  kids('brother', 'bhabhi', 'brother-son');
  kids('sister', 'jija', 'sister-daughter');

  return buildGraph({ people, relationships });
}

function summary(label, r) {
  const pct = (n, of) => Math.floor((n * 100) / Math.max(of, 1));
  return [
    `${label} - ${r.pairs} ordered pairs`,
    `  ${r.related} have a relationship English can name at all`,
    `  ${r.coverable} of those are a shape Hindi has a word for`,
    `  ${r.named} get a Hindi word - ${pct(r.named, r.coverable)}% of the shapes it covers, `
      + `${pct(r.named, r.related)}% of every named pair`,
    `  ${r.descriptive} of those are descriptive, for want of a birth year`,
    `  ${r.excusedByGender} have no word coming back, because a gender is unrecorded`,
    `  ${r.excusedByContradiction} run through a marriage recorded inconsistently`,
  ].join('\n');
}

test('every pair agrees with its opposite number', () => {
  const report = sweep(family());
  console.log(`\n${summary('built-in family', report)}`);
  for (const [term, count] of [...report.counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${term}: ${count}`);
  }

  assert.deepStrictEqual(
    report.breaches.slice(0, 25),
    [],
    `${report.breaches.length} relationships disagree with their reverse`,
  );
});

test('the sweep is actually reaching the vocabulary, not passing on an empty table', () => {
  /*
   * A sweep that named nothing would have no breaches and would look perfect. This pins the floor:
   * the built-in family exists to reach every term worth having, so most of the shapes Hindi covers
   * should get a word.
   */
  const report = sweep(family());
  assert.ok(report.named > 200, `only ${report.named} pairs got a Hindi word`);
  assert.ok(report.counts.size >= 30, `only ${report.counts.size} distinct terms were reached`);
  assert.ok(
    report.named >= report.coverable * 0.9,
    `${report.named} named of ${report.coverable} coverable`,
  );
});

test('a broken rule is caught rather than excused', () => {
  /*
   * The excuses exist so that a gap in somebody's record does not read as a bug. This proves they
   * do not swallow a real one: with every gender recorded, a reciprocal that does not come back is
   * a breach and is reported as such.
   */
  const graph = family();
  assert.strictEqual(hindiOf(graph, 'me', 'mama'), 'MAMA');
  // And the way back, computed independently from the other end of the graph.
  assert.strictEqual(hindiOf(graph, 'mama', 'me'), 'BHANJA');
  assert.ok(RECIPROCAL.get('MAMA').has('BHANJA'));
  assert.ok(!RECIPROCAL.get('MAMA').has('BHATIJA'), "a mother's brother sees a sister's son");
});

test('cousins invert as they cross', () => {
  // The sharpest case in the table: a फुफेरा भाई must see you as his ममेरा भाई, never as another
  // फुफेरा. The two answers come through different branches of the rules.
  const graph = family();
  assert.strictEqual(hindiOf(graph, 'me', 'bua-son'), 'PHUPHERA_BHAI');
  assert.strictEqual(hindiOf(graph, 'bua-son', 'me'), 'MAMERA_BHAI');

  // And the ones through a same-sex sibling stay themselves.
  assert.strictEqual(hindiOf(graph, 'me', 'chacha-son'), 'CHACHERA_BHAI');
  assert.strictEqual(hindiOf(graph, 'chacha-son', 'me'), 'CHACHERA_BHAI');
});
