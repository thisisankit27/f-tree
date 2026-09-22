/*
 * One row in a name-search dropdown: a person's name (or the italic stand-in `nameNode` already
 * draws for somebody with none) and their lifespan, in a `<li><button>` wired to a pick handler.
 *
 * Three pickers built this exact row by hand before this module existed -- the relation finder's
 * two (`app.js`'s `wireRelate`) and the family book's "Whose story" (`book.js`) -- and had already
 * started to drift on it (one used `person.name` directly instead of `nameNode`'s treatment of an
 * unnamed person). One function now, so the row every name search produces reads the same way
 * everywhere, and a future fourth picker gets it right by construction.
 */

import { lifespan } from '../../site/playground/model.js';
import { nameNode } from './relation.js';

/**
 * @param person   a graph person (`site/playground/model.js`'s `buildGraph`)
 * @param onPick   called with `person` when its button is activated
 * @returns the `<li>`, not yet appended anywhere
 */
export function searchResultRow(person, onPick) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.append(nameNode(person));
  const dates = document.createElement('span');
  dates.className = 'row-dates';
  dates.textContent = lifespan(person) || '';
  button.append(dates);
  button.addEventListener('click', () => onPick(person));
  li.append(button);
  return li;
}
