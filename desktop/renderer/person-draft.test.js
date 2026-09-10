/*
 * The person panel's staged edits (#148) and date typing (#90's desktop half).
 *
 * There is no Kotlin test table to translate: `PersonEditViewModel.validate()` has none. So the
 * cases here are written from what that function does, and the ones that encode a *decision* rather
 * than arithmetic -- overlapping dates are allowed, a blank form is valid, a death date implies a
 * death -- say which line of the Kotlin they come from.
 */

import test from 'node:test';
import assert from 'node:assert';

import {
  DateProblem, draftFrom, withChange, dateProblems, canSave, isDirty, fieldsFrom, isBlankPerson,
  normaliseDateTyping,
} from './person-draft.js';

const blank = draftFrom({ id: 'p' });

/* ------------------------------------------------------------------ dates */

test('a blank date is not a problem -- most of a tree is people nobody has dates for', () => {
  assert.deepStrictEqual(dateProblems(blank), { birthDate: null, deathDate: null });
  assert.ok(canSave(blank), 'a completely blank form is valid (canSave in the Kotlin)');
});

test('the three precisions are all accepted', () => {
  for (const date of ['1938', '1938-04', '1938-04-17']) {
    assert.strictEqual(dateProblems({ ...blank, birthDate: date }).birthDate, null, date);
  }
});

test('anything else is malformed, including a day that does not exist', () => {
  for (const date of ['38', '1938-4', '17/04/1938', '1938-13', '1938-02-30', 'about 1938', '1938-']) {
    assert.strictEqual(dateProblems({ ...blank, birthDate: date }).birthDate,
      DateProblem.MALFORMED, date);
  }
});

test('surrounding space is not a problem; the tree trims it anyway', () => {
  assert.strictEqual(dateProblems({ ...blank, birthDate: ' 1938 ' }).birthDate, null);
});

test('a death before the birth is refused, and it is the death field that says so', () => {
  const problems = dateProblems({ ...blank, birthDate: '1950', deathDate: '1949-12-31' });
  assert.deepStrictEqual(problems, { birthDate: null, deathDate: DateProblem.DEATH_BEFORE_BIRTH });
  assert.ok(!canSave({ ...blank, birthDate: '1950', deathDate: '1949' }));
});

test('overlapping partial dates are allowed -- "born 1938, died 1938" is real', () => {
  // The Kotlin compares death.latest() with birth.earliest(), not the other way round.
  for (const [birth, death] of [['1938', '1938'], ['1938-04', '1938'], ['1938', '1938-01-01'],
    ['1938-04-17', '1938-04']]) {
    assert.strictEqual(dateProblems({ ...blank, birthDate: birth, deathDate: death }).deathDate,
      null, `${birth} / ${death}`);
  }
});

test('a malformed date is reported as malformed, not also as out of order', () => {
  const problems = dateProblems({ ...blank, birthDate: '1950', deathDate: '19x' });
  assert.strictEqual(problems.deathDate, DateProblem.MALFORMED);
});

/* ------------------------------------------------------------------ a death and its date */

test('typing a death date says the person has died', () => {
  // onDeathDateChange: `deceased = it.deceased || value.isNotBlank()`
  assert.strictEqual(withChange(blank, 'deathDate', '2001').deceased, true);
  assert.strictEqual(withChange(blank, 'deathDate', '  ').deceased, false);
});

test('clearing "no longer living" takes the death date with it', () => {
  // onDeceasedChange: `deathDate = if (value) it.deathDate else ""`
  const died = { ...blank, deceased: true, deathDate: '2001' };
  assert.deepStrictEqual(withChange(died, 'deceased', false), { ...died, deceased: false, deathDate: '' });
  assert.strictEqual(withChange(blank, 'deceased', true).deathDate, '', 'ticking it invents nothing');
});

test('clearing a death date leaves the person dead -- plenty of deaths have no date', () => {
  const died = { ...blank, deceased: true, deathDate: '2001' };
  assert.strictEqual(withChange(died, 'deathDate', '').deceased, true);
});

