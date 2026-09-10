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
 * **One edit is one undo step, and it happens when somebody says so.** The person panel holds its
 * edits as a draft and commits them on Save, as the phone does (#148): one Save is one step, the
 * panel shows whether there is anything unsaved, and leaving with edits asks first. It used to
 * commit on every field's `change`, which meant nothing on screen ever said an edit was taken.
 *
 * **A refusal is an explanation.** The rules say no for reasons a person can understand, so the
 * interface says the reason and not "invalid".
 */

import { openArchive, parseDocument, ArchiveError } from '../../site/playground/archive.js';
import { buildGraph, displayName, lifespan, initials, relationsOf } from '../../site/playground/model.js';
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
import { sentenceFor, unrelatedWording, paintSentence, nameNode, hindiFor } from './relation.js';
import { decode, encode, asImageUrl, freeName, squareCrop } from './photo.js';
import {
  DateProblem, draftFrom, withChange, dateProblems, isDirty, fieldsFrom, isBlankPerson,
  normaliseDateTyping,
} from './person-draft.js';
import { createAutosave, describeWriteFailure } from './autosave.js';
import { relateIcon, prefsIcon } from './icons.js';

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
  /**
   * The person panel's edits, not yet kept: `{ id, values, showProblems }`.
   *
   * Keyed by id and held here rather than read back out of the inputs, because the panel is redrawn
   * whenever anything else changes the tree -- a photograph, a relative added -- and a redraw that
   * rebuilt the form from the tree would throw away a name somebody was halfway through typing.
   */
  draft: null,
  /**
   * Somebody "Add a person" created, not yet confirmed with Add.
   *
   * The card exists from the first click so the chart can show where it will go, but until Add is
   * pressed it is a question rather than a person: backing out takes it away again, and finishing
   * it is one step in the history rather than an addition followed by an edit.
   */
  fresh: null,
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
let toastLinger = 0;

/**
 * Says something once, where the eye already is.
 *
 * `action` puts one button in it -- in practice always Undo. The toolbar's undo button is gone
 * (#150) and a toast that says "Undo with Ctrl+Z" is advertising a shortcut to somebody who has
 * just been surprised; the button is the thing itself, and the shortcut still works. A toast with
 * a button stays a little longer, and holds still while the pointer or focus is on it, so it
 * cannot vanish from under a click.
 */
function toast(message, tone = 'good', { action = null } = {}) {
  const box = $('toast');
  $('toast-text').textContent = message;
  const button = $('toast-action');
  button.hidden = !action;
  button.textContent = action?.label ?? '';
  button.onclick = action ? () => { box.hidden = true; action.run(); } : null;
  box.dataset.tone = tone;
  box.hidden = false;
  // A refusal is longer and worth reading twice; a confirmation is not.
  toastLinger = { bad: 9000, warn: 9000 }[tone] ?? (action ? 6500 : 2600);
  holdToast(false);
}

function holdToast(holding) {
  clearTimeout(toastTimer);
  if (!holding) toastTimer = setTimeout(() => { $('toast').hidden = true; }, toastLinger);
}

/** The Undo button a toast offers after something that can be taken back. */
const UNDO = { label: 'Undo', run: () => undo() };

/** Whether the person panel holds edits the tree does not. */
function draftIsDirty() {
  const draft = state.draft;
  const person = draft && state.tree?.person(draft.id);
  return Boolean(person && isDirty(draft.values, person));
}

/* ------------------------------------------------------------------ autosave */

/*
 * The open tree is written back to its file a moment after every change (#149).
 *
 * Only a tree that has a file. A new one has nowhere to go until somebody picks a place, so it
 * keeps a Save button and the quit prompt until then -- and from its first save on, it is written
 * like any other. See autosave.js for the scheduling and backups.js for the earlier versions kept
 * on the way.
 */
const autosave = createAutosave({
  write: writeToFile,
  onStatus: () => paintSaveState(),
  onFailure: (error) => toast(
    `Couldn’t save ${state.name}: ${describeWriteFailure(error)}. `
      + 'Your changes are still here, and f-tree will keep trying.',
    'bad',
    { action: { label: 'Save as…', run: () => save({ as: true }) } },
  ),
});

/**
 * Writes the open tree to its file, if it has one and anything has changed.
 *
 * The signature is taken before the write and handed to `markSaved` after it, so an edit made while
 * the bytes were on their way is still unsaved afterwards and gets the next write -- see
 * `Tree.markSaved`.
 */
async function writeToFile() {
  const tree = state.tree;
  const target = state.path;
  if (!tree || !target || !tree.isDirty || !shell) return;

  const signature = tree.signature();
  let made;
  try {
    made = await bytesForTree(tree, photosStillUsed());
  } catch (error) {
    if (error instanceof SaveRefused) throw new Error(`${error.message} ${error.detail}`);
    throw error;
  }
  const result = await shell.saveTree(made.bytes, target, { quiet: true });
  if (!result?.ok) {
    throw Object.assign(new Error(result?.reason ?? 'the write did not finish'),
      { code: result?.code ?? null });
  }
  // Another file may have been opened while this one was being written; it is not this one's to mark.
  if (state.tree === tree) {
    tree.markSaved(signature);
    reflectDirty();
  }
}

/** Starts the pause before a write, for a tree with a file and something new in it. */
function scheduleAutosave() {
  if (state.tree?.isDirty && state.path) autosave.changed();
}

/**
 * The bar's word on whether the tree is on disk: the unsaved dot, grown into a sentence.
 *
 * Saving… while a write is pending or under way, Saved when it is done, and the two states that
 * need a hand: a tree that has never had a file, which offers Save…, and a write that failed, which
 * offers Retry. It is not a live region -- it changes on every edit, and a screen reader announcing
 * "Saving… Saved" after each keystroke would be noise. A failure is announced by its toast.
 */
function paintSaveState() {
  const chip = $('save-state');
  if (!chip || !state.tree) return;

  const status = autosave.status;
  const view = !state.path ? 'untitled'
    : status.state === 'error' ? 'error'
    : status.state === 'pending' || status.state === 'saving' || state.tree.isDirty ? 'saving'
    : 'saved';

  chip.dataset.state = view;
  $('save-state-text').textContent = {
    untitled: 'Not saved yet',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Not saved',
  }[view];
  chip.title = view === 'saved' ? `Every change is saved to ${state.path}`
    : view === 'error' ? `Couldn’t save: ${describeWriteFailure(status.error)}`
    : view === 'untitled' ? 'This tree has no file yet. Save it once and changes save themselves.'
    : '';

  const action = $('save-state-action');
  action.hidden = view !== 'untitled' && view !== 'error';
  action.textContent = view === 'untitled' ? 'Save…' : 'Retry';
}

/**
 * Which file is open, in the bar and in the window's own title.
 *
 * The title is the copy that is always there: below 1180px the bar gives the name's width to the
 * tools and keeps only the save state, and the title bar -- which every desktop shows anyway --
 * goes on saying which tree this is.
 */
function showFileName(name) {
  $('file-name').textContent = name ?? '';
  document.title = name ? `${name} — f-tree` : 'f-tree';
}

/** Keeps the window, the menu and the save state in step with whether there is work not on disk. */
function reflectDirty() {
  const dirty = Boolean(state.tree?.isDirty) || draftIsDirty();
  paintSaveState();
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
  // Every photograph drawn last time is handed back before any is drawn again; otherwise a page
  // that redraws on every edit keeps every face it has ever shown alive in memory.
  releasePhotos();

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

  // Every change to the tree comes through here, so this is the one place autosave has to hear it.
  scheduleAutosave();
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
    : `${count(people, 'person', 'people')} · `
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

/* ------------------------------------------------------------------ photographs */

/**
 * Object URLs handed out for showing stored bytes, so they can be handed back.
 *
 * A page that makes one of these per render and never revokes them keeps every photograph it has
 * ever drawn alive in memory, which on a tree of any size is the difference between an app and a
 * leak.
 */
const shownPhotos = new Set();

function photoUrl(name) {
  const bytes = state.photos.get(name);
  if (!bytes) return null;
  const url = asImageUrl(bytes);
  shownPhotos.add(url);
  return url;
}

function releasePhotos() {
  for (const url of shownPhotos) URL.revokeObjectURL(url);
  shownPhotos.clear();
}

/** The face in the person panel, and the way to change it. */
function photoField(person) {
  const box = document.createElement('div');
  box.className = 'photo-field';

  const url = person.photo ? photoUrl(person.photo) : null;

  if (url) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'photo-face';
    // Uncropped when opened: every other place shows this inside a circle, and a square cut from a
    // group photograph is often the wrong square.
    button.title = 'See the whole photograph';
    const img = document.createElement('img');
    img.src = url;
    img.alt = `${displayName(person)}`;
    button.append(img);
    button.addEventListener('click', () => openPhotoView(person, url));
    box.append(button);
  } else {
    const empty = document.createElement('div');
    empty.className = 'photo-face empty';
    empty.setAttribute('aria-hidden', 'true');
    empty.textContent = initials(person);
    box.append(empty);
  }

  const actions = document.createElement('div');
  actions.className = 'photo-actions';

  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'btn quiet';
  choose.textContent = person.photo ? 'Replace' : 'Add a photograph';
  choose.addEventListener('click', () => choosePhotoFor(person.id));
  actions.append(choose);

  if (person.photo) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn quiet';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => setPhoto(person.id, null));
    actions.append(remove);
  }

  box.append(actions);
  return box;
}

