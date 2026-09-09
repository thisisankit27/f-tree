/*
 * The desktop app.
 *
 * The website's viewer reads a tree; this one builds and changes one, so it has its own controller
 * rather than the viewer's with editing bolted on. What the two share is the engine underneath --
 * the ZIP reader and writer, the graph model, the layout and the canvas -- imported from
 * site/playground/ so a fix to how a family is drawn lands in both.
 *
 * Three rules run through everything below.
 *
 * **Nothing changes the tree except through `Tree`.** It is the only thing that applies the
 * relationship rules, and the only thing that can put a change back. A field that wrote to a person
 * directly would edit somebody's family with no rule check, no undo and no unsaved mark.
 *
 * **One edit is one undo step.** Form fields commit on `change`, not on `input`, so typing a name
 * is one step rather than one per keystroke -- which would make undo useless exactly when it
 * matters.
 *
 * **A refusal is an explanation.** The rules say no for reasons a person can understand, so the
 * interface says the reason and not "invalid".
 */

import { openArchive, parseDocument, ArchiveError } from '../../site/playground/archive.js';
import { buildGraph, displayName, lifespan, relationsOf } from '../../site/playground/model.js';
import { layoutArchive } from '../../site/playground/layout.js';
import { Chart } from '../../site/playground/chart.js';

import { Tree, RelationshipType, Rejection } from './document.js';
import { bytesForTree, SaveRefused } from './save.js';

const { PARENT, SPOUSE, SIBLING } = RelationshipType;

const $ = (id) => document.getElementById(id);
const shell = globalThis.ftreeDesktop ?? null;

const state = {
  tree: null,
  graph: null,
  layout: null,
  /** Photo bytes by entry path, carried from the opened file and written back out. */
  photos: new Map(),
  path: null,
  name: null,
  ownTreeId: '',
  selected: null,
  /** Which kind of relative the "add" form is currently offering. */
  adding: null,
  /** 'chart' or 'index'. */
  view: 'chart',
  /** 'all' or 'living' -- the same filter the phone's people list offers. */
  who: 'all',
  saving: false,
};

let chart = null;

/* ------------------------------------------------------------------ chrome */

function setState(value) {
  $('viewer').dataset.state = value;
}

let toastTimer = null;
function toast(message, tone = 'good') {
  const box = $('toast');
  box.textContent = message;
  box.dataset.tone = tone;
  box.hidden = false;
  clearTimeout(toastTimer);
  // A refusal is longer and worth reading twice; a confirmation is not.
  toastTimer = setTimeout(() => { box.hidden = true; }, tone === 'bad' ? 9000 : 2600);
}

/** Keeps the window, the menu and the dot in step with whether there is work not on disk. */
function reflectDirty() {
  const dirty = Boolean(state.tree?.isDirty);
  $('unsaved').hidden = !dirty;
  $('save').dataset.dirty = String(dirty);
  $('undo').disabled = !state.tree?.canUndo;
  $('redo').disabled = !state.tree?.canRedo;
  $('undo').title = state.tree?.undoLabel ? `Undo: ${state.tree.undoLabel}` : 'Undo';
  $('redo').title = state.tree?.redoLabel ? `Redo: ${state.tree.redoLabel}` : 'Redo';
  shell?.setDirty(dirty);
}

/* ------------------------------------------------------------------ drawing */

/*
 * Rebuilds the graph, the layout and the chart from the tree.
 *
 * Run after every change, which sounds expensive and is not: a few hundred people lay out in
 * single-digit milliseconds, and the alternative -- patching the layout in place -- is a second
 * implementation of the layout rules that would drift from the first.
 *
 * The selection is restored deliberately. `chart.load` clears it, and losing the person you were
 * editing every time you typed their name would be its own bug.
 */
