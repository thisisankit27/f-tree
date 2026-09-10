/*
 * The vocabulary, held to the file a Hindi speaker actually reviews.
 *
 * `app/src/main/res/values/kinship_hi.xml` is the phone's copy and the one a Hindi speaker reads as
 * a flat list without wading through code. This test reads that XML and asserts the JavaScript
 * table matches it exactly -- every term, every spelling, every gloss.
 *
 * It is the reason `kinship-hi.js` is a generated table rather than something clever. A second
 * implementation of somebody's family vocabulary is a thing that can drift, and a misspelled kinship
 * word is not a cosmetic bug: it is the app telling a family it knows how they speak and being
 * wrong about it.
 *
 * Nothing under `app/` is written by this test. It only reads.
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HINDI_WORDS, HINDI_TERMS, hindiWord } from './kinship-hi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const XML = path.join(here, '..', '..', 'app', 'src', 'main', 'res', 'values', 'kinship_hi.xml');

/** The phone's vocabulary, as `{ TERM: { word, gloss } }`. */
async function fromResources() {
  const xml = await readFile(XML, 'utf8');
  const entries = [...xml.matchAll(/<string name="kin_hi_([a-z_]+)"[^>]*>([\s\S]*?)<\/string>/g)];

  const terms = {};
  for (const [, name, raw] of entries) {
    // Android escapes an apostrophe in a resource string; the word itself does not carry the slash.
    const value = raw.replace(/\\'/g, "'").trim();
    const gloss = name.endsWith('_gloss');
    const key = (gloss ? name.slice(0, -6) : name).toUpperCase();
    terms[key] ??= {};
    terms[key][gloss ? 'gloss' : 'word'] = value;
  }
  return terms;
}

test('every term the phone spells is spelled here, identically', async () => {
  const theirs = await fromResources();

  for (const [term, { word, gloss }] of Object.entries(theirs)) {
    const ours = hindiWord(term);
    assert.ok(ours, `${term} is in the resources and not in the table`);
    assert.strictEqual(ours.word, word, `${term} is spelled differently`);
    assert.strictEqual(ours.gloss, gloss, `${term} is glossed differently`);
  }
});

test('and this table spells nothing the phone does not', async () => {
  // The other direction, which the loop above cannot see. A term invented here would be a word this
  // app says and the phone does not, for the same family.
  const theirs = await fromResources();
  const extra = HINDI_TERMS.filter((term) => !(term in theirs));
  assert.deepStrictEqual(extra, []);
});

test('there are 65 terms, and both lists agree on that', async () => {
  const theirs = await fromResources();
  assert.strictEqual(HINDI_TERMS.length, 65);
  assert.strictEqual(Object.keys(theirs).length, 65);
});

test('a word and its gloss cannot lose each other', () => {
  /*
   * They were two resources on the phone -- `kin_hi_bua` and `kin_hi_bua_gloss` -- and two lists of
   * 65 things are two lists that can fall out of alignment. Here a term is one object or it is
   * nothing.
   */
  for (const term of HINDI_TERMS) {
    const entry = HINDI_WORDS[term];
    assert.ok(entry.word?.length, `${term} has no word`);
    assert.ok(entry.gloss?.length, `${term} has no gloss`);
  }
});

test('the three descriptive terms are the ones that ask for birth years', () => {
  /*
   * ताऊ is the elder brother and चाचा the younger, and with no birth years there is no way to tell.
   * These three are the fallbacks, and they are correct as they stand -- "पिता के भाई" is what he is
   * -- so the flag is for offering the reader a way to sharpen them, not for apologising.
   */
  const flagged = HINDI_TERMS.filter((t) => HINDI_WORDS[t].needsBirthYears);
  assert.deepStrictEqual(flagged.sort(), [
    'FATHERS_BROTHER', 'FATHERS_BROTHERS_WIFE', 'HUSBANDS_BROTHER',
  ]);
});

test('the glosses say which uncle, where English will not', () => {
  // English says "uncle" five ways. The gloss says which one, so a younger relative who does not
  // know फूफा can still read the answer.
  assert.strictEqual(hindiWord('TAU').gloss, "father's elder brother");
  assert.strictEqual(hindiWord('CHACHA').gloss, "father's younger brother");
  assert.strictEqual(hindiWord('MAMA').gloss, "mother's brother");
  assert.strictEqual(hindiWord('PHUPHA').gloss, "father's sister's husband");
  assert.strictEqual(hindiWord('MAUSA').gloss, "mother's sister's husband");
});

test('a term nobody has is null rather than a guess', () => {
  assert.strictEqual(hindiWord('SECOND_COUSIN_TWICE_REMOVED'), null);
  assert.strictEqual(hindiWord(null), null);
  assert.strictEqual(hindiWord(undefined), null);
});

test('the table cannot be edited by accident', () => {
  // Frozen. Asserted as "the value did not move" rather than "it threw", because these modules are
  // strict-mode ESM in some runtimes and sloppy in others and the claim is about the value.
  const before = HINDI_WORDS.PITA.word;
  try { HINDI_WORDS.PITA = { word: 'x', gloss: 'x' }; } catch { /* strict mode throws */ }
  assert.strictEqual(HINDI_WORDS.PITA.word, before);
});