function openPhotoView(person, url) {
  $('photo-view-img').src = url;
  $('photo-view-img').alt = `Photograph of ${displayName(person)}`;
  $('photo-view-who').textContent = displayName(person);
  $('photo-view').showModal();
}

/**
 * Writes a photograph onto a person, or takes one off.
 *
 * The bytes are stored under a name nothing else is using; the old entry is left to
 * `photosStillUsed` to prune on the next save, because a photograph is only unused once nobody
 * points at it, and that is a question about the whole tree rather than about this edit.
 */
function setPhoto(id, bytes) {
  const person = state.tree.people.find((p) => p.id === id);
  if (!person) return;

  let name = null;
  if (bytes) {
    name = freeName(new Set(state.photos.keys()));
    if (!name) { toast('That photograph could not be stored.', 'bad'); return; }
    state.photos.set(name, bytes);
  }

  // `updatePerson` leaves every field it is not given alone, so naming only `photo` here cannot
  // wipe the dates or the notes this panel is not currently showing.
  const result = state.tree.updatePerson(id, { photo: name });
  if (!result?.ok) {
    toast(REFUSALS[result?.reason] ?? 'That photograph could not be set.', 'bad');
    return;
  }
  rebuild();
  toast(bytes ? 'Photograph added.' : 'Photograph removed.', 'good', { action: UNDO });
}

/** The framing step: pick a file, choose what the circle shows, then store it. */
async function choosePhotoFor(id) {
  if (!shell?.choosePhoto) return;

  const picked = await shell.choosePhoto();
  if (!picked) return;

  const bitmap = await decode(picked.bytes);
  if (!bitmap) { toast('That file is not a picture this app can read.', 'bad'); return; }

  openFrame(bitmap, id, picked.name);
}

/** How far along the long edge the square sits, 0 to 1. Reset for every new picture. */
let framing = { bitmap: null, personId: null, offset: 0.5, url: null };

function paintFrame() {
  const { bitmap, offset } = framing;
  if (!bitmap) return;
  const stage = $('frame-stage');
  const img = $('frame-img');

  // The stage shows a square; the picture slides behind it. Expressed as a percentage so the
  // drawing follows the same fraction the crop will use, at whatever size the dialog happens to be.
  const landscape = bitmap.width >= bitmap.height;
  stage.dataset.orientation = landscape ? 'landscape' : 'portrait';
  img.style.objectPosition = landscape ? `${offset * 100}% 50%` : `50% ${offset * 100}%`;

  const crop = squareCrop(bitmap.width, bitmap.height, offset);
  $('frame-outcome').textContent = crop.size === Math.max(bitmap.width, bitmap.height)
    ? 'Already square — nothing to frame.'
    : `${bitmap.width} × ${bitmap.height}, kept as ${Math.min(crop.size, 512)}px square.`;
}

function openFrame(bitmap, personId, fileName) {
  releaseFraming();
  framing = { bitmap, personId, offset: 0.5, url: asImageUrl(null) };

  const img = $('frame-img');
  img.src = bitmapUrl(bitmap);
  img.alt = fileName ?? '';
  paintFrame();
  $('frame').showModal();
  $('frame-head').focus();
}

/** A drawable URL for the picked image, kept so it can be revoked when the dialog closes. */
function bitmapUrl(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const url = canvas.toDataURL('image/png');
  framing.url = url;
  return url;
}