function rebuild({ refit = false } = {}) {
  const doc = state.tree.toExchange();
  state.graph = buildGraph(doc);
  state.layout = layoutArchive(state.graph, { orientation: 'rows' });

  chart.load(state.graph, state.layout, archiveShim());
  chart.selected = state.selected && state.graph.people.has(state.selected)
    ? state.selected
    : null;
  state.selected = chart.selected;
  chart.invalidate();
  if (refit) chart.fit();

  document.body.dataset.orientation = state.layout.orientation;
  renderCounts();
  renderPeople();
  renderPanel();
  renderEmptyInvitation();
  reflectDirty();
  updateZoom();
}

/**
 * What the chart asks for when it wants a photograph.
 *
 * The chart expects something archive-shaped. Photos live in memory here because the file is
 * rewritten on save, so this hands them over from the map rather than re-reading a ZIP.
 */
function archiveShim() {
  return {
    has: (name) => state.photos.has(name),
    read: async (name) => state.photos.get(name),
  };
}

/** One person, two people; one connection, two connections. Said properly, everywhere. */
function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function renderCounts() {
  const people = state.tree.people.length;
  $('counts').textContent = people === 0
    ? 'Nobody yet'
    : `${count(people, 'person', 'people')}·`
      + `${count(state.tree.relationships.length, 'connection', 'connections')}`;
}

/* ------------------------------------------------------------------ everyone, as a list */

function setView(view) {
  state.view = view;
  $('viewer').dataset.view = view;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  $('index').hidden = view !== 'index';
  if (view === 'chart') chart.resize();
  else renderPeople();
}

/**
 * Everyone, grouped as the chart groups them and sorted by name.
 *
 * Grouped rather than one flat list because the grouping carries information the chart shows and
 * a list normally loses: which people form a family, and which are connected to nobody at all.
 * That last group is the reason this view exists on the website too -- somebody with no recorded
 * relatives is invisible in a family chart and perfectly visible here.
 */
function renderPeople() {
  if (!state.graph || !state.layout) return;
  const list = $('index-list');
  const query = $('search').value.trim().toLowerCase();

  const wanted = (person) => {
    if (state.who === 'living' && person.deceased) return false;
    if (!query) return true;
    return (person.name ?? 'unknown').toLowerCase().includes(query)
      || (person.birthDate ?? '').includes(query);
  };

  list.replaceChildren();
  let shown = 0;

  for (const group of state.layout.groups) {
    const members = group.members
      .map((id) => state.graph.people.get(id))
      .filter(Boolean)
      .filter(wanted)
      .sort((a, b) => (a.name ?? '\uffff').localeCompare(b.name ?? '\uffff'));
    if (!members.length) continue;

    const heading = document.createElement('li');
    heading.className = 'index-group';
    heading.textContent = group.kind === 'isolated'
      ? `Not connected to anyone · ${count(group.count, 'person', 'people')}`
      : `A family of ${group.count} · ${count(group.generations, 'generation', 'generations')}`;
    list.append(heading);

    for (const person of members) {
      shown += 1;
      const li = document.createElement('li');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'index-row';
      if (person.id === state.selected) row.setAttribute('aria-current', 'true');

      const left = document.createElement('span');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = displayName(person);
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = lifespan(person) || '\u00a0';
      left.append(who, document.createElement('br'), when);

      const how = document.createElement('span');
      how.className = 'how';
      const groups = relationsOf(state.graph, person.id);
      how.textContent = groups.length
        ? groups.map((g) => count(g.items.length, ...RELATION_WORDS[g.heading])).join(' · ')
        : 'No recorded relatives';

      row.append(left, how);
      row.addEventListener('click', () => select(person.id));
      li.append(row);
      list.append(li);
    }
  }

  const total = state.tree.people.length;
  $('index-note').textContent = shown === total
    ? `${count(total, 'person', 'people')}, sorted by name within each family.`
    : `${shown} of ${count(total, 'person', 'people')} shown.`;
}

/** A tree with nobody in it is where every tree starts, so it gets an invitation, not an error. */
function renderEmptyInvitation() {
  const existing = document.querySelector('.first-person');
  if (state.tree.people.length > 0) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const box = document.createElement('div');
  box.className = 'first-person';
  box.innerHTML = '<p>Nobody in this tree yet.</p>';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn primary';
  button.textContent = 'Add the first person';
  button.addEventListener('click', () => addPerson());
  box.append(button);
  $('stage').append(box);
}