/* ------------------------------------------------------------------ dirty */

test('a form straight from a person is not dirty', () => {
  const person = { id: 'p', name: 'Shyam Lal', birthDate: '1938', deceased: true, notes: 'x' };
  assert.ok(!isDirty(draftFrom(person), person));
});

test('any field that differs makes it dirty', () => {
  const person = { id: 'p', name: 'Shyam Lal' };
  for (const [key, value] of [['name', 'Shyam'], ['gender', 'MALE'], ['birthDate', '1938'],
    ['deathDate', '2001'], ['deceased', true], ['notes', 'x']]) {
    assert.ok(isDirty({ ...draftFrom(person), [key]: value }, person), key);
  }
});

test('a trailing space is not an edit, because it is not kept', () => {
  const person = { id: 'p', name: 'Shyam Lal' };
  assert.ok(!isDirty({ ...draftFrom(person), name: 'Shyam Lal  ' }, person));
});

test('the fields handed to the tree name every field, so clearing one clears it', () => {
  const fields = fieldsFrom({ ...blank, name: 'Ravi' });
  assert.deepStrictEqual(Object.keys(fields).sort(),
    ['birthDate', 'deathDate', 'deceased', 'gender', 'name', 'notes']);
  assert.strictEqual(fields.gender, null, 'no gender is null, not the empty string');
});

test('blank means nothing recorded at all, a photograph included', () => {
  assert.ok(isBlankPerson({ id: 'p' }));
  assert.ok(isBlankPerson({ id: 'p', name: '' }));
  assert.ok(!isBlankPerson({ id: 'p', notes: 'x' }));
  assert.ok(!isBlankPerson({ id: 'p', photo: 'photos/a.jpg' }));
  assert.ok(!isBlankPerson({ id: 'p', deceased: true }));
  assert.ok(!isBlankPerson(null));
});

/* ------------------------------------------------------------------ typing a date (#90) */

const typed = (value, caret) => normaliseDateTyping(value, caret);

test('a space, a slash or a full stop becomes a hyphen', () => {
  assert.strictEqual(typed('1938 04 17').value, '1938-04-17');
  assert.strictEqual(typed('1938/04/17').value, '1938-04-17');
  assert.strictEqual(typed('1938.04.17').value, '1938-04-17');
});

test('a separator can neither lead nor double up', () => {
  assert.strictEqual(typed(' 1938').value, '1938');
  assert.strictEqual(typed('-1938').value, '1938');
  assert.strictEqual(typed('1938  04').value, '1938-04');
  assert.strictEqual(typed('1938- 04').value, '1938-04');
});

test('a trailing separator survives, because the next digits are on their way', () => {
  assert.strictEqual(typed('1938 ').value, '1938-');
});

test('anything that is not a separator is left for the validator to judge', () => {
  // Normalising is about the separator only. Loosening what counts as a date is not its job.
  assert.strictEqual(typed('abt 1938').value, 'abt-1938');
  assert.strictEqual(typed('17 04 1938').value, '17-04-1938');
});

test('the caret stays where it was, allowing for anything dropped before it', () => {
  assert.deepStrictEqual(typed('1938 ', 5), { value: '1938-', caret: 5 });
  assert.deepStrictEqual(typed('1938--', 6), { value: '1938-', caret: 5 });
  // A space typed in front of the year is dropped, and the caret with it.
  assert.deepStrictEqual(typed(' 1938', 1), { value: '1938', caret: 0 });
  // Editing in the middle: a doubled separator after the caret moves nothing before it.
  assert.deepStrictEqual(typed('19-38--04', 2), { value: '19-38-04', caret: 2 });
});

test('a value that needs nothing done comes back unchanged', () => {
  assert.deepStrictEqual(typed('1938-04-17', 4), { value: '1938-04-17', caret: 4 });
  assert.deepStrictEqual(typed('', 0), { value: '', caret: 0 });
});