function releaseFraming() {
  framing.bitmap?.close?.();
  framing = { bitmap: null, personId: null, offset: 0.5, url: null };
}

/*
 * Hooks for the smoke harness, and only for it.
 *
 * The picker is a native dialog that cannot be clicked from a test, so the harness hands bytes
 * straight to the encoder and then needs a way to put the result on somebody and read back what the
 * tree holds. `shell.smoke` comes from the main process's own environment, which a page cannot set,
 * so a build somebody is using never carries any of this.
 */
function exposeTestHooks() {
  if (!shell?.smoke) return;
  window.__setPhotoForTest = (bytes) => setPhoto(state.selected, bytes);
  window.__openFrameForTest = async (bytes) => {
    const bitmap = await decode(bytes);
    if (bitmap) openFrame(bitmap, state.selected, 'a-photograph.png');
    return Boolean(bitmap);
  };
  window.__frameOffsetForTest = () => framing.offset;

  /*
   * Write the tree and read it back, through the real writer and the real reader.
   *
   * The point of authoring a photograph is that it ends up in the file. Everything else here checks
   * the app's own state, which would look perfect while the archive went out empty.
   */
  window.__photoRoundTripForTest = async () => {
    // `bytesForTree` hands back the bytes *and* what it counted, not the bytes alone.
    const { bytes } = await bytesForTree(state.tree, photosStillUsed());
    const archive = await openArchive(bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const doc = parseDocument(await archive.readText('tree.json'));
    const person = doc.people.find((p) => p.id === state.selected);
    const entries = archive.names().filter((n) => n.startsWith('photos/'));
    return {
      named: person?.photo ?? null,
      inArchive: person?.photo ? entries.includes(person.photo) : false,
      count: entries.length,
      size: person?.photo ? (await archive.read(person.photo))?.byteLength ?? 0 : 0,
    };
  };
  window.__photoCountForTest = () => state.photos.size;
  window.__photoUsedForTest = () => photosStillUsed().size;
}

function wirePhotos() {
  const frame = $('frame');
  if (!frame) return;
  exposeTestHooks();

  $('photo-view-close').addEventListener('click', () => $('photo-view').close());
  $('frame-cancel').addEventListener('click', () => frame.close());
  frame.addEventListener('close', releaseFraming);

  $('frame-save').addEventListener('click', async () => {
    const { bitmap, personId, offset } = framing;
    if (!bitmap) { frame.close(); return; }
    const bytes = await encode(bitmap, offset);
    frame.close();
    if (!bytes) { toast('That photograph could not be stored.', 'bad'); return; }
    setPhoto(personId, bytes);
  });

  // Dragging across the stage moves the square along the long edge. Pointer events rather than
  // mouse ones, so a trackpad and a touchscreen both work.
  const stage = $('frame-stage');
  let dragging = null;
  stage.addEventListener('pointerdown', (event) => {
    if (!framing.bitmap) return;
    dragging = { x: event.clientX, y: event.clientY, from: framing.offset };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragging || !framing.bitmap) return;
    const box = stage.getBoundingClientRect();
    const landscape = framing.bitmap.width >= framing.bitmap.height;
    const moved = landscape
      ? (event.clientX - dragging.x) / box.width
      : (event.clientY - dragging.y) / box.height;
    // Dragging right shows what is further right, so the offset moves against the pointer.
    framing.offset = Math.min(1, Math.max(0, dragging.from - moved));
    paintFrame();
  });
  const stop = () => { dragging = null; };
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointercancel', stop);

  // The keyboard reaches it too: a drag is not the only way somebody uses this app.
  stage.tabIndex = 0;
  stage.addEventListener('keydown', (event) => {
    if (!framing.bitmap) return;
    const step = event.shiftKey ? 0.2 : 0.05;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      framing.offset = Math.max(0, framing.offset - step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      framing.offset = Math.min(1, framing.offset + step);
    } else return;
    event.preventDefault();
    paintFrame();
  });
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
  // A change of language is a change to an answer already on screen.
  if (before?.familyWords !== prefs.familyWords && !$('relate').hidden) renderRelation();
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
 * Reached from the bar, from a person, and from the menu and the keyboard.
 *
 * For a while it was deliberately *not* on the bar. That bar carried Undo, Redo and Save as well as
 * the viewer's tools, and measured on a 1095px window, one more 26px icon took the header from 56px
 * to 93px because the row wrapped. #150 took those three off -- autosave made Save redundant and
 * undo keeps Ctrl+Z, the menu and an Undo button in every toast -- which freed far more than one
 * icon's width. Re-measured with the button in, and Preferences beside it: one 56px row at 1440,
 * 1095 and every width down to 880, in both themes (the rules are at the end of editor.css).
 *
 * The bar's button starts a fresh question. The ones on a person (#151) continue from somebody
 * already on screen, which is the commoner form of it: "how is *this* person related to me?"
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
    $('relate-btn')?.setAttribute('aria-pressed', 'false');
    $('relate-a').value = '';
    $('relate-b').value = '';
    $('relate-answer').replaceChildren();
  }
}

/**
 * Opens the question, seeded with `seed` if there is one.
 *
 * The seed is taken as an argument and read *before* anything else happens, because the first thing
 * this does is close the person panel -- which clears the selection. Relying on the selection would
 * seed an empty slot, which is the one trap in starting from a person (#151).
 *
 * `fromPerson` is that case: the person asked about goes in the first slot even if an earlier
 * question left somebody else there, and the second slot is emptied for the reader to fill.
 */
async function openRelate(seed = state.selected, { fromPerson = false } = {}) {
  // One question at a time. Both panels are positioned in the same corner, and two open at once
  // would be two things claiming to be what the window is about. Closing the person panel can be
  // refused -- it asks first if it holds unsaved edits -- and then the question waits.
  if (state.selected && !(await select(null))) return;

  $('relate').hidden = false;
  $('relate-btn')?.setAttribute('aria-pressed', 'true');

  const known = seed && state.graph?.people.has(seed);
  if (known && fromPerson) {
    state.relateA = seed;
    state.relateB = null;
    $('relate-a').value = displayName(state.graph.people.get(seed));
    $('relate-b').value = '';
  } else if (known && !state.relateA) {
    // Seeded from whoever was selected, because "how is this person related to..." is the question
    // somebody has in mind when they reach for this while looking at a person.
    state.relateA = seed;
    $('relate-a').value = displayName(state.graph.people.get(seed));
  }
  renderRelation();
  $(state.relateA ? 'relate-b' : 'relate-a').focus();
}

