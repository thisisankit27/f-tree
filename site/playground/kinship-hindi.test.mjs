/*
 * HindiKinshipTest.kt, case for case.
 *
 * This is the file that decides whether the feature is right. English collapses five Hindi words
 * into "uncle", so every one of these could be quietly wrong in a way no English test would catch --
 * and a Hindi speaker reading "चाचा" for their mother's brother sees the mistake instantly, where
 * "uncle" was merely vague.
 *
 * These are not new tests. Every one is a translation of a case in
 * `app/src/test/java/com/vibethroughcode/ftree/graph/HindiKinshipTest.kt`, kept in the same order
 * and with the same names, because the point of the exercise is that two implementations of one
 * family's vocabulary must not drift apart. Reading the two files side by side should be dull.
 */

import test from 'node:test';
import assert from 'node:assert';

import { buildGraph, relate } from './model.js';
import { hindiTerm } from './kinship-hindi.js';
import { HINDI_WORDS, HINDI_TERMS } from './kinship-hi.js';

class Builder {
  constructor() {
    this.people = [];
    this.relationships = [];
  }

  person(id, gender, born = null) {
    this.people.push({ id, name: id, gender, birthDate: born });
    return this;
  }

  man(id, born = null) { return this.person(id, 'MALE', born); }
  woman(id, born = null) { return this.person(id, 'FEMALE', born); }

  childrenOf(a, b, ...children) {
    for (const child of children) {
      this.relationships.push({ from: a, to: child, type: 'PARENT' });
      this.relationships.push({ from: b, to: child, type: 'PARENT' });
    }
    return this;
  }

  married(a, b) {
    this.relationships.push({ from: a, to: b, type: 'SPOUSE' });
    return this;
  }

  build() {
    // The Kotlin's builder tolerates a parent id that is not a person; `buildGraph` drops such an
    // edge, which is the same outcome by a different route.
    const known = new Set(this.people.map((p) => p.id));
    return buildGraph({
      people: this.people,
      relationships: this.relationships.filter((r) => known.has(r.from) && known.has(r.to)),
    });
  }
}

/**
 * "me" at the centre, with both sides of the family recorded and birth years where the order
 * matters -- the father's brothers, because ताऊ and चाचा are told apart by nothing else.
 */
const family = () => new Builder()
  // Father's parents, and his siblings: an elder brother, a younger brother, a sister.
  .man('dada', '1930').woman('dadi', '1934')
  .man('tau', '1952').woman('tau-wife', '1955')
  .man('dad', '1958').woman('mum', '1960')
  .man('chacha', '1963').woman('chacha-wife', '1966')
  .woman('bua', '1955').man('bua-husband', '1952')
  // Mother's parents, and her siblings: a brother and a sister.
  .man('nana', '1932').woman('nani', '1936')
  .man('mama', '1956').woman('mama-wife', '1959')
  .woman('mausi', '1962').man('mausi-husband', '1960')
  // Me, my wife, my brother and sister, my children.
  .man('me', '1985').woman('wife', '1987')
  .man('brother', '1988').woman('sister', '1990')
  .man('son', '2012').woman('daughter', '2015')
  .man('grandson', '2040').woman('granddaughter', '2042')
  // The cousins, one set from each aunt and uncle.
  .man('chachera', '1990').woman('chacheri', '1992')
  .man('phuphera', '1988').woman('phupheri', '1991')
  .man('mamera', '1989').woman('mameri', '1993')
  .man('mausera', '1994').woman('mauseri', '1996')
  // Nieces and nephews, through my brother and through my sister.
  .man('bhatija', '2014').woman('bhatiji', '2016')
  .man('bhanja', '2018').woman('bhanji', '2020')
  // My wife's family, for the in-law terms.
  .man('sasur', '1958').woman('saas', '1961')
  .man('sala', '1990').woman('sali', '1992')
  // Spouses of my own siblings.
  .man('jija', '1986').woman('bhabhi', '1989')

  .married('dada', 'dadi').married('nana', 'nani')
  .married('dad', 'mum').married('me', 'wife')
  .married('tau', 'tau-wife').married('chacha', 'chacha-wife')
  .married('bua', 'bua-husband').married('mama', 'mama-wife')
  .married('mausi', 'mausi-husband')
  .married('sasur', 'saas')
  .married('sister', 'jija').married('brother', 'bhabhi')

  .childrenOf('dada', 'dadi', 'tau', 'dad', 'chacha', 'bua')
  .childrenOf('nana', 'nani', 'mum', 'mama', 'mausi')
  .childrenOf('dad', 'mum', 'me', 'brother', 'sister')
  .childrenOf('me', 'wife', 'son', 'daughter')
  .childrenOf('son', 'daughter-in-law-unused', 'grandson')
  .childrenOf('chacha', 'chacha-wife', 'chachera', 'chacheri')
  .childrenOf('bua', 'bua-husband', 'phuphera', 'phupheri')
  .childrenOf('mama', 'mama-wife', 'mamera', 'mameri')
  .childrenOf('mausi', 'mausi-husband', 'mausera', 'mauseri')
  .childrenOf('brother', 'bhabhi', 'bhatija', 'bhatiji')
  .childrenOf('sister', 'jija', 'bhanja', 'bhanji')
  .childrenOf('sasur', 'saas', 'wife', 'sala', 'sali')
  .build();