function updateZoom() {
  $('zoom-level').textContent = `${Math.round((chart?.scale ?? 1) * 100)}%`;
}

/* ------------------------------------------------------------------ the person panel */

const GENDERS = [
  ['', 'Not recorded'],
  ['MALE', 'Male'],
  ['FEMALE', 'Female'],
  ['OTHER', 'Other'],
];

/*
 * The headings `relationsOf` groups by, with a singular for each.
 *
 * Lowercasing the heading and printing it beside a number is what produces "1 parents" and, worse,
 * "1 childrens" for anyone who reaches for a naive de-pluraliser. English does not have a rule
 * here, so the words are simply listed.
 */
const RELATION_WORDS = {
  Parents: ['parent', 'parents'],
  Partners: ['partner', 'partners'],
  Siblings: ['sibling', 'siblings'],
  Children: ['child', 'children'],
};

const KINDS = [
  ['parent', 'Parent'],
  ['child', 'Child'],
  ['spouse', 'Partner'],
  ['sibling', 'Sibling'],
];

/** Why the rules said no, in words that name what is being protected. */
const REFUSALS = {
  [Rejection.SELF_REFERENCE]: 'Somebody cannot be their own relative.',
  [Rejection.DUPLICATE]: 'That connection is already recorded.',
  [Rejection.ANCESTOR_CYCLE]:
    'That would make somebody their own ancestor — the line would run in a circle.',
  [Rejection.CONTRADICTS_EXISTING]:
    'These two are already parent and child, so they cannot also be partners or siblings.',
  NO_SUCH_PERSON: 'That person is no longer in the tree.',
  DUPLICATE_ID: 'Somebody with that id is already here.',
};

function renderPanel() {
  const panel = $('panel');
  const id = state.selected;
  if (!id) {
    panel.hidden = true;
    return;
  }
  const person = state.tree.person(id);
  if (!person) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const body = $('panel-body');
  body.replaceChildren();
  body.append(personForm(person), relativesSection(person), dangerRow(person));
}

function field({ label, id, value = '', type = 'text', wide = false, hint = null }) {
  const wrap = document.createElement('div');
  wrap.className = wide ? 'field wide' : 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  lab.htmlFor = id;
  const input = type === 'textarea'
    ? document.createElement('textarea')
    : document.createElement('input');
  if (type !== 'textarea') input.type = 'text';
  input.id = id;
  input.value = value ?? '';
  wrap.append(lab, input);
  if (hint) {
    const note = document.createElement('p');
    note.className = 'field-hint';
    note.textContent = hint;
    wrap.append(note);
  }
  return wrap;
}

function personForm(person) {
  const form = document.createElement('div');
  form.className = 'form-grid';

  form.append(field({
    label: 'Name', id: 'f-name', value: person.name ?? '', wide: true,
  }));

  const gender = document.createElement('div');
  gender.className = 'field';
  const gl = document.createElement('label');
  gl.textContent = 'Gender';
  gl.htmlFor = 'f-gender';
  const select = document.createElement('select');
  select.id = 'f-gender';
  for (const [value, text] of GENDERS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    if ((person.gender ?? '') === value) option.selected = true;
    select.append(option);
  }
  gender.append(gl, select);
  form.append(gender);

  form.append(field({
    label: 'Born', id: 'f-birth', value: person.birthDate ?? '', hint: 'A year alone is fine',
  }));
  form.append(field({ label: 'Died', id: 'f-death', value: person.deathDate ?? '' }));

  const check = document.createElement('label');
  check.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'f-deceased';
  box.checked = Boolean(person.deceased);
  check.append(box, document.createTextNode('No longer living'));
  form.append(check);

  form.append(field({
    label: 'Notes', id: 'f-notes', value: person.notes ?? '', type: 'textarea', wide: true,
  }));

  /*
   * Committed on `change`, never on `input`.
   *
   * `input` fires per keystroke, which would put eleven undo steps behind a name like
   * "Shyam Sundar" and make undo useless at the moment somebody actually needs it.
   */
  form.addEventListener('change', () => {
    const result = state.tree.updatePerson(person.id, {
      name: $('f-name').value,
      gender: $('f-gender').value || null,
      birthDate: $('f-birth').value,
      deathDate: $('f-death').value,
      deceased: $('f-deceased').checked,
      notes: $('f-notes').value,
    });
    if (!result.ok) { toast(REFUSALS[result.reason] ?? 'That change was not made.', 'bad'); return; }
    rebuild();
  });

  return form;
}

