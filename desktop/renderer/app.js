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
import { compactFamily } from '../../site/playground/compact.js';
import { relate, peopleToDraw, restrictedGraph } from '../../site/playground/model.js';
import { searchPeople } from '../../site/playground/search.js';
import { mostConnected } from '../../site/playground/focus.js';

import { Tree, RelationshipType, Rejection } from './document.js';
import { bytesForTree, SaveRefused } from './save.js';
import { planImport, applyImport, ImportRefused } from './import.js';
import { MatchTier } from './matching.js';
import { renderBands } from './bands.js';
import { sentenceFor, unrelatedWording, paintSentence, nameNode } from './relation.js';

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
  /** 'chart', 'compact' or 'index'. */
  view: 'chart',
  /**
   * The person the compact view is centred on, and how far it reaches from them.
   *
   * Kept apart from `selected` because they answer different questions: `selected` is "who am I
   * editing", which the chart and the panel share, and this is "whose family am I reading". Walking
   * outwards through a family should not silently change what the panel is about.
   */
  focus: null,
  generationsUp: 3,
  generationsDown: 3,
  /** The two people the relation finder is comparing, and whether the chart is cut down to them. */
  relateA: null,
  relateB: null,
  trace: null,
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
  const linger = { bad: 9000, warn: 9000 }[tone] ?? 2600;
  toastTimer = setTimeout(() => { box.hidden = true; }, linger);
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

  /*
   * An edit can change the answer, so an open question is asked again.
   *
   * `chart.load` above has already put the whole tree back, so the trace this is holding is gone
   * from the screen whatever happens -- dropping it first is what stops `clearTrace` reloading a
   * chart that is already correct, and what stops the trace surviving as a lie about what is drawn.
   */
  state.trace = null;
  if (!$('relate').hidden) renderRelation();
}

/**
 * What the chart asks for when it wants a photograph.
 *
 * The chart expects something archive-shaped. Photos live in memory here because the file is
 * rewritten on save, so this hands them over from the map rather than re-reading a ZIP.
 */
/**
 * The photographs the chart is allowed to draw.
 *
 * When the setting is off the chart is handed an archive with nothing in it, rather than the real
 * one and an instruction to ignore it. That is how Android does it and it is the safer shape: "the
 * reader turned photographs off" becomes a fact the drawing code *cannot* forget, instead of a flag
 * it has to remember to check in every place it draws a card.
 */
function archiveShim() {
  if (prefs && prefs.photosOnChart === false) {
    return { has: () => false, read: async () => undefined };
  }
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
  $('compact').hidden = view !== 'compact';
  if (view === 'chart') chart.resize();
  else if (view === 'compact') renderCompact();
  else renderPeople();
}

/* ------------------------------------------------------------------ preferences */

/**
 * What the reader has chosen, as this page last heard it.
 *
 * The main process owns the file and the rules; this is a copy to draw with. Every write goes back
 * through `setSetting`, and what comes back is what the settings *became* -- which is not always
 * what was asked for, because the cross-setting rules can change more than the one key, and because
 * turning betas on asks a question that can be answered no.
 */
let prefs = null;

function paintPrefs() {
  if (!prefs) return;
  $('pref-words').value = prefs.familyWords;
  $('pref-photos').checked = prefs.photosOnChart;
  $('pref-theme').value = prefs.theme;
  $('pref-updates').checked = prefs.checkForUpdates;
  $('pref-beta').checked = prefs.betaReleases;

  /*
   * Betas are unavailable while checking is off, rather than merely useless.
   *
   * They are separate settings answering different questions -- whether the app may ask GitHub
   * anything, and which answer it will accept -- so betas with checking off does nothing at all. A
   * live checkbox that does nothing is a worse explanation than a greyed one next to a line saying
   * no request is made.
   */
  $('pref-beta').disabled = !prefs.checkForUpdates;

  // Inert until the Hindi vocabulary lands (#124). Said plainly rather than hidden: a setting that
  // is present and does nothing is worse than one that admits it is not ready.
  $('pref-words-note').textContent = prefs.familyWords === 'hi'
    ? 'Hindi kinship words are not built yet — the relation finder still answers in English.'
    : 'The words the relation finder uses.';

  $('pref-updates-note').textContent = prefs.checkForUpdates
    ? `Last looked ${whenChecked(prefs.lastCheckedAt)}.`
    : 'Off. The app makes no network request of any kind until this is on.';
}