/** The word for `other` as seen from `subject`. */
function word(graph, subject, other) {
  const answer = relate(graph, subject, other);
  if (answer.kind !== 'related') {
    throw new Error(`${subject} and ${other} are not related in the fixture`);
  }
  return hindiTerm(
    answer.kinship,
    graph.people.get(subject)?.gender ?? 'UNSPECIFIED',
    graph.people.get(other)?.gender ?? 'UNSPECIFIED',
  );
}

const shared = family();
const assertWord = (expected, other, subject = 'me') => {
  assert.strictEqual(word(shared, subject, other), expected, `${other}, seen from ${subject}`);
};

/* --------------------------------------------------------------------------- the sides */

test('the two grandfathers have different words', () => {
  // The distinction the whole feature exists for. English says "grandfather" twice; Hindi says
  // दादा for the father's father and नाना for the mother's, and they are not interchangeable.
  assertWord('DADA', 'dada');
  assertWord('DADI', 'dadi');
  assertWord('NANA', 'nana');
  assertWord('NANI', 'nani');
});

test("mother's brother is मामा and father's brother is not", () => {
  // The reported case: Ankit's mother's brother is his मामा, never his चाचा.
  assertWord('MAMA', 'mama');
  assertWord('CHACHA', 'chacha');
});

test("all four kinds of parent's sibling are distinguished", () => {
  assertWord('TAU', 'tau');          // father's elder brother
  assertWord('CHACHA', 'chacha');    // father's younger brother
  assertWord('BUA', 'bua');          // father's sister
  assertWord('MAMA', 'mama');        // mother's brother
  assertWord('MAUSI', 'mausi');      // mother's sister
});

test('their spouses take the word that belongs to them', () => {
  assertWord('TAI', 'tau-wife');
  assertWord('CHACHI', 'chacha-wife');
  assertWord('PHUPHA', 'bua-husband');
  assertWord('MAMI', 'mama-wife');
  assertWord('MAUSA', 'mausi-husband');
});

/* ------------------------------------------------------------------------ birth order */

test("without birth years father's brother is named descriptively", () => {
  /*
   * ताऊ is the elder brother and चाचा the younger, and nothing but a date says which. With the
   * years removed the app says "father's brother" rather than picking one -- the same rule that
   * removed "related by marriage": claim precision only where the record supports it.
   */
  const undated = new Builder()
    .man('dada').woman('dadi')
    .man('dad').woman('mum')
    .man('uncle').woman('uncle-wife')
    .man('me')
    .married('dad', 'mum').married('uncle', 'uncle-wife')
    .childrenOf('dada', 'dadi', 'dad', 'uncle')
    .childrenOf('dad', 'mum', 'me')
    .build();

  assert.strictEqual(word(undated, 'me', 'uncle'), 'FATHERS_BROTHER');
  assert.strictEqual(word(undated, 'me', 'uncle-wife'), 'FATHERS_BROTHERS_WIFE');
});

test('the descriptive terms ask for birth years', () => {
  // And they say so, which is how the screen knows to offer the nudge.
  assert.ok(HINDI_WORDS.FATHERS_BROTHER.needsBirthYears);
  assert.ok(HINDI_WORDS.FATHERS_BROTHERS_WIFE.needsBirthYears);
  assert.ok(HINDI_WORDS.HUSBANDS_BROTHER.needsBirthYears);
  assert.strictEqual(
    HINDI_TERMS.filter((t) => HINDI_WORDS[t].needsBirthYears).length,
    3,
    'no other term should be claiming it needs a birth year',
  );
});

test('years that could overlap do not settle the order', () => {
  // "1958" and "1958" could be either way round.
  const ambiguous = new Builder()
    .man('dada').woman('dadi')
    .man('dad', '1958').man('uncle', '1958')
    .woman('mum').man('me')
    .married('dad', 'mum')
    .childrenOf('dada', 'dadi', 'dad', 'uncle')
    .childrenOf('dad', 'mum', 'me')
    .build();

  assert.strictEqual(word(ambiguous, 'me', 'uncle'), 'FATHERS_BROTHER');
});

test('the other sides never need a birth year', () => {
  // Only the father's brothers ever need a date. मामा and मौसी never do.
  const undated = new Builder()
    .man('nana').woman('nani')
    .man('dad').woman('mum')
    .man('mama').woman('mausi')
    .man('me')
    .married('dad', 'mum')
    .childrenOf('nana', 'nani', 'mum', 'mama', 'mausi')
    .childrenOf('dad', 'mum', 'me')
    .build();

  assert.strictEqual(word(undated, 'me', 'mama'), 'MAMA');
  assert.strictEqual(word(undated, 'me', 'mausi'), 'MAUSI');
});

/* ------------------------------------------------------------------------- downward */