/** Asks "how are we related?" about one person: they are the first answer, the reader picks the second. */
function relateFrom(id) {
  setView('chart');
  openRelate(id, { fromPerson: true });
}

function closeRelate() {
  $('relate').hidden = true;
  $('relate-btn')?.setAttribute('aria-pressed', 'false');
  // The whole tree comes back. Leaving the chart cut down after the question is closed would strand
  // somebody on a three-person chart with no obvious way out.
  clearTrace();
}

/**
 * `word (gloss)`, and where the record cannot settle a birth order, the nudge that would.
 *
 * The three descriptive terms are correct as they stand -- "पिता के भाई" is what he is -- so this
 * does not apologise for them. It says which two birth years would sharpen the word, because that
 * is a thing the reader can actually go and do, and the alternative was guessing between ताऊ and
 * चाचा and being wrong half the time in a way the family notices immediately.
 */
function hindiLine(hindi) {
  const line = document.createElement('p');
  line.className = 'r-hindi';
  // `lang` so a screen reader reaches for a Hindi voice rather than spelling Devanagari in English.
  line.lang = 'hi';

  const word = document.createElement('b');
  word.className = 'r-hindi-word';
  word.textContent = hindi.word;
  line.append(word);

  const gloss = document.createElement('span');
  gloss.className = 'r-hindi-gloss';
  gloss.lang = 'en';
  gloss.textContent = ` (${hindi.gloss})`;
  line.append(gloss);

  if (hindi.needsBirthYears) {
    const nudge = document.createElement('span');
    nudge.className = 'r-hindi-nudge';
    nudge.lang = 'en';
    nudge.textContent = 'Birth years for both brothers would say whether that is ताऊ or चाचा.';
    line.append(nudge);
  }
  return line;
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

  /*
   * The Hindi word, under the English sentence, when Family words is हिन्दी.
   *
   * Under rather than instead: the English wording does not change anywhere. This is a second thing
   * said, not a translation of the first, because the two are not the same statement -- English says
   * "uncle" and Hindi says which uncle -- and a reader who set this preference is usually the one
   * being asked to explain the word to somebody else.
   */
  if (prefs?.familyWords === 'hi') {
    const hindi = hindiFor(result, from, to);
    if (hindi) box.append(hindiLine(hindi));
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
    onRelate: (id) => relateFrom(id),
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

      // A second way into the question, beside the row rather than inside it: a button cannot hold
      // another button, and the row's own click already means "open this person" (#151).
      const relate = document.createElement('button');
      relate.type = 'button';
      relate.className = 'index-relate';
      relate.append(relateIcon(15));
      relate.setAttribute('aria-label', `How are we related? Starting from ${displayName(person)}`);
      relate.title = 'How are we related?';
      relate.addEventListener('click', () => relateFrom(person.id));

      li.className = 'index-item';
      li.append(row, relate);
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

/** Android's own words for each date problem, so the two shells say the same thing. */
const DATE_PROBLEMS = {
  [DateProblem.MALFORMED]: 'Use a year like 1938, or 1938-04-17',
  [DateProblem.DEATH_BEFORE_BIRTH]: 'This is earlier than the birth date',
};

/** Which draft field each input edits. */
const FIELD_KEYS = {
  'f-name': 'name',
  'f-gender': 'gender',
  'f-birth': 'birthDate',
  'f-death': 'deathDate',
  'f-deceased': 'deceased',
  'f-notes': 'notes',
};

/**
 * Somebody "Add a person" made and nobody has finished adding: still blank, joined to nobody.
 *
 * Checked against the tree rather than remembered, because the moment they gain a relative or a
 * photograph they are a person with something recorded, and "Discard" would understate what the
 * button then does.
 */
function isFresh(person) {
  if (!person || state.fresh !== person.id || !isBlankPerson(person)) return false;
  return !state.tree.relationships.some((r) => r.from === person.id || r.to === person.id);
}

function renderPanel() {
  const panel = $('panel');
  const id = state.selected;
  const person = id ? state.tree.person(id) : null;
  if (!person) {
    panel.hidden = true;
    state.draft = null;
    return;
  }
  panel.hidden = false;

  /*
   * The draft survives a redraw, unless there is nothing in it.
   *
   * A draft nobody has touched is refreshed from the tree every time, so an undo that changes this
   * person shows in the form at once. One with edits in it is kept, because it holds something the
   * tree does not and a redraw is not the reader asking to lose it.
   */
  const draft = state.draft;
  if (draft?.id !== id || !isDirty(draft.values, draft.base)) {
    state.draft = { id, base: person, values: draftFrom(person), showProblems: false,
      touched: new Set() };
  }

  $('panel-title').textContent = isFresh(person) ? 'Add a person' : 'Edit person';
  const body = $('panel-body');
  body.replaceChildren();
  body.append(personForm(person), relativesSection(person));
  // Not for somebody still being added: a blank person has no family to be asked about yet.
  if (!isFresh(person)) body.append(relateRow(person));
  paintPanelState();
}

/** The word the panel shows for a moment after its edits were kept. */
let panelFlash = null;
let panelFlashTimer = null;

function flashPanel(word) {
  panelFlash = word;
  clearTimeout(panelFlashTimer);
  panelFlashTimer = setTimeout(() => { panelFlash = null; paintPanelState(); }, 2400);
}

/**
 * Brings the panel's buttons, status and date problems up to date with its draft.
 *
 * Called on every keystroke, so it touches only those -- redrawing the form would take the caret
 * out of the field being typed in.
 */
function paintPanelState() {
  const draft = state.draft;
  const person = draft && state.tree?.person(draft.id);
  if (!person) return;

  const fresh = isFresh(person);
  const dirty = isDirty(draft.values, person);

  // "Add" and "Discard" only while this is still an addition; for anybody already in the tree the
  // destructive button says what it does, which is remove them and every one of their connections.
  const save = $('panel-save');
  save.textContent = fresh ? 'Add' : 'Save';
  save.disabled = !fresh && !dirty;
  $('panel-remove').textContent = fresh ? 'Discard' : 'Delete this person';

  const status = $('panel-status');
  status.textContent = dirty ? 'Unsaved' : (panelFlash ?? '');
  status.dataset.tone = dirty ? 'dirty' : 'done';

  /*
   * A problem is shown once the field has been left, or once Save has been pressed -- not while
   * the first digit of a year is being typed. It clears the moment it is fixed.
   */
  const problems = dateProblems(draft.values);
  for (const [key, inputId] of [['birthDate', 'f-birth'], ['deathDate', 'f-death']]) {
    const input = $(inputId);
    if (!input) continue;
    const shown = draft.showProblems || draft.touched.has(key) ? problems[key] : null;
    input.setAttribute('aria-invalid', String(Boolean(shown)));
    input.closest('.field').dataset.problem = String(Boolean(shown));
    paintProblem($(`${inputId}-error`), shown ? DATE_PROBLEMS[shown] : '');
  }

  reflectDirty();
}

/**
 * A problem's words, with any example date kept on one line.
 *
 * The date fields are half the panel wide, and "1938-04-17" broken at a hyphen reads as two
 * fragments rather than one example of the shape to type -- exactly the thing the message is for.
 */
function paintProblem(box, message) {
  box.replaceChildren();
  let last = 0;
  for (const match of message.matchAll(/\d{4}(?:-\d{2}){0,2}/g)) {
    box.append(message.slice(last, match.index));
    const date = document.createElement('span');
    date.className = 'nowrap';
    date.textContent = match[0];
    box.append(date);
    last = match.index + match[0].length;
  }
  box.append(message.slice(last));
}

function field({
  label, id, value = '', type = 'text', wide = false, hint = null, placeholder = null,
  validated = false, describedBy = null,
}) {
  const wrap = document.createElement('div');
  wrap.className = wide ? 'field wide' : 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  lab.htmlFor = id;
  const input = type === 'textarea'
    ? document.createElement('textarea')
    : document.createElement('input');
  if (type !== 'textarea') {
    input.type = 'text';
    input.autocomplete = 'off';
  }
  input.id = id;
  input.value = value ?? '';
  if (placeholder) input.placeholder = placeholder;
  wrap.append(lab, input);
  if (hint) {
    const note = document.createElement('p');
    note.className = 'field-hint';
    note.textContent = hint;
    wrap.append(note);
  }
  const described = [];
  if (validated) {
    const error = document.createElement('p');
    error.className = 'field-error';
    error.id = `${id}-error`;
    wrap.append(error);
    described.push(error.id);
  }
  if (describedBy) described.push(describedBy);
  if (described.length) input.setAttribute('aria-describedby', described.join(' '));
  return wrap;
}

function personForm(person) {
  const values = state.draft.values;
  const form = document.createElement('div');
  form.className = 'form-grid';

  // The face first, because it is how somebody recognises they have the right person open before
  // reading a word of the form.
  const photo = photoField(person);
  photo.classList.add('field', 'wide');
  form.append(photo);

  // Android's own placeholder: a blank name is not a mistake here, it is how an unknown person is
  // recorded, and the field should say so before anybody wonders.
  form.append(field({
    label: 'Name', id: 'f-name', value: values.name, wide: true,
    placeholder: 'Leave blank if you don’t know it',
  }));

  const gender = document.createElement('div');
  gender.className = 'field wide';
  const gl = document.createElement('label');
  gl.textContent = 'Gender';
  gl.htmlFor = 'f-gender';
  const select = document.createElement('select');
  select.id = 'f-gender';
  for (const [value, text] of GENDERS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    if (values.gender === value) option.selected = true;
    select.append(option);
  }
  gender.append(gl, select);
  form.append(gender);

  /*
   * The two dates side by side, with one hint under both (#147).
   *
   * The placeholders are real dates rather than a format string: `1948` shows that a year alone is
   * a whole answer, and `2019-03-14` shows the fullest shape and the separator. One hint under the
   * pair says the same thing to both, rather than printing it twice or leaving one field bare.
   */
  form.append(field({
    label: 'Born', id: 'f-birth', value: values.birthDate, placeholder: '1948',
    validated: true, describedBy: 'f-dates-hint',
  }));
  form.append(field({
    label: 'Passed away', id: 'f-death', value: values.deathDate, placeholder: '2019-03-14',
    validated: true, describedBy: 'f-dates-hint',
  }));
  const hint = document.createElement('p');
  hint.className = 'field-hint dates-hint';
  hint.id = 'f-dates-hint';
  hint.textContent = 'A year alone is fine. Spaces become dashes.';
  form.append(hint);
  for (const id of ['f-birth', 'f-death']) {
    const input = form.querySelector(`#${id}`);
    input.spellcheck = false;
  }

  const check = document.createElement('label');
  check.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'f-deceased';
  box.checked = values.deceased;
  check.append(box, document.createTextNode('No longer living'));
  form.append(check);

  form.append(field({
    label: 'Notes', id: 'f-notes', value: values.notes, type: 'textarea', wide: true,
    placeholder: 'Anything worth remembering',
  }));

  /*
   * Every keystroke goes into the draft, and nothing into the tree until Save.
   *
   * So a name typed letter by letter is still one step in the history -- the reason this used to
   * wait for `change` -- and the panel can say at once that there is something unsaved.
   */
  const onEdit = (event) => {
    const key = FIELD_KEYS[event.target.id];
    if (!key || !state.draft) return;

    let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (key === 'birthDate' || key === 'deathDate') {
      const typed = normaliseDateTyping(value, event.target.selectionStart ?? value.length);
      if (typed.value !== value) {
        event.target.value = typed.value;
        event.target.setSelectionRange(typed.caret, typed.caret);
      }
      value = typed.value;
    }

    state.draft.values = withChange(state.draft.values, key, value);
    // A death date ticks "no longer living", and unticking it clears the date: show both at once.
    $('f-deceased').checked = state.draft.values.deceased;
    if ($('f-death').value !== state.draft.values.deathDate) {
      $('f-death').value = state.draft.values.deathDate;
    }
    paintPanelState();
  };
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);

  form.addEventListener('focusout', (event) => {
    const key = FIELD_KEYS[event.target.id];
    if (key !== 'birthDate' && key !== 'deathDate') return;
    state.draft?.touched.add(key);
    paintPanelState();
  });

  // Enter keeps the edit, as a form does; in the notes, where Enter is a new line, Ctrl+Enter does.
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const line = event.target.tagName === 'INPUT' && event.target.type === 'text';
    if (line || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      commitDraft();
    }
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

/**
 * "How are we related?" from the person already open (#151).
 *
 * Android offers it from the person sheet and the person page, in these words. Before this the
 * desktop could only start the question from nothing, so the commonest form of it -- this person,
 * and me -- cost the reader the selection they had already made and a name retyped from the screen.
 */
function relateRow(person) {
  const row = document.createElement('div');
  row.className = 'relate-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'relate-from';
  button.append(relateIcon(16));
  const words = document.createElement('span');
  words.textContent = 'How are we related?';
  button.append(words);
  button.title = `How is ${displayName(person)} related to somebody else?`;
  button.addEventListener('click', () => relateFrom(person.id));
  row.append(button);
  return row;
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

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ editing */

/**
 * Asks one short question in a dialog and resolves with the answer, or null for the safe one.
 *
 * `options` are the choices that need a sentence each to be understood -- "Keep as unknown" does
 * not explain itself -- and are drawn as a list; `actions` are the ordinary buttons along the foot.
 * Escape, and closing any other way, always answers null: whatever the question, the answer that
 * changes nothing is the one a stray keypress gets.
 */
function ask({ title, body, options = [], actions = [], focus = null }) {
  const dialog = $('ask');
  $('ask-title').textContent = title;
  $('ask-body').textContent = body;

  const optionsBox = $('ask-options');
  optionsBox.replaceChildren();
  optionsBox.hidden = options.length === 0;
  const actionsBox = $('ask-actions');
  actionsBox.replaceChildren();

  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };

    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ask-option';
      if (option.tone) button.dataset.tone = option.tone;
      const label = document.createElement('span');
      label.className = 'ask-option-label';
      label.textContent = option.label;
      const detail = document.createElement('span');
      detail.className = 'ask-option-detail';
      detail.textContent = option.detail;
      button.append(label, detail);
      button.addEventListener('click', () => finish(option.value));
      optionsBox.append(button);
    }

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.tone === 'danger-quiet' ? 'btn-danger' : `btn ${action.tone ?? 'quiet'}`;
      button.textContent = action.label;
      button.addEventListener('click', () => finish(action.value ?? null));
      actionsBox.append(button);
    }

    dialog.onclose = () => resolve(null);
    dialog.showModal();
    (focus == null ? $('ask-head') : actionsBox.children[focus]).focus();
  });
}

