/*
 * The compact view's own rendering: generation bands, as text.
 *
 * Kept apart from `app.js` and from the model on purpose. `compactFamily` in
 * `site/playground/compact.js` decides *who is on which row and in what order* -- a family rule,
 * shared with the website and held to the Kotlin's test table. This file decides only how that
 * reads on a page, which is this shell's business alone and nobody else's.
 *
 * The two visual devices here both come from the chart rather than from a stylesheet:
 *
 *   A marriage is a doubled rule. The chart draws a couple joined by one, and a couple that drifts
 *   apart on screen stops looking like a couple. Between names, the same mark: a double line
 *   between two people who married, and nothing between two people who merely share a group. That
 *   is why `CompactGroup.links` exists rather than the group simply being a list -- somebody who
 *   married twice puts three people in one group, and marking all three gaps would state a wedding
 *   that never happened.
 *
 *   A generation's heading counts the people it is *about*. A step-grandmother is family and is
 *   shown, and she is not a fifth grandparent.
 */

import { displayName, birthYear, lifespan } from '../../site/playground/model.js';

/**
 * What a generation is called, worked out from its distance rather than looked up.
 *
 * The bands are keyed by number, so "four generations up" needs no new case: the greats accumulate.
 * The alternative -- a table of names -- runs out, and a chart that says "generation -5" has given
 * up on being read aloud.
 */
export function bandHeading(offset) {
  if (offset === 0) return 'Brothers and sisters';
  const up = offset < 0;
  const rings = Math.abs(offset);
  const base = up ? 'Parents' : 'Children';
  if (rings === 1) return base;
  // Lower-case after the first, because that is how the word is written: "great-grandparents", not
  // "Great-Grandparents". The heading is set in capitals by the stylesheet, but the string is also
  // the accessible name for the section, and that is read as written.
  const grand = up ? 'grandparents' : 'grandchildren';
  const greats = 'great-'.repeat(rings - 2) + grand;
  return greats[0].toUpperCase() + greats.slice(1);
}

/** The years under a name: a lifespan where there is one, and nothing rather than a guess. */
function years(person) {
  const span = lifespan(person);
  return span === 'Late' ? 'Late' : span;
}

function nameOf(person, ofBand) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'band-name';
  el.dataset.id = person.id;
  // Married into this generation rather than born to it. The heading has already declined to count
  // them; this is the same fact, said quietly enough to read past.
  el.dataset.married = String(!ofBand);

  const who = document.createElement('span');
  who.className = 'band-who';
  const name = displayName(person);
  if (person.name) who.textContent = name;
  else {
    // The viewer shows an unnamed person in italics everywhere else. Keep it.
    const em = document.createElement('em');
    em.textContent = name;
    who.append(em);
  }
  el.append(who);

  const when = years(person);
  if (when) {
    const dates = document.createElement('span');
    dates.className = 'band-when';
    dates.textContent = when;
    el.append(dates);
  }
  el.title = `Centre this view on ${name}`;
  return el;
}

/** One block on a row: the people, with a doubled rule wherever there is a marriage. */
function groupRow(group) {
  const row = document.createElement('div');
  row.className = 'band-group';
  group.people.forEach((person, i) => {
    if (i > 0) {
      const join = document.createElement('span');
      // Only a marriage gets the mark. A gap inside a group that is not a marriage stays a gap.
      join.className = group.married(i - 1) ? 'band-join married' : 'band-join';
      join.setAttribute('aria-hidden', 'true');
      row.append(join);
      if (group.married(i - 1)) {
        const said = document.createElement('span');
        said.className = 'sr-only';
        said.textContent = ' married to ';
        row.append(said);
      }
    }
    row.append(nameOf(person, group.ofBand.has(person.id)));
  });
  return row;
}

/**
 * The centre of the view: its own block rather than a card in a row.
 *
 * Everywhere else in this app, clicking a person opens the panel that edits them. Here a click
 * re-centres, because walking outwards through a family is what this view is for and asking for two
 * different clicks on the same name would make both of them uncertain. So editing is offered once,
 * from the block for the person already centred, and the walk stays a single unambiguous action.
 */