test('grandchildren are named by which child they come through', () => {
  assertWord('BETA', 'son');
  assertWord('BETI', 'daughter');
  // A son's son is पोता; a daughter's would be नाती.
  assertWord('POTA', 'grandson');
});

test('nieces and nephews are named by the sibling, not by themselves', () => {
  assertWord('BHATIJA', 'bhatija');   // brother's son
  assertWord('BHATIJI', 'bhatiji');   // brother's daughter
  assertWord('BHANJA', 'bhanja');     // sister's son
  assertWord('BHANJI', 'bhanji');     // sister's daughter
});

/* -------------------------------------------------------------------------- cousins */

test('cousins are named through the aunt or uncle', () => {
  /*
   * Hindi has no separate word for a cousin -- they are brothers and sisters with a qualifier
   * naming the aunt or uncle they come through, which is four different words where English has
   * one.
   */
  assertWord('CHACHERA_BHAI', 'chachera');
  assertWord('CHACHERI_BEHEN', 'chacheri');
  assertWord('PHUPHERA_BHAI', 'phuphera');
  assertWord('PHUPHERI_BEHEN', 'phupheri');
  assertWord('MAMERA_BHAI', 'mamera');
  assertWord('MAMERI_BEHEN', 'mameri');
  assertWord('MAUSERA_BHAI', 'mausera');
  assertWord('MAUSERI_BEHEN', 'mauseri');
});

/* ------------------------------------------------------------------------ by marriage */

test('the immediate family and the in-laws beside it', () => {
  assertWord('PITA', 'dad');
  assertWord('MATA', 'mum');
  assertWord('BHAI', 'brother');
  assertWord('BEHEN', 'sister');
  assertWord('PATNI', 'wife');
  assertWord('SASUR', 'sasur');
  assertWord('SAAS', 'saas');
});

test("a sibling's spouse is named through the sibling", () => {
  // जीजा is a sister's husband and भाभी a brother's wife -- the sibling picks the word.
  assertWord('JIJA', 'jija');
  assertWord('BHABHI', 'bhabhi');
});

test("spouse's siblings depend on the gender of the person asking", () => {
  /*
   * A wife's brother is साला to a man; a husband's brother is जेठ or देवर to a woman, and which one
   * depends on his age against her husband's.
   */
  assertWord('SALA', 'sala');
  assertWord('SALI', 'sali');

  // The same two people, asked from the wife's side: her husband's brother and sister.
  assert.strictEqual(word(shared, 'wife', 'brother'), 'DEVAR');
  assert.strictEqual(word(shared, 'wife', 'sister'), 'NANAD');
});

test("a husband's elder brother is जेठ and a younger one देवर", () => {
  // "brother" is born 1988, after "me" in 1985, so to my wife he is the younger -- देवर.
  assert.strictEqual(word(shared, 'wife', 'brother'), 'DEVAR');

  const elder = new Builder()
    .man('dad').woman('mum')
    .man('husband', '1985').man('his-brother', '1980')
    .woman('her')
    .married('husband', 'her')
    .childrenOf('dad', 'mum', 'husband', 'his-brother')
    .build();
  assert.strictEqual(word(elder, 'her', 'his-brother'), 'JETH');
});

/* ------------------------------------------------------------- where Hindi has no word */

test('relationships Hindi has no word for come back empty', () => {
  /*
   * Second cousins, removed cousins and great-uncles have no everyday Hindi word, and inventing a
   * Devanagari compound nobody says would be worse than the English one the screen falls back to.
   */
  const distant = new Builder()
    .man('great').woman('great-wife')
    .man('grandad').man('granduncle')
    .man('dad').man('cousin-parent')
    .man('me').man('second-cousin')
    .childrenOf('great', 'great-wife', 'grandad', 'granduncle')
    .childrenOf('grandad', 'unknown-a', 'dad')
    .childrenOf('granduncle', 'unknown-b', 'cousin-parent')
    .childrenOf('dad', 'unknown-c', 'me')
    .childrenOf('cousin-parent', 'unknown-d', 'second-cousin')
    .build();

  assert.strictEqual(word(distant, 'me', 'second-cousin'), null);
  assert.strictEqual(word(distant, 'me', 'granduncle'), null);
});

test('an unrecorded gender means no Hindi word', () => {
  // Hindi has no neuter kinship term, so it declines rather than guesses.
  const unknown = new Builder()
    .person('dad', 'UNSPECIFIED')
    .person('me', 'UNSPECIFIED')
    .childrenOf('dad', 'dad', 'me')
    .build();

  assert.strictEqual(word(unknown, 'me', 'dad'), null);
});

test('an unknown side leaves the grandparent to English', () => {
  // A grandparent reached through a parent whose gender was never written down: दादा or नाना cannot
  // be told apart, so neither is claimed.
  const unknown = new Builder()
    .man('grandad')
    .person('parent', 'UNSPECIFIED')
    .man('me')
    .childrenOf('grandad', 'grandad', 'parent')
    .childrenOf('parent', 'parent', 'me')
    .build();

  assert.strictEqual(word(unknown, 'me', 'grandad'), null);
});