/*
 * Everybody this person is connected to, grouped as the app groups them.
 *
 * `relationsOf` returns `[{heading, items}]` with each item already carrying the word the app
 * would use -- Father, Wife, Younger brother -- so the naming stays in one place rather than
 * being invented again here. Siblings in that list may be *derived* from shared parents rather
 * than recorded, which is why disconnecting handles the no-edge case explicitly.
 */
function relativesSection(person) {
  const box = document.createElement('div');
  const groups = relationsOf(state.graph, person.id);

  const heading = document.createElement('div');
  heading.className = 'rel-heading';
  const h3 = document.createElement('h3');
  h3.textContent = 'Family';
  heading.append(h3);
  box.append(heading);

  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'rel-empty';
    empty.textContent = 'Nobody connected yet.';
    box.append(empty);
  }

  for (const group of groups) {
    const list = document.createElement('ul');
    list.className = 'rel-list';
    for (const item of group.items) {
      const other = state.tree.person(item.id);
      if (!other) continue;

      const li = document.createElement('li');

      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'rel-go';
      go.textContent = displayName(other);
      go.addEventListener('click', () => select(item.id));

      const role = document.createElement('span');
      role.className = 'rel-role';
      role.textContent = item.label;

      const cut = document.createElement('button');
      cut.type = 'button';
      cut.className = 'rel-cut';
      cut.textContent = '\u00d7';
      /*
       * Disconnecting is not deleting, and the wording has to keep the two apart: this removes a
       * relationship and leaves both people exactly where they were.
       */
      cut.title = `Disconnect ${displayName(other)}`;
      cut.setAttribute('aria-label', cut.title);
      cut.addEventListener('click', () => disconnect(person.id, item.id));

      li.append(go, role, cut);
      list.append(li);
    }
    if (list.childElementCount) box.append(list);
  }

  box.append(addRelativeForm(person));
  return box;
}