/** When the updater last got an answer, in words rather than as a timestamp. */
function whenChecked(at) {
  if (!at) return 'never';
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}

/** Puts a changed setting into effect on this page. */
function applyPrefs({ redraw = false } = {}) {
  if (!prefs) return;
  document.documentElement.setAttribute('data-theme', prefs.theme);
  chart?.setTheme(prefs.theme);

  // The pre-paint cache, refreshed from the truth. See the note on the inline script in
  // index.html: nothing can be asked of the settings file before the first paint.
  try {
    localStorage.setItem('ftree.desktop', JSON.stringify({ theme: prefs.theme }));
  } catch { /* blocked storage costs one launch in the system's colours, not the setting */ }

  if (redraw && state.graph) rebuild();
}

async function setPref(key, value) {
  if (!shell?.setSetting) return;
  const before = prefs;
  prefs = await shell.setSetting(key, value);
  // Photographs change what the chart is given, so that one needs a rebuild; the rest do not.
  applyPrefs({ redraw: before?.photosOnChart !== prefs.photosOnChart });
  paintPrefs();
}

function openPrefs() {
  paintPrefs();
  $('prefs').showModal();
  $('prefs-head').focus();
}

function wirePrefs() {
  const dialog = $('prefs');
  if (!dialog) return;

  $('prefs-done').addEventListener('click', () => dialog.close());
  $('pref-words').addEventListener('change', (e) => setPref('familyWords', e.target.value));
  $('pref-theme').addEventListener('change', (e) => setPref('theme', e.target.value));
  $('pref-photos').addEventListener('change', (e) => setPref('photosOnChart', e.target.checked));
  $('pref-updates').addEventListener('change', (e) => setPref('checkForUpdates', e.target.checked));
  // The answer to this one can be no -- the main process asks first -- so the checkbox is repainted
  // from what came back rather than left showing what was clicked.
  $('pref-beta').addEventListener('change', (e) => setPref('betaReleases', e.target.checked));
}

/* ------------------------------------------------------------------ how two people are related */

/*
 * Reached from the menu and the keyboard, and deliberately not from the bar.
 *
 * The website has a "Relate" button because a browser tab has nowhere else to put it. This bar
 * already carries what the website's does *and* the editing tools, and it is full: measured on a
 * 1095px window, adding one 26px icon took the header from 56px to 93px, because the row wraps.
 * The desktop has the affordance a tab does not -- View > How are two people related?, on Ctrl+R --
 * so the question is asked there, and the bar keeps the width it was designed for.
 */

/**
 * Cuts the chart down to the line joining two people, and back again.
 *
 * `peopleToDraw` decides who has to be on the page for the answer to be drawable at all -- a
 * sibling step carries no edge of its own, so two siblings would otherwise arrive as two loose
 * cards with nothing between them, which is precisely the question the reader asked.
 */
function drawTrace(ids) {
  state.trace = ids;
  const cut = restrictedGraph(state.graph, ids);
  chart.load(cut, layoutArchive(cut, { orientation: 'rows' }), archiveShim());
  chart.fit();
  updateZoom();
}

function clearTrace() {
  if (!state.trace) return;
  state.trace = null;
  chart.load(state.graph, state.layout, archiveShim());
  chart.fit();
  updateZoom();
}

/**
 * Ends the question, because it was about a tree that is no longer open.
 *
 * Two ids from the previous file would either name nobody or -- worse, since ids are stable across
 * a save -- name two people in the new one, and answer confidently about a family nobody asked
 * about.
 */
function forgetRelate() {
  state.relateA = null;
  state.relateB = null;
  state.trace = null;
  const panel = $('relate');
  if (panel) {
    panel.hidden = true;
    $('relate-a').value = '';
    $('relate-b').value = '';
    $('relate-answer').replaceChildren();
  }
}

function openRelate(seed = state.selected) {
  // One question at a time. Both panels are positioned in the same corner, and two open at once
  // would be two things claiming to be what the window is about.
  if (state.selected) select(null);

  $('relate').hidden = false;

  // Seeded from whoever was selected, because "how is this person related to..." is the question
  // somebody has in mind when they reach for this while looking at a person.
  if (seed && state.graph?.people.has(seed) && !state.relateA) {
    state.relateA = seed;
    $('relate-a').value = displayName(state.graph.people.get(seed));
  }
  renderRelation();
  $(state.relateA ? 'relate-b' : 'relate-a').focus();
}