/** Whether a question is on screen, which the keyboard shortcuts must not reach past. */
const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));

/**
 * Lets go of the person in the panel, asking first if that would lose edits.
 *
 * Resolves false when the reader chose to keep editing, and every caller then leaves things as
 * they were. The wording is Android's (`edit_discard_*`), so the two shells ask the same question
 * in the same words.
 *
 * A fresh addition is taken away again on the way out: backing out of "Add a person" is backing
 * out, and leaving a blank card on the chart would be the app deciding somebody unknown exists.
 */
async function releasePanel() {
  if (draftIsDirty()) {
    const answer = await ask({
      title: 'Discard changes?',
      body: 'Your edits to this person won’t be kept.',
      actions: [
        { label: 'Keep editing', value: null },
        { label: 'Discard', value: 'discard', tone: 'danger' },
      ],
      focus: 0,
    });
    if (answer !== 'discard') {
      $('f-name')?.focus();
      return false;
    }
  }
  letGoOfPanel();
  return true;
}

/** Drops the draft, and a fresh addition with it. The part of letting go that needs no question. */
function letGoOfPanel() {
  const person = state.draft && state.tree?.person(state.draft.id);
  state.draft = null;
  if (person && isFresh(person)) {
    withdrawFresh(person.id);
    state.selected = null;
    rebuild();
  }
  state.fresh = null;
}