function addRelativeForm(person) {
  const box = document.createElement('div');
  box.className = 'add-rel';

  const kinds = document.createElement('div');
  kinds.className = 'kinds';
  for (const [kind, label] of KINDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(state.adding === kind));
    button.addEventListener('click', () => {
      state.adding = state.adding === kind ? null : kind;
      renderPanel();
      if (state.adding) $('add-name')?.focus();
    });
    kinds.append(button);
  }
  box.append(kinds);

  if (!state.adding) return box;

  const name = field({
    label: `Name of the ${KINDS.find(([k]) => k === state.adding)[1].toLowerCase()}`,
    id: 'add-name',
    wide: true,
  });
  box.append(name);

  const input = name.querySelector('input');
  const results = document.createElement('ul');
  results.className = 'search-results';
  results.hidden = true;
  box.append(results);

  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn primary';
  create.textContent = 'Add as a new person';
  create.addEventListener('click', () => addRelative(person.id, state.adding, input.value.trim()));
  box.append(create);

  /*
   * Somebody who is already in the tree should be connected, not duplicated.
   *
   * So typing offers the people already recorded before it offers to make another one. This is the
   * cheapest place to prevent the commonest way a family tree goes wrong.
   */
  input.addEventListener('input', () => {
    const term = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (term.length < 2) { results.hidden = true; return; }
    const found = state.tree.people
      .filter((p) => p.id !== person.id && (p.name ?? '').toLowerCase().includes(term))
      .slice(0, 6);
    if (!found.length) { results.hidden = true; return; }
    for (const candidate of found) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<span>${escapeHtml(displayName(candidate))}</span>`
        + `<small>${escapeHtml(lifespan(candidate) || 'already in this tree')}</small>`;
      button.addEventListener('click', () => connect(person.id, state.adding, candidate.id));
      li.append(button);
      results.append(li);
    }
    results.hidden = false;
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); create.click(); }
  });

  return box;
}

function dangerRow(person) {
  const row = document.createElement('div');
  row.className = 'danger-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-danger';
  button.textContent = 'Delete this person';
  button.addEventListener('click', () => removePerson(person.id));
  row.append(button);
  return row;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ editing */

function select(id) {
  state.selected = id;
  state.adding = null;
  chart.selected = id;
  chart.invalidate();
  renderPanel();
  // The list marks who is being edited, so it has to hear about a selection made on the chart.
  if (state.view === 'index') renderPeople();
}

function addPerson() {
  const result = state.tree.addPerson({ name: '' });
  if (!result.ok) { toast(REFUSALS[result.reason] ?? 'Could not add anybody.', 'bad'); return; }
  state.selected = result.id;
  state.adding = null;
  rebuild({ refit: state.tree.people.length <= 1 });
  $('f-name')?.focus();
}

/** The four kinds, as the graph actually records them. */
function edgeFor(kind, subject, other) {
  if (kind === 'parent') return { from: other, to: subject, type: PARENT };
  if (kind === 'child') return { from: subject, to: other, type: PARENT };
  if (kind === 'spouse') return { from: subject, to: other, type: SPOUSE };
  return { from: subject, to: other, type: SIBLING };
}

function connect(subjectId, kind, otherId) {
  const result = state.tree.addRelationship(edgeFor(kind, subjectId, otherId));
  if (!result.ok) {
    toast(REFUSALS[result.reason] ?? 'That connection was not made.', 'bad');
    return;
  }
  state.adding = null;
  rebuild();
}

function addRelative(subjectId, kind, name) {
  const added = state.tree.addPerson({ name });
  if (!added.ok) { toast(REFUSALS[added.reason] ?? 'Could not add anybody.', 'bad'); return; }

  const result = state.tree.addRelationship(edgeFor(kind, subjectId, added.id));
  if (!result.ok) {
    /*
     * The person was added and the connection refused, which would leave a stranger floating in
     * the tree that nobody asked for. Undo takes back the whole step, so what the reader sees is
     * simply that nothing happened, and why.
     */
    state.tree.undo();
    toast(REFUSALS[result.reason] ?? 'That connection was not made.', 'bad');
    rebuild();
    return;
  }
  state.adding = null;
  rebuild();
}

function disconnect(subjectId, otherId) {
  const edge = state.tree.relationships.find((r) => (
    (r.from === subjectId && r.to === otherId) || (r.from === otherId && r.to === subjectId)));
  if (!edge) {
    /*
     * Siblings are usually *derived* from shared parents rather than recorded, so there is often
     * no edge between two people the panel lists as siblings. Removing their parents is the real
     * answer, and saying so beats a button that silently does nothing.
     */
    toast('These two are connected through their parents, not directly. '
      + 'Change a parent to separate them.', 'bad');
    return;
  }
  const result = state.tree.removeRelationship(edge.id);
  if (!result.ok) { toast('That connection was not removed.', 'bad'); return; }
  rebuild();
}

function removePerson(id) {
  const person = state.tree.person(id);
  const name = displayName(person ?? {});
  const result = state.tree.removePerson(id);
  if (!result.ok) { toast(REFUSALS[result.reason] ?? 'Nobody was deleted.', 'bad'); return; }
  state.selected = null;
  rebuild();
  toast(result.removedEdges
    ? `Deleted ${name} and ${count(result.removedEdges, 'connection', 'connections')}. `
      + 'Undo with Ctrl+Z.'
    : `Deleted ${name}. Undo with Ctrl+Z.`);
}

function undo() {
  const result = state.tree?.undo();
  if (!result?.ok) return;
  rebuild();
  toast(`Undid: ${result.label}`);
}

function redo() {
  const result = state.tree?.redo();
  if (!result?.ok) return;
  rebuild();
  toast(`Redid: ${result.label}`);
}

/* ------------------------------------------------------------------ files */

function startNewTree() {
  state.tree = new Tree({}, { ownTreeId: state.ownTreeId });
  state.photos = new Map();
  state.path = null;
  state.name = 'Untitled tree';
  state.selected = null;
  $('file-name').textContent = state.name;
  setState('loaded');
  chart.resize();
  rebuild({ refit: true });
  addPerson();
}

async function openBytes(bytes, name, filePath) {
  $('busy').hidden = false;
  try {
    const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const archive = await openArchive(buffer);
    if (!archive.has('tree.json')) {
      throw new ArchiveError('That ZIP has no tree.json, so it is not a .ftree export.');
    }
    const doc = parseDocument(await archive.readText('tree.json'));

    // Held in memory because saving rewrites the whole archive; there is no file to re-read from.
    const photos = new Map();
    for (const entry of archive.names()) {
      if (entry.startsWith('photos/') && !entry.endsWith('/')) {
        photos.set(entry, await archive.read(entry));
      }
    }

    state.tree = new Tree(doc, { ownTreeId: state.ownTreeId });
    state.tree.markSaved();
    state.photos = photos;
    state.path = filePath ?? null;
    state.name = name;
    state.selected = null;
    $('file-name').textContent = name;
    setState('loaded');
    chart.resize();
    rebuild({ refit: true });
  } catch (error) {
    const message = error instanceof ArchiveError ? error.message : `That file could not be read. ${error.message}`;
    const box = $('opener-error');
    box.textContent = message;
    box.hidden = false;
    toast(message, 'bad');
  } finally {
    $('busy').hidden = true;
  }
}

/**
 * Only the photos somebody is still referenced by.
 *
 * A deleted person's photograph would otherwise ride along in every future save, growing the file
 * with pictures of nobody.
 */
function photosStillUsed() {
  const wanted = new Set(state.tree.people.map((p) => p.photo).filter(Boolean));
  const kept = new Map();
  for (const [name, bytes] of state.photos) if (wanted.has(name)) kept.set(name, bytes);
  return kept;
}

async function save({ as = false } = {}) {
  if (!state.tree || state.saving) return;
  state.saving = true;
  try {
    let made;
    try {
      made = await bytesForTree(state.tree, photosStillUsed());
    } catch (error) {
      if (error instanceof SaveRefused) {
        toast(`${error.message}\n\n${error.detail}`, 'bad');
        return;
      }
      throw error;
    }

    const suggested = state.name?.endsWith('.ftree') ? state.name : `${state.name || 'family-tree'}.ftree`;
    const result = (as || !state.path)
      ? await shell.saveTreeAs(made.bytes, suggested)
      : await shell.saveTree(made.bytes, state.path);

    if (!result?.ok) {
      if (result?.reason !== 'CANCELLED') toast('That tree was not saved.', 'bad');
      return;
    }

    state.path = result.path;
    state.name = result.name;
    $('file-name').textContent = result.name;
    state.tree.markSaved();
    reflectDirty();
    toast(`Saved ${count(made.people, 'person', 'people')} and `
      + `${count(made.relationships, 'connection', 'connections')}.`);
  } finally {
    state.saving = false;
  }
}

/* ------------------------------------------------------------------ wiring */

function wireChrome() {
  $('start-new').addEventListener('click', startNewTree);
  $('choose').addEventListener('click', () => shell?.chooseTree());
  $('add-person').addEventListener('click', addPerson);
  $('save').addEventListener('click', () => save());
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('panel-close').addEventListener('click', () => select(null));

  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }
  for (const button of document.querySelectorAll('[data-who]')) {
    button.addEventListener('click', () => {
      state.who = button.dataset.who;
      for (const other of document.querySelectorAll('[data-who]')) {
        other.setAttribute('aria-pressed', String(other.dataset.who === state.who));
      }
      renderPeople();
    });
  }

  $('zoom-in').addEventListener('click', () => { chart.zoomBy(1.25); updateZoom(); });
  $('zoom-out').addEventListener('click', () => { chart.zoomBy(0.8); updateZoom(); });
  $('fit').addEventListener('click', () => { chart.fit(); updateZoom(); });

  $('theme-btn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    chart.setTheme(next);
    try { localStorage.setItem('ftree.desktop', JSON.stringify({ theme: next })); } catch { /* fine */ }
  });

  const search = $('search');
  const results = $('search-results');
  search.addEventListener('input', () => {
    // In the list the search filters in place; a dropdown over a filtered list would be two
    // answers to one question.
    if (state.view === 'index') { results.hidden = true; renderPeople(); return; }
    const term = search.value.trim().toLowerCase();
    results.replaceChildren();
    if (!state.tree || term.length < 2) { results.hidden = true; return; }
    const found = state.tree.people
      .filter((p) => (p.name ?? '').toLowerCase().includes(term)).slice(0, 8);
    for (const person of found) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<span>${escapeHtml(displayName(person))}</span>`
        + `<small>${escapeHtml(lifespan(person) || '')}</small>`;
      button.addEventListener('click', () => {
        select(person.id);
        chart.centreOn(person.id);
        search.value = '';
        results.hidden = true;
      });
      li.append(button);
      results.append(li);
    }
    results.hidden = !found.length;
  });
}