function closeRelate() {
  $('relate').hidden = true;
  // The whole tree comes back. Leaving the chart cut down after the question is closed would strand
  // somebody on a three-person chart with no obvious way out.
  clearTrace();
}

/** One row of the chain: the step's label, and the person it reaches. */
function chainRow(step) {
  const li = document.createElement('li');

  const label = document.createElement('span');
  label.className = 'step';
  label.textContent = step.label;

  const who = document.createElement('span');
  who.className = 'who';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link-btn';
  button.append(nameNode(state.graph.people.get(step.id)));
  button.addEventListener('click', () => {
    chart.centreOn(step.id);
    chart.selected = step.id;
    chart.invalidate();
  });
  who.append(button);

  li.append(label, who);
  return li;
}

function renderRelation() {
  const box = $('relate-answer');
  box.replaceChildren();

  // Somebody chosen here can be deleted while the question is open. Forget them rather than
  // answering about a person the file no longer has.
  for (const [slot, key] of [['a', 'relateA'], ['b', 'relateB']]) {
    if (state[key] && !state.graph?.people.has(state[key])) {
      state[key] = null;
      $(`relate-${slot}`).value = '';
    }
  }

  const { relateA: a, relateB: b } = state;

  /*
   * The instructions stand down once they have been followed.
   *
   * Three lines explaining what the panel is for are worth having on an empty panel and worth
   * nothing on an answered one, where they push the chain of people below the fold -- and the
   * chain is the part that explains an answer no single word covers, which is what those three
   * lines promised.
   */
  $('relate').dataset.answered = String(Boolean(a && b));

  if (!a || !b || !state.graph) { clearTrace(); return; }

  const from = state.graph.people.get(a);
  const to = state.graph.people.get(b);
  const result = relate(state.graph, a, b);

  const note = document.createElement('p');
  note.className = 'r-term';

  if (result.kind === 'same') {
    note.classList.add('r-none');
    note.textContent = 'Those are the same person.';
    box.append(note);
    clearTrace();
    return;
  }

  if (result.kind === 'none' || !result.path) {
    note.classList.add('r-none');
    paintSentence(note, unrelatedWording(from, to));
    box.append(note);
    clearTrace();
    return;
  }

  const parts = sentenceFor(result, from, to);
  if (parts) {
    paintSentence(note, parts);
    box.append(note);
  }

  const chain = document.createElement('ol');
  chain.className = 'r-chain';

  const start = document.createElement('li');
  const startLabel = document.createElement('span');
  startLabel.className = 'step';
  startLabel.textContent = 'start';
  const startWho = document.createElement('span');
  startWho.className = 'who';
  startWho.append(nameNode(from));
  start.append(startLabel, startWho);
  chain.append(start);

  for (const step of result.path) chain.append(chainRow(step));
  box.append(chain);

  // The chart shows this line and nothing else.
  drawTrace(peopleToDraw(state.graph, a, result.path));
}

/** The two pickers, each its own little search over the same shared function. */
function wireRelate() {
  for (const slot of ['a', 'b']) {
    const input = $(`relate-${slot}`);
    const list = $(`relate-${slot}-results`);

    input.addEventListener('input', () => {
      list.replaceChildren();
      if (!input.value.trim() || !state.graph) { list.hidden = true; return; }

      const found = searchPeople(state.graph, input.value, 8);
      if (!found.length) {
        const none = document.createElement('li');
        none.className = 'row-none';
        none.textContent = 'Nobody by that name in this file.';
        list.append(none);
        list.hidden = false;
        return;
      }

      for (const person of found) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.append(nameNode(person));
        const dates = document.createElement('span');
        dates.className = 'row-dates';
        dates.textContent = lifespan(person) || '';
        button.append(dates);
        button.addEventListener('click', () => {
          state[slot === 'a' ? 'relateA' : 'relateB'] = person.id;
          input.value = displayName(person);
          list.hidden = true;
          renderRelation();
        });
        li.append(button);
        list.append(li);
      }
      list.hidden = false;
    });

    input.addEventListener('focus', () => input.select());
  }

  $('relate-close').addEventListener('click', closeRelate);
}