/** Takes an unfinished addition back out of the tree, without a trace in the history if possible. */
function withdrawFresh(id) {
  if (state.tree.canWithdraw(id)) state.tree.withdraw(id);
  else state.tree.removePerson(id);
  state.fresh = null;
}

/**
 * Opens somebody in the panel, or closes it with null -- after asking, if it holds unsaved edits.
 *
 * Resolves whether the selection actually changed. When the reader keeps editing, the chart is put
 * back on the person the panel still holds, so the two never disagree about who is open.
 */
function select(id) {
  // Immediately, when there is nothing to ask: a click on a card should open it in the same frame,
  // not a turn of the event loop later.
  if (id === state.selected || !draftIsDirty()) {
    if (id !== state.selected) letGoOfPanel();
    selectNow(id);
    return Promise.resolve(true);
  }
  return releasePanel().then((released) => {
    if (!released) {
      chart.selected = state.selected;
      chart.invalidate();
      return false;
    }
    selectNow(id);
    return true;
  });
}

/** The selection itself, for callers that have already dealt with the panel. */
function selectNow(id) {
  state.selected = id;
  state.adding = null;
  chart.selected = id;
  chart.invalidate();
  renderPanel();
  // The list marks who is being edited, so it has to hear about a selection made on the chart.
  if (state.view === 'index') renderPeople();
}

/**
 * Keeps the panel's edits.
 *
 * Refused, with the problem shown under the field and the caret put in it, while a date cannot be
 * understood. Finishing a fresh addition replaces the blank one in the history, so undo takes back
 * "Add Shyam Lal" in one step rather than a name and then a person.
 *
 * @returns {boolean} whether there is now nothing unsaved in the panel
 */
function commitDraft() {
  const draft = state.draft;
  const person = draft && state.tree?.person(draft.id);
  if (!person) return true;

  const fresh = isFresh(person);
  if (!fresh && !isDirty(draft.values, person)) return true;

  const problems = dateProblems(draft.values);
  const wrong = problems.birthDate ? 'f-birth' : problems.deathDate ? 'f-death' : null;
  if (wrong) {
    draft.showProblems = true;
    paintPanelState();
    $(wrong)?.focus();
    return false;
  }

  const fields = fieldsFrom(draft.values);
  let result;
  if (fresh && state.tree.canWithdraw(person.id)) {
    state.tree.withdraw(person.id);
    result = state.tree.addPerson({ id: person.id, ...fields });
  } else {
    result = state.tree.updatePerson(person.id, fields);
  }
  if (!result.ok) {
    toast(REFUSALS[result.reason] ?? 'That change was not made.', 'bad');
    return false;
  }

  state.fresh = null;
  state.draft = null;
  flashPanel(fresh ? 'Added' : 'Updated');
  rebuild();
  return true;
}