function focusBlock(focus, { onEdit }) {
  const block = document.createElement('div');
  block.className = 'band-focus';

  const head = document.createElement('div');
  head.className = 'band-focus-head';

  const name = document.createElement('h3');
  name.className = 'band-focus-name';
  name.textContent = displayName(focus.person);
  head.append(name);

  const when = years(focus.person);
  if (when) {
    const dates = document.createElement('p');
    dates.className = 'band-focus-when';
    dates.textContent = when;
    head.append(dates);
  }

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'btn quiet band-edit';
  edit.textContent = 'Edit this person';
  edit.addEventListener('click', () => onEdit(focus.person.id));
  head.append(edit);

  block.append(head);

  if (focus.partners.length) {
    const married = document.createElement('p');
    married.className = 'band-focus-married';
    focus.partners.forEach((partner, i) => {
      if (i > 0) married.append(document.createTextNode(' and '));
      married.append(document.createTextNode(i === 0 ? 'Married to ' : ''));
      married.append(nameOf(partner, false));
    });
    block.append(married);
  }

  return block;
}

function bandSection(band) {
  const section = document.createElement('section');
  section.className = 'band';
  section.dataset.offset = String(band.offset);

  const heading = document.createElement('h3');
  heading.className = 'band-heading';
  const words = document.createElement('span');
  words.textContent = bandHeading(band.offset);
  heading.append(words);
  // The count is what the heading is about, so it sits in the heading: the number of people of this
  // generation, not the number of names on the row.
  if (band.count > 0) {
    const tally = document.createElement('span');
    tally.className = 'band-count';
    tally.textContent = String(band.count);
    heading.append(tally);
  }
  section.append(heading);

  for (const group of band.groups) section.append(groupRow(group));
  return section;
}

/**
 * Draws a `CompactFamily` into `container`.
 *
 * `onFocus` is given a person's id when somebody clicks a name; `onEdit` when the centred person is
 * to be edited; `onMore` when the reader asks for another generation. All three are the caller's,
 * so this file holds no state and can be rendered twice with the same result.
 */
export function renderBands(container, family, { onFocus, onEdit, onMore, generations }) {
  container.replaceChildren();

  if (family.isEmpty) {
    const empty = document.createElement('p');
    empty.className = 'band-empty';
    empty.textContent = 'Add somebody to the tree and their family will be read out here.';
    container.append(empty);
    return;
  }

  const head = document.createElement('div');
  head.className = 'band-head';
  const title = document.createElement('h2');
  title.className = 'index-heading';
  title.textContent = `${displayName(family.focus.person)}’s family`;
  head.append(title);

  const note = document.createElement('p');
  note.className = 'index-note';
  note.textContent = summary(family, generations);
  head.append(note);
  container.append(head);

  for (const band of family.ancestors) container.append(bandSection(band));
  container.append(focusBlock(family.focus, { onEdit }));
  if (family.siblings) container.append(bandSection(family.siblings));
  for (const band of family.descendants) container.append(bandSection(band));

  if (family.truncated) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn quiet band-more';
    more.textContent = 'Show more generations';
    more.addEventListener('click', onMore);
    container.append(more);
  }

  container.addEventListener('click', (event) => {
    const name = event.target.closest('.band-name');
    if (name) onFocus(name.dataset.id);
  });
}

/**
 * The line under the heading: how far this reading reaches, and whether the record goes further.
 *
 * Said in generations rather than in a count of people, because that is the question a reader has
 * when they are deciding whether to ask for more.
 */
export function summary(family, generations) {
  const up = family.ancestors.length;
  const down = family.descendants.length;
  const parts = [];
  if (up) parts.push(`${count(up, 'generation')} up`);
  if (down) parts.push(`${count(down, 'generation')} down`);
  if (!parts.length) parts.push('nobody else recorded');
  const reach = parts.join(', ');
  if (!family.truncated) return `${reach}. That is everybody the record holds.`;
  return `${reach}. The record continues past ${generations} — ask for more to read it.`;
}

function count(n, singular) {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}