/* ------------------------------------------------------------------ generations, as bands */

/**
 * The compact view, centred on somebody.
 *
 * Needs a focus person, which the phone never has to work out: you arrive at its focused chart
 * *from* a person. This app can open a file with nothing selected, so the order is the selected
 * person, then whoever the view was last centred on, then the most-connected person -- never the
 * first row of the file, which is export order and means nothing to a reader.
 */
function renderCompact() {
  if (!state.graph) return;

  let focusId = state.focus;
  if (!focusId || !state.graph.people.has(focusId)) {
    focusId = state.selected && state.graph.people.has(state.selected)
      ? state.selected
      : mostConnected(state.graph);
    state.focus = focusId;
  }

  const family = compactFamily(state.graph, focusId, {
    up: state.generationsUp,
    down: state.generationsDown,
  });

  renderBands($('compact-inner'), family, {
    generations: reachWords(),
    onFocus: (id) => {
      state.focus = id;
      // A walk outwards resets the reach: the reader asked to see this person's family, not to
      // carry somebody else's "show more" over onto them.
      state.generationsUp = 3;
      state.generationsDown = 3;
      renderCompact();
      $('compact').scrollTop = 0;
    },
    onEdit: (id) => select(id),
    onMore: () => {
      state.generationsUp += 2;
      state.generationsDown += 2;
      renderCompact();
    },
  });
}