/** The panel's destructive button, which is Discard for an addition and Delete for anybody else. */
async function removeFromPanel() {
  const person = state.tree.person(state.selected);
  if (!person) return;
  if (isFresh(person)) {
    state.draft = null;
    withdrawFresh(person.id);
    state.selected = null;
    rebuild();
    return;
  }
  await deletePerson(person.id);
}

/**
 * Deletes somebody, asking first when that would take connections with them.
 *
 * Android's dialog, ported: somebody joined to others is offered "Keep as unknown" beside "Delete
 * completely", because a grandparent you know little about is still the join between two branches,
 * and deleting them outright splits the family in two. Somebody joined to nobody is removed at once
 * -- there is no shape to lose -- with Undo in the toast.
 */
async function deletePerson(id) {
  const person = state.tree.person(id);
  if (!person) return;
  const edges = state.tree.relationships.filter((r) => r.from === id || r.to === id);

  if (edges.length) {
    const others = new Set(edges.map((r) => (r.from === id ? r.to : r.from))).size;
    const who = person.name ? displayName(person) : 'This person';
    const choice = await ask({
      title: person.name ? `Delete ${displayName(person)}?` : 'Delete this person?',
      body: `${who} is connected to ${count(others, 'other person', 'other people')}. `
        + 'Choose what happens to those connections.',
      options: [
        {
          value: 'unknown',
          label: 'Keep as unknown',
          detail: 'Clears their details but keeps their place in the tree, so the family still joins up.',
        },
        {
          value: 'delete',
          label: 'Delete completely',
          detail: `Removes them and their ${count(edges.length, 'connection', 'connections')}.`,
          tone: 'danger',
        },
      ],
      actions: [{ label: 'Cancel', value: null }],
    });
    if (choice === 'unknown') { keepAsUnknown(id); return; }
    if (choice !== 'delete') return;
  }
  removePerson(id);
}

function keepAsUnknown(id) {
  const result = state.tree.clearDetails(id);
  if (!result.ok) { toast(REFUSALS[result.reason] ?? 'Nothing was changed.', 'bad'); return; }
  state.draft = null;
  state.selected = null;
  rebuild();
  toast('Kept as an unknown person.', 'good', { action: UNDO });
}

async function addPerson() {
  if (!(await releasePanel())) return;
  const result = state.tree.addPerson({ name: '' });
  if (!result.ok) { toast(REFUSALS[result.reason] ?? 'Could not add anybody.', 'bad'); return; }
  state.selected = result.id;
  state.fresh = result.id;
  state.draft = null;
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
     * the tree that nobody asked for. The addition is withdrawn -- not undone, which would leave it
     * waiting in Redo -- so what the reader sees is simply that nothing happened, and why.
     */
    state.tree.withdraw(added.id);
    toast(REFUSALS[result.reason] ?? 'That connection was not made.', 'bad');
    rebuild();
    return;
  }
  // A person and a relationship to the tree, one act to the reader, so one step to undo.
  const word = KINDS.find(([k]) => k === kind)[1].toLowerCase();
  state.tree.combine(2, `Add ${name || 'someone'} as a ${word}`);
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
  state.draft = null;
  state.selected = null;
  rebuild();
  toast(result.removedEdges
    ? `Deleted ${name} and ${count(result.removedEdges, 'connection', 'connections')}.`
    : `Deleted ${name}.`, 'good', { action: UNDO });
}

/**
 * Whether the caret is in a text field, where Ctrl+Z means the text.
 *
 * The menu owns the accelerator, so without this Ctrl+Z inside the name field would take back the
 * last change to the *tree* -- a relative added a minute ago -- rather than the last few letters.
 * With edits now held in the panel until Save, the letters are what somebody typing means.
 */
function typingInField() {
  const el = document.activeElement;
  return Boolean(el) && (el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && /^(text|search)$/.test(el.type)));
}

function undo() {
  if (typingInField()) { document.execCommand('undo'); return; }
  const result = state.tree?.undo();
  if (!result?.ok) return;
  rebuild();
  toast(`Undid: ${result.label}`);
}

function redo() {
  if (typingInField()) { document.execCommand('redo'); return; }
  const result = state.tree?.redo();
  if (!result?.ok) return;
  rebuild();
  toast(`Redid: ${result.label}`);
}

/* ------------------------------------------------------------------ files */