function wireShell() {
  if (!shell) return;

  shell.onOpenTree((tree) => openBytes(tree.bytes, tree.name, tree.path));

  shell.onMenuCommand((command) => {
    if (command === 'file:new') { startNewTree(); return; }
    if (command === 'file:save') { save(); return; }
    if (command === 'file:saveAs') { save({ as: true }); return; }
    if (command === 'edit:undo') { undo(); return; }
    if (command === 'edit:redo') { redo(); return; }
    if (command === 'zoom:in') { chart.zoomBy(1.25); updateZoom(); return; }
    if (command === 'zoom:out') { chart.zoomBy(0.8); updateZoom(); return; }
    if (command === 'zoom:fit') { chart.fit(); updateZoom(); return; }
    if (command === 'view:chart') { setView('chart'); return; }
    if (command === 'view:index') { setView('index'); return; }
    if (command === 'search') { $('search').focus(); return; }
    if (command === 'theme') { $('theme-btn').click(); return; }
    if (command === 'close') {
      state.tree = null;
      state.selected = null;
      setState('empty');
      shell.setDirty(false);
    }
  });
}

function wireKeys() {
  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (event.key === 'Escape') {
      if (state.adding) { state.adding = null; renderPanel(); return; }
      if (state.selected) select(null);
      return;
    }
    if (typing) return;
    if (event.key === '/') { event.preventDefault(); $('search').focus(); }
    if (event.key === 'i' || event.key === 'I') {
      setView(state.view === 'index' ? 'chart' : 'index');
    }
    if (event.key === 'f' || event.key === 'F') { chart.fit(); updateZoom(); }
  });
}

async function boot() {
  chart = new Chart($('canvas'), {
    onSelect: (id) => select(id),
    onViewChange: updateZoom,
  });
  chart.setTheme(document.documentElement.getAttribute('data-theme') ?? 'light');

  wireChrome();
  wireShell();
  wireKeys();

  if (shell) {
    document.body.dataset.shell = 'desktop';
    /*
     * Fetched before anything can be created. A tree written without it claims the empty origin,
     * which every other desktop also claims -- see desktop/identity.js.
     */
    state.ownTreeId = await shell.installationId();

    const last = await shell.lastTree();
    if (last) await openBytes(last.bytes, last.name, last.path);
  }
}

boot();