/** How far the reading currently reaches, for the line that offers to extend it. */
function reachWords() {
  return `${state.generationsUp} generations`;
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
  forgetRelate();
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
    forgetRelate();
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

/* ------------------------------------------------------------------ importing */

/**
 * Merging somebody else's file into this tree.
 *
 * Nothing is decided here. The file is read, the matcher works out what it would mean, and the
 * review dialog asks -- because a strong match merges unless it is refused, and a merge is the one
 * act in this app that cannot be put right by hand afterwards.
 */
async function importTree() {
  if (!shell) return;

  // With nothing open there is no tree to import into, and opening the file is plainly what was
  // meant. Refusing on a technicality would be correct and useless.
  if (!state.tree) { await shell.chooseTree(); return; }

  const chosen = await shell.chooseImportTree();
  if (!chosen) return;

  $('busy').hidden = false;
  try {
    const buffer = chosen.bytes instanceof ArrayBuffer ? chosen.bytes : chosen.bytes.buffer;
    const archive = await openArchive(buffer);
    if (!archive.has('tree.json')) {
      throw new ArchiveError('That ZIP has no tree.json, so it is not a .ftree export.');
    }
    const doc = parseDocument(await archive.readText('tree.json'));

    const importedPhotos = new Map();
    for (const entry of archive.names()) {
      if (entry.startsWith('photos/') && !entry.endsWith('/')) {
        importedPhotos.set(entry, await archive.read(entry));
      }
    }

    openReview(planImport({ document: doc, tree: state.tree, ownTreeId: state.ownTreeId }),
      chosen.name, importedPhotos);
  } catch (error) {
    const known = error instanceof ArchiveError || error instanceof ImportRefused;
    toast(known ? error.message : `That file could not be read. ${error.message}`, 'bad');
  } finally {
    $('busy').hidden = true;
  }
}

const RELATIVE_LIST = (names) => {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

/** The case for a proposed match, in words somebody can agree or disagree with. */
function whyMatched(match) {
  const parts = ['The name is the same'];
  if (match.evidence.datesAgree) parts.push('the dates fit');
  if (match.shared.length) {
    parts.push(`you both have ${RELATIVE_LIST(match.shared.slice(0, 3))}`
      + (match.shared.length > 3 ? ` and ${match.shared.length - 3} more` : ''));
  }
  const sentence = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
  return match.shared.length
    ? `${sentence}.`
    : `${sentence} — but nothing else here says they are the same person.`;
}

const FIELDS = [['birthDate', 'Born'], ['deathDate', 'Died'], ['notes', 'Notes']];

function sideOf(heading, person, other, fields) {
  if (!fields.length) {
    return `<div class="side"><p class="side-of">${heading}</p>`
      + '<p class="side-bare">Only a name recorded.</p></div>';
  }
  const rows = fields.map(([key, label]) => {
    const mine = person?.[key];
    const theirs = other?.[key];
    if (!mine) return `<dt>${label}</dt><dd class="empty">not recorded</dd>`;
    // Marked where the two disagree: a merge keeps what is already here, so this is also the only
    // place somebody is told which of theirs is about to be set aside.
    const differs = theirs && String(theirs) !== String(mine) ? 'differs' : '';
    return `<dt>${label}</dt><dd class="${differs}">${escapeHtml(String(mine))}</dd>`;
  }).join('');
  return `<div class="side"><p class="side-of">${heading}</p><dl>${rows}</dl></div>`;
}

function pairCard(match) {
  const name = escapeHtml(match.theirs?.name ?? 'Someone unnamed');
  const tier = match.tier === MatchTier.STRONG ? 'Likely the same person' : 'Possibly the same person';
  const merging = match.tier === MatchTier.STRONG;
  // A row neither record has says nothing twice, and pushes the evidence below the fold.
  const fields = FIELDS.filter(([key]) => match.theirs?.[key] || match.mine?.[key]);
  return `
    <article class="pair" data-id="${escapeHtml(match.importedId)}" data-tier="${match.tier}">
      <div class="pair-head">
        <h3 class="pair-name">${name}</h3>
        <span class="pair-tier">${tier}</span>
      </div>
      <div class="pair-sides">
        ${sideOf('In their file', match.theirs, match.mine, fields)}
        ${sideOf('In your tree', match.mine, match.theirs, fields)}
      </div>
      <p class="pair-why">${escapeHtml(whyMatched(match))}</p>
      <div class="pair-choice" role="group" aria-label="Is this the same person?">
        <button type="button" data-merge="yes" aria-pressed="${merging}">Same person</button>
        <button type="button" data-merge="no" aria-pressed="${!merging}">Two different people</button>
      </div>
    </article>`;
}

function openReview(plan, fileName, importedPhotos) {
  const decisions = new Map(plan.defaultDecisions);
  const dialog = $('review');
  const total = plan.matches.length;
  const asked = plan.reviewable;

  $('review-title').textContent = fileName;
  $('review-lead').textContent = asked.length
    ? `Their file has ${count(total, 'person', 'people')}. `
      + `${asked.length} of them ${asked.length === 1 ? 'looks' : 'look'} like someone already in `
      + 'your tree, so they are worth a look before anything is joined up.'
    : `Their file has ${count(total, 'person', 'people')}, and none of them need a decision.`;

  const settled = plan.certainMatches
    ? `<p class="review-settled">${count(plan.certainMatches, 'person is', 'people are')} `
      + 'recognised outright — their file records where they came from, and it is somebody you '
      + 'already hold. Those are matched without asking.</p>'
    : '';

  // Strong first: those merge unless refused, so they are the ones worth reading.
  const order = { [MatchTier.STRONG]: 0, [MatchTier.WEAK]: 1 };
  const cards = [...asked]
    .sort((a, b) => order[a.tier] - order[b.tier])
    .map(pairCard).join('');

  $('review-body').innerHTML = settled + cards;

  const outcome = () => {
    const { added, merged } = plan.outcomeUnder(decisions);
    const parts = [];
    if (added) parts.push(`add ${count(added, 'person', 'people')}`);
    if (merged) parts.push(`merge ${count(merged, 'person', 'people')}`);
    const said = parts.length ? parts.join(' and ') : 'change nothing';
    $('review-confirm').textContent = parts.length
      ? said.charAt(0).toUpperCase() + said.slice(1)
      : 'Close';
  };

  $('review-body').onclick = (event) => {
    const button = event.target.closest('button[data-merge]');
    if (!button) return;
    const card = button.closest('.pair');
    const merge = button.dataset.merge === 'yes';
    decisions.set(card.dataset.id, merge);
    for (const other of card.querySelectorAll('button[data-merge]')) {
      other.setAttribute('aria-pressed', String((other.dataset.merge === 'yes') === merge));
    }
    outcome();
  };

  outcome();

  const close = () => { $('review-body').onclick = null; dialog.close(); };
  $('review-cancel').onclick = close;
  $('review-confirm').onclick = () => {
    close();
    commitImport(plan, decisions, importedPhotos, fileName);
  };

  $('review-outcome').textContent =
    'Nothing is written to your file until you save. Undo puts all of it back.';

  dialog.showModal();
  /*
   * A dialog focuses its first focusable child, which here is a button inside the first card --
   * and the browser scrolls it into view, opening the screen already scrolled past the name of
   * the person being asked about. Focus the heading instead, and start at the top.
   */
  $('review-body').scrollTop = 0;
  $('review-head').focus();
}

function commitImport(plan, decisions, importedPhotos, fileName) {
  const result = applyImport({
    tree: state.tree,
    plan,
    decisions,
    photos: state.photos,
    importedPhotos,
    label: `Import ${fileName}`,
  });

  rebuild({ refit: true });
  renderPanel();

  const said = [];
  if (result.peopleAdded) said.push(`Added ${count(result.peopleAdded, 'person', 'people')}`);
  if (result.peopleMerged) said.push(`merged ${count(result.peopleMerged, 'person', 'people')}`);
  if (result.relationshipsAdded) {
    said.push(`added ${count(result.relationshipsAdded, 'connection', 'connections')}`);
  }
  if (!said.length) said.push('Nothing changed — everything in that file was already here');

  // Conflicts are not a failure, but they are the one thing somebody might want to go and look
  // at, so they are said plainly rather than buried in a count.
  const extra = result.conflicts.length
    ? `\n${count(result.conflicts.length, 'detail', 'details')} differed and yours were kept.`
    : '';
  const refused = result.relationshipsRefused.length
    ? `\n${count(result.relationshipsRefused.length, 'connection', 'connections')} could not be `
      + 'added without contradicting your tree.'
    : '';

  toast(`${said.join(', ')}.${extra}${refused}\nUndo puts this back.`,
    result.conflicts.length || result.relationshipsRefused.length ? 'warn' : 'good');
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
    /*
     * Written to the settings file, which is now the only copy that counts.
     *
     * The theme used to live in the page's own storage while every other setting lived in a file
     * the main process owns. Two stores meant the preferences dialog could not show the theme
     * without asking the page. `applyPrefs` keeps the localStorage mirror up to date for the sake
     * of the pre-paint script, and nothing else reads it.
     */
    setPref('theme', next);
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
    if (command === 'file:import') { importTree(); return; }
    if (command === 'file:save') { save(); return; }
    if (command === 'file:saveAs') { save({ as: true }); return; }
    if (command === 'edit:undo') { undo(); return; }
    if (command === 'edit:redo') { redo(); return; }
    if (command === 'zoom:in') { chart.zoomBy(1.25); updateZoom(); return; }
    if (command === 'zoom:out') { chart.zoomBy(0.8); updateZoom(); return; }
    if (command === 'zoom:fit') { chart.fit(); updateZoom(); return; }
    if (command === 'view:chart') { setView('chart'); return; }
    if (command === 'view:compact') { setView('compact'); return; }
    if (command === 'view:relate') { setView('chart'); openRelate(); return; }
    if (command === 'settings:open') { openPrefs(); return; }
    if (command === 'view:index') { setView('index'); return; }
    if (command === 'search') { $('search').focus(); return; }
    if (command === 'theme') { $('theme-btn').click(); return; }
    if (command === 'close') {
      state.tree = null;
      state.selected = null;
      forgetRelate();
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
      // The question closes before the person does: it is the thing most recently opened, and it
      // is the one holding the chart cut down to three people.
      if (!$('relate').hidden) { closeRelate(); return; }
      if (state.selected) select(null);
      return;
    }
    if (typing) return;
    if (event.key === '/') { event.preventDefault(); $('search').focus(); }
    if (event.key === 'i' || event.key === 'I') {
      setView(state.view === 'index' ? 'chart' : 'index');
    }
    if (event.key === 'c' || event.key === 'C') {
      setView(state.view === 'compact' ? 'chart' : 'compact');
    }
    if (event.key === 'r' || event.key === 'R') {
      if ($('relate').hidden) { setView('chart'); openRelate(); } else closeRelate();
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
  wireRelate();
  wirePrefs();
  wireShell();
  wireKeys();

  /*
   * Settings before the first draw.
   *
   * The theme especially: reading it after the chart exists means a window that flashes light and
   * then goes dark on every launch, for everybody who chose dark.
   */
  if (shell?.settings) {
    try {
      prefs = await shell.settings();
      applyPrefs();
    } catch { /* the page already has the defaults on it */ }
  }

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