async function startNewTree() {
  if (!(await releaseTree())) return;
  state.tree = new Tree({}, { ownTreeId: state.ownTreeId });
  state.draft = null;
  state.fresh = null;
  state.photos = new Map();
  state.path = null;
  state.name = 'Untitled tree';
  state.selected = null;
  forgetRelate();
  showFileName(state.name);
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
    autosave.cancel();
    state.draft = null;
    state.fresh = null;
    state.photos = photos;
    state.path = filePath ?? null;
    state.name = name;
    state.selected = null;
    forgetRelate();
    showFileName(name);
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

  toast(`${said.join(', ')}.${extra}${refused}`,
    result.conflicts.length || result.relationshipsRefused.length ? 'warn' : 'good',
    { action: UNDO });
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

/**
 * Saves now, because somebody asked -- Ctrl+S, the menu, the bar, or the quit prompt.
 *
 * For a tree with a file this is autosave without the pause: the same write, just not waiting.
 * For a tree without one, or Save as, it asks where; and from a tree's first save onwards every
 * change is written by itself, which the confirmation says once, at the moment it becomes true.
 *
 * @returns {Promise<'saved'|'cancelled'|'failed'>} for the quit prompt, which has to know
 */
async function save({ as = false } = {}) {
  if (!state.tree || state.saving) return 'failed';
  // Saving the file saves the person being edited too; a Ctrl+S that wrote everything except the
  // name on screen would be the one save somebody could not believe. A date that cannot be kept
  // stops the whole save, with the problem shown where it is.
  if (!commitDraft()) return 'failed';

  if (!as && state.path) {
    const ok = await autosave.flush();
    if (ok) toast(`Every change is saved to ${state.name}.`);
    return ok ? 'saved' : 'failed';
  }

  state.saving = true;
  try {
    const firstSave = !state.path;
    const signature = state.tree.signature();
    let made;
    try {
      made = await bytesForTree(state.tree, photosStillUsed());
    } catch (error) {
      if (error instanceof SaveRefused) {
        toast(`${error.message}\n\n${error.detail}`, 'bad');
        return 'failed';
      }
      throw error;
    }

    const suggested = state.name?.endsWith('.ftree') ? state.name : `${state.name || 'family-tree'}.ftree`;
    const result = await shell.saveTreeAs(made.bytes, suggested);
    if (!result?.ok) {
      if (result?.reason === 'CANCELLED') return 'cancelled';
      toast('That tree was not saved.', 'bad');
      return 'failed';
    }

    state.path = result.path;
    state.name = result.name;
    showFileName(result.name);
    state.tree.markSaved(signature);
    reflectDirty();
    toast(`Saved ${count(made.people, 'person', 'people')} and `
      + `${count(made.relationships, 'connection', 'connections')} to ${result.name}.`
      + (firstSave ? ' From now on every change is saved as you make it.' : ''));
    // Anything edited while the dialog was up goes to the new file straight away.
    scheduleAutosave();
    return 'saved';
  } finally {
    state.saving = false;
  }
}

/**
 * Lets go of the open tree before another replaces it -- New tree, Open tree, Close tree.
 *
 * A tree with a file is flushed and let go without a word: that is what autosave means. What is
 * left is asked about, because it is the one case where closing loses something: a tree that has
 * never had a file, or one whose last write failed. Until this, opening another file while a new
 * tree was unsaved simply threw the new tree away.
 */
async function releaseTree() {
  if (!state.tree) return true;
  if (!(await releasePanel())) return false;
  if (!state.tree.isDirty) {
    autosave.cancel();
    return true;
  }
  if (state.path && (await autosave.flush())) {
    autosave.cancel();
    return true;
  }

  const untitled = !state.path;
  const answer = await ask({
    title: untitled ? 'Save this tree first?' : `${state.name} couldn’t be saved`,
    body: untitled
      ? 'It hasn’t been saved to a file yet, so closing it now loses it.'
      : `${describeWriteFailure(autosave.status.error)}. Closing it now loses the changes made `
        + 'since it was last saved.',
    actions: [
      { label: untitled ? 'Don’t save' : 'Discard changes', value: 'discard', tone: 'danger-quiet' },
      { label: 'Cancel', value: null },
      { label: untitled ? 'Save…' : 'Save as…', value: 'save', tone: 'primary' },
    ],
    focus: 2,
  });
  if (answer === 'save') return (await save({ as: true })) === 'saved';
  if (answer === 'discard') {
    autosave.cancel();
    return true;
  }
  return false;
}

/**
 * Before the window closes: write what autosave had not got to yet.
 *
 * The main process asks this first and only puts up its own question if the tree is still not on
 * disk a moment later -- so a change made a second before closing is simply saved, not asked about.
 * A person half-edited in the panel is not saved here: nobody pressed Save, and the quit prompt is
 * how they get asked.
 */
function flushForClose() {
  if (state.path && !draftIsDirty()) autosave.flush();
}

/* ------------------------------------------------------------------ wiring */

function wireChrome() {
  $('start-new').addEventListener('click', startNewTree);
  $('choose').addEventListener('click', () => shell?.chooseTree());
  $('add-person').addEventListener('click', addPerson);

  // The two the bar gained when Undo, Redo and Save left it (#150). Their glyphs come from icons.js,
  // which the panel, the list and the compact view draw theirs from too.
  $('relate-btn').append(relateIcon(19));
  $('relate-btn').addEventListener('click', () => {
    if ($('relate').hidden) { setView('chart'); openRelate(); } else closeRelate();
  });
  $('prefs-btn').append(prefsIcon(15));
  $('prefs-btn').addEventListener('click', openPrefs);
  $('panel-close').addEventListener('click', () => select(null));
  $('panel-save').addEventListener('click', () => commitDraft());
  // The bar's save state offers the one thing each of its two awkward states needs.
  $('save-state-action').addEventListener('click', () => {
    if (!state.path) save({ as: true });
    else autosave.flush();
  });
  $('panel-remove').addEventListener('click', () => removeFromPanel());

  // A toast with a button in it holds still while somebody is reaching for the button.
  const box = $('toast');
  box.addEventListener('mouseenter', () => holdToast(true));
  box.addEventListener('mouseleave', () => holdToast(false));
  box.addEventListener('focusin', () => holdToast(true));
  box.addEventListener('focusout', () => holdToast(false));

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
      button.addEventListener('click', async () => {
        search.value = '';
        results.hidden = true;
        if (await select(person.id)) chart.centreOn(person.id);
      });
      li.append(button);
      results.append(li);
    }
    results.hidden = !found.length;
  });
}

function wireShell() {
  if (!shell) return;

  shell.onOpenTree(async (tree) => {
    // Opening another file closes this one as surely as Close does, so it asks the same things.
    const reopening = Boolean(tree.path) && tree.path === state.path && state.tree?.isDirty;
    if (!(await releaseTree())) return;
    // The bytes were read before this tree's last changes were flushed to that same file, so they
    // are older than what is on screen -- which is now exactly what is on disk. Keep it.
    if (reopening) return;
    openBytes(tree.bytes, tree.name, tree.path);
  });

  shell.onMenuCommand((command) => {
    if (command === 'file:new') { startNewTree(); return; }
    if (command === 'file:import') { importTree(); return; }
    if (command === 'file:save') { save(); return; }
    if (command === 'file:flush') { flushForClose(); return; }
    if (command === 'file:saveForClose') {
      save().then((outcome) => shell.reportSaveOutcome?.(outcome));
      return;
    }
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
      releaseTree().then((released) => { if (released) closeTree(); });
    }
  });
}

function closeTree() {
  autosave.cancel();
  showFileName(null);
  state.tree = null;
  state.path = null;
  state.selected = null;
  state.draft = null;
  state.fresh = null;
  forgetRelate();
  setState('empty');
  shell.setDirty(false);
}

function wireKeys() {
  document.addEventListener('keydown', (event) => {
    // A dialog owns the keyboard while it is open. Escape there means "the safe answer" to the
    // dialog, and must not also close the panel behind it -- which would ask a second question.
    if (dialogOpen()) return;
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
  wirePhotos();
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

  // Whoever changed it -- this dialog, the native menu, another window -- the page follows.
  shell?.onSettingsChanged?.((next) => {
    const before = prefs;
    prefs = next;
    applyPrefs({ redraw: before?.photosOnChart !== prefs.photosOnChart });
    paintPrefs();
    if (before?.familyWords !== prefs.familyWords && !$('relate').hidden) renderRelation();
  });

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
