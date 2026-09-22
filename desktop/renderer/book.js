/*
 * The family book dialog: a live preview of a designed PDF, and the choices that shape it.
 *
 * The preview *is* the file (`docs/family-book.md`). Every page here is painted by the exact same
 * `paintPage` the hidden print window uses, from the exact same `Book` the composer produced, so
 * there is nothing this dialog shows that the PDF could disagree with. Composing runs entirely in
 * this page -- `composeBook` is synchronous, reads no clock and no DOM (`site/book/compose.js`) --
 * which is what lets the same engine also run inside Android's network-blocked WebView.
 *
 * Three things this file is careful about, because they are the ones a book dialog gets wrong:
 *
 * **Photographs never touch the composer.** It only ever sees `book.photos: [{id, px}]`, a size
 * request per person. This file is what turns that into pixels: it reads the archive's own bytes
 * by the person's stored photo path, draws them onto a canvas at the requested size, and hands back
 * a `data:image/jpeg` URL at quality 0.86 -- which is also why the desktop's PDFs come out smaller
 * than Android's lossless ones, and why that is fine (`docs/family-book.md`).
 *
 * **The policy gate runs before every compose.** `plan → decide → compose(allowance)`, exactly as
 * `docs/premium.md` describes it: a cheap first read of the family (`readFamily` with no allowance)
 * gets the generation count and the population `decide()` needs to judge the request, then whatever
 * it grants is what `composeBook` actually receives. Usage is only ever recorded after a save
 * succeeds -- see `save()` below.
 *
 * **Every change recomposes, gently.** Nothing here hand-patches a page for a title edit or a
 * toggled switch; the whole book is composed again, debounced by about 150ms so a fast typist does
 * not recompose on every keystroke. Recomposing is cheap and correct is worth more than clever.
 */

import { composeBook, estimateBytes } from '../../site/book/compose.js';
import { paintPage, fitText } from '../../site/book/svg.js';
import { readFamily } from '../../site/book/family.js';
import { resolveFeatured } from '../../site/book/story/featured.js';
import { loadPolicy, decide } from '../../site/book/policy.js';
import { readCatalog, listing } from '../../site/book/catalog.js';
import { searchPeople } from '../../site/playground/search.js';
import { restrictedGraph } from '../../site/playground/model.js';
import { searchResultRow } from './search-row.js';

import {
  DEFAULT_OPTIONS, scopeFor, todayIso, formatEstimate,
  decisionAllowance, canSave, decisionMessage, nextBookUsage, bookRequest,
  pickerGraph, featuresPerson, coverOptions,
} from './book-options.js';

const $ = (id) => document.getElementById(id);

/** How long to wait after the last change before recomposing (docs/family-book.md's own number). */
const RECOMPOSE_DEBOUNCE_MS = 150;

const firstNameOf = (name) => (name ? name.split(/\s+/)[0] : name);

/**
 * A person's stored photograph, drawn down to the size the book actually prints it at.
 *
 * Quality 0.86 rather than `photo.js`'s 0.85 is not a typo: that number is the *storage* quality,
 * chosen once for a 512px face nobody has reprinted yet; this is a *print* quality, chosen once
 * for this feature, and the two having nothing to do with each other is the point -- one is about
 * a tree file staying small over years of edits, the other about one PDF looking right today.
 */
async function toSquareJpeg(bytes, px) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  } catch {
    return null; // a photograph this machine cannot decode; the portrait's ring still stands
  }
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Stored photographs are already the largest square that fit (`photo.js`'s own crop on the way
  // in), so this is ordinarily a plain scale; the crop here is a guard against anything else.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, px, px);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** Every portrait the book asked for, resolved to a data URL -- or left out, never left broken. */
async function resolvePhotoUrls(photoSpecs, personById, photoBytes) {
  const urls = new Map();
  for (const { id, px } of photoSpecs) {
    const person = personById.get(id);
    if (!person?.photo) continue;
    let bytes = null;
    try { bytes = await photoBytes(person.photo); } catch { /* treated as missing, below */ }
    if (!bytes) continue;
    const url = await toSquareJpeg(bytes, px);
    if (url) urls.set(id, url);
  }
  return urls;
}

/**
 * @param {object} options
 * @param {object} options.shell  `window.ftreeDesktop`
 * @param {object} options.hooks  what the rest of the page lends this dialog:
 *   getDocument()                the open tree, in the exchange shape `composeBook` reads
 *   personName(id)                a person's display name, for "Who's in it" and the toast
 *   photoBytes(path)              => bytes for a stored photo path, or null
 *   getSettings()                 the settings object last read, for `bookUsage` and Family words
 *   setBookUsage(next)             writes it back through the one path every setting takes
 *   onSaved(fileName, path)       a save just finished; the page shows its own toast
 */
export function createBook({ shell, hooks }) {
  const dialog = $('book');
  const head = $('book-head');
  const preview = $('book-preview');
  const templatesBox = $('book-templates');
  const titleInput = $('book-title-input');
  const titleReset = $('book-title-reset');
  const whoGroup = $('book-who-group');
  const whoBox = $('book-who');
  const storyPicker = $('book-story-picker');
  const storyInput = $('book-story-input');
  const storyResults = $('book-story-results');
  const storyReset = $('book-story-reset');
  const storyNote = $('book-story-note');
  const storyHint = $('book-story-hint');
  const photosCheck = $('book-photos');
  const photosNote = $('book-photos-note');
  const livingCheck = $('book-living-dates');
  const notesCheck = $('book-notes');
  const decisionNote = $('book-decision');
  const status = $('book-status');
  const saveButton = $('book-save');
  const cancelButton = $('book-cancel');

  /** Loaded once and kept for the life of the page: the catalogue, templates and policy do not change under it. */
  let assets = null;

  const session = {
    doc: null,
    scopePersonId: null,
    scopePersonName: null,
    options: { ...DEFAULT_OPTIONS },
    /** What the picker offers, worked out from the catalogue each time the dialog opens (it may be a new day). */
    templates: [],
    derivedTitle: '',
    /** The composer's own pick for "Whose story" (`resolveFeatured`), recomputed every recompute. */
    derivedFeaturedId: null,
    /**
     * The "Whose story" picker. `scopeGraph` is everyone the current scope allows, rebuilt only on
     * a scope change or reopen -- never per keystroke (#249's own gotcha). `graph` is what
     * `searchPeople` actually runs against: `scopeGraph` itself, or `scopeGraph` narrowed by the
     * policy's allowance once one applies, memoized by `allowanceKey` so an unrelated recompute
     * (a title edit, a photos toggle) never re-derives it for nothing.
     */
    story: { scopeGraph: null, graph: null, allowanceKey: undefined, results: [], activeIndex: -1 },
    decision: null,
    book: null,
    photoUrls: new Map(),
    error: null,
    busy: false,
    /** Bumped on every recompute; a stale one finishing after a newer one started drops its result. */
    token: 0,
  };

  let debounceTimer = null;

  async function ensureAssets() {
    if (assets) return assets;
    const raw = await shell.book.assets();
    const files = (Array.isArray(raw?.templates) ? raw.templates : []).filter((t) => typeof t?.id === 'string');
    assets = {
      catalog: readCatalog(raw?.catalog ?? null),
      files: new Map(files.map((t) => [t.id, t])),
      policy: loadPolicy(raw?.policy ?? null),
    };
    return assets;
  }

  /** The catalogue's list for `today` -- what is in season first -- limited to what this build carries. */
  function offered(today) {
    return listing(assets.catalog, today)
      .filter((t) => assets.files.has(t.id))
      .map((t) => ({ ...t, template: assets.files.get(t.id) }));
  }

  /* ---------------------------------------------------------------- painting */

  function setBusy(flag, label = '') {
    session.busy = flag;
    if (flag) status.textContent = label;
    else if (status.textContent === 'Making your book…') status.textContent = '';
    for (const el of templatesBox.querySelectorAll('button')) el.disabled = flag;
    for (const el of [titleInput, titleReset, photosCheck, livingCheck, storyInput, storyReset, notesCheck]) {
      el.disabled = flag;
    }
    for (const el of whoBox.querySelectorAll('button')) el.disabled = flag;
    if (flag) closeStoryList();
    paintSaveState();
  }

  function paintSaveState() {
    const blocked = session.busy || Boolean(session.error) || !session.book || !canSave(session.decision);
    saveButton.disabled = blocked;
    saveButton.title = !canSave(session.decision) ? (decisionMessage(session.decision) ?? '') : '';
  }

  function paintDecision() {
    const message = decisionMessage(session.decision);
    decisionNote.hidden = !message;
    decisionNote.textContent = message ?? '';
  }

  function paintPhotosNote(book) {
    photosNote.textContent = formatEstimate(estimateBytes(book, { lossless: false }));
  }

  function paintWho() {
    if (!session.scopePersonId) { whoGroup.hidden = true; return; }
    whoGroup.hidden = false;
    const branchButton = whoBox.querySelector('[data-scope="branch"]');
    branchButton.textContent = `${firstNameOf(session.scopePersonName) ?? 'This person'}’s branch`;
    for (const button of whoBox.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.scope === session.options.scopeKind));
    }
  }

  /* -------------------------------------------------------- whose story: an accessible combobox */

  /**
   * Rebuilds the graph the picker searches, for the scope as it stands right now, and drops a
   * reader's own pick if the new scope no longer includes them -- a stale `options.featured` would
   * otherwise sit there silently ignored by `resolveFeatured` while the picker kept showing it.
   * Clears `allowanceKey` too, so the next `recompute()` re-derives `graph` from this fresh
   * `scopeGraph` rather than trusting a memo taken against the scope this just replaced.
   */
  function refreshStoryGraph() {
    session.story.scopeGraph = pickerGraph(session.doc, session.options, session.scopePersonId);
    session.story.graph = session.story.scopeGraph;
    session.story.allowanceKey = undefined;
    if (session.options.featured && !session.story.graph.people.has(session.options.featured)) {
      session.options.featured = null;
    }
    closeStoryList();
  }

  function closeStoryList() {
    session.story.results = [];
    session.story.activeIndex = -1;
    storyResults.hidden = true;
    storyResults.replaceChildren();
    storyInput.setAttribute('aria-expanded', 'false');
    storyInput.removeAttribute('aria-activedescendant');
  }

  /** Keeps `aria-selected` on the options and `aria-activedescendant` on the input in step with
   *  `session.story.activeIndex`, the one piece of state the arrow keys and a mouse hover both move. */
  function updateStoryActiveDescendant() {
    const options = storyResults.querySelectorAll('li[role="option"]');
    options.forEach((li, i) => li.setAttribute('aria-selected', String(i === session.story.activeIndex)));
    const active = session.story.activeIndex >= 0 ? options[session.story.activeIndex] : null;
    if (active) storyInput.setAttribute('aria-activedescendant', active.id);
    else storyInput.removeAttribute('aria-activedescendant');
  }

  function moveStoryActive(delta) {
    const n = session.story.results.length;
    if (!n) return;
    session.story.activeIndex = (session.story.activeIndex + delta + n) % n;
    updateStoryActiveDescendant();
  }

  function paintStoryResults(people) {
    session.story.results = people;
    session.story.activeIndex = people.length ? 0 : -1;
    storyResults.replaceChildren();
    if (!people.length) {
      const none = document.createElement('li');
      none.className = 'row-none';
      none.textContent = 'Nobody by that name in this scope.';
      storyResults.append(none);
    } else {
      people.forEach((person, i) => {
        const li = searchResultRow(person, pickStoryPerson);
        li.id = `book-story-option-${i}`;
        li.setAttribute('role', 'option');
        storyResults.append(li);
      });
    }
    storyResults.hidden = false;
    storyInput.setAttribute('aria-expanded', 'true');
    updateStoryActiveDescendant();
  }

  function pickStoryPerson(person) {
    session.options.featured = person.id;
    closeStoryList();
    paintStoryValue();
    scheduleRecompute();
  }

  /**
   * The input's value, the Reset button and the "Chosen for you" note, kept in step with whether
   * the reader has overridden the composer's own choice -- the same derived-value/Reset pattern
   * `titleInput`/`titleReset` use above, applied to a person instead of a string.
   */
  function paintStoryValue() {
    const overridden = session.options.featured !== null;
    const activeId = overridden ? session.options.featured : session.derivedFeaturedId;
    const name = activeId ? hooks.personName(activeId) : null;
    storyInput.value = name ?? '';
    storyReset.hidden = !overridden;
    storyNote.hidden = overridden || !name;
    storyNote.textContent = name ? `Chosen for you: ${name}` : '';
  }

  /** "Heirloom doesn’t feature one person yet." -- shown while the selected template is format 1
   *  (`book-options.js`'s `featuresPerson`), so the picker never looks broken on a template that
   *  simply has no page built around it yet (#256-258). */
  function paintStoryHint(entry) {
    storyHint.hidden = featuresPerson(entry?.template);
  }

  /** The template chips, each with a mini cover painted from page 0 of that template's own book. */
  function paintTemplates(covers) {
    templatesBox.replaceChildren();
    for (const template of session.templates) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'book-template-chip';
      button.setAttribute('aria-pressed', String(template.id === session.options.templateId));

      const cover = document.createElement('span');
      cover.className = 'book-template-cover';
      cover.innerHTML = covers.get(template.id) ?? '';

      const name = document.createElement('span');
      name.className = 'book-template-name';
      name.textContent = template.name;
      button.append(cover, name);

      if (template.featured) {
        const season = document.createElement('span');
        season.className = 'book-template-season';
        season.textContent = 'This season';
        button.append(season);
      }

      button.addEventListener('click', () => {
        if (session.options.templateId === template.id) return;
        session.options.templateId = template.id;
        recompute();
      });
      templatesBox.append(button);
    }
  }

  async function paintPreview(book, photoUrls) {
    preview.replaceChildren();
    const resolve = { photo: (id) => photoUrls.get(id) ?? null, font: (key) => key };
    for (let i = 0; i < book.pages.length; i++) {
      const figure = document.createElement('figure');
      figure.className = 'book-page';
      figure.innerHTML = paintPage(book, i, resolve);
      // The svg itself already carries the page's own aria-label (svg.js); a second, visible
      // caption is for sighted readers scanning the column, and would only echo the same words
      // to anyone using a screen reader.
      const caption = document.createElement('figcaption');
      caption.setAttribute('aria-hidden', 'true');
      caption.textContent = `${i + 1}. ${book.pages[i].label}`;
      figure.append(caption);
      preview.append(figure);
    }
    // Only once the fonts have actually loaded does a measured line mean anything -- see svg.js's
    // own note on fitText, and the Devanagari-shaping gotcha the printed PDF guards the same way.
    await document.fonts.ready;
    fitText(preview);
  }

  function paintError(error) {
    console.warn(`f-tree: the book could not be composed — ${error?.message ?? error}`);
    preview.replaceChildren();
    const box = document.createElement('div');
    box.className = 'book-error';
    const message = document.createElement('p');
    message.textContent = 'This book couldn’t be made. Nothing has been saved.';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn quiet';
    copy.textContent = 'Copy details';
    copy.addEventListener('click', () => {
      // Onto this computer's clipboard and nowhere else: the reader decides whether to send it.
      const text = `f-tree desktop, ${navigator.userAgent}\n${error?.message ?? error}\n${error?.stack ?? ''}`;
      navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'Details copied'; }, () => {});
    });
    box.append(message, copy);
    preview.append(box);
    decisionNote.hidden = true;
  }

  /* ---------------------------------------------------------------- composing */

  function scheduleRecompute() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => recompute(), RECOMPOSE_DEBOUNCE_MS);
  }

  /**
   * The whole pipeline, start to finish: plan (a cheap `readFamily`) → decide → compose(allowance),
   * then every portrait resolved and every page painted. `immediate` skips the one-frame wait used
   * elsewhere to let "Making your book…" actually paint before a synchronous compose blocks the
   * thread -- not needed the very first time, when the dialog itself has nothing to show yet.
   */
  async function recompute({ immediate = false } = {}) {
    const token = ++session.token;
    setBusy(true, 'Making your book…');
    if (!immediate) await new Promise((resolve) => requestAnimationFrame(resolve));
    if (token !== session.token) return;

    try {
      const entry = session.templates.find((t) => t.id === session.options.templateId)
        ?? session.templates[0];
      if (!entry) throw new Error('no template shipped with this build');
      const { template } = entry;

      const now = todayIso();
      const scope = scopeFor(session.options, session.scopePersonId);

      // The derived default is read with no title override, purely so Reset has something to go
      // back to and the field shows a real title before anyone has typed into it.
      const probe = readFamily(session.doc, { now, scope }, {});
      session.derivedTitle = probe.title;
      if (session.options.titleOverride === null) titleInput.value = session.derivedTitle;
      titleReset.hidden = session.options.titleOverride === null;

      // The same "what would the composer pick" question `resolveFeatured` answers for real
      // (`site/book/story/featured.js`), asked with no override so "Whose story" always has a
      // default to show and to reset back to, exactly as the title field does above.
      session.derivedFeaturedId = resolveFeatured(probe, { scope });
      paintStoryHint(entry);
      paintStoryValue();

      const baseOptions = {
        now,
        scope,
        title: session.options.titleOverride ?? undefined,
        photos: session.options.photos,
        livingDates: session.options.livingDates,
        featured: session.options.featured ?? undefined,
        notes: session.options.notes === true,
        // settings.js already normalises familyWords to exactly 'hi' or 'en' on every load and
        // save, so the only case left here is a settings object not read yet.
        words: hooks.getSettings()?.familyWords ?? 'en',
      };

      const request = bookRequest({
        templateId: entry.id,
        templateTier: entry.tier,
        generations: probe.generations,
        people: probe.people.length,
      });
      const decision = decide(assets.policy, request, {
        plan: 'free',
        usage: hooks.getSettings()?.bookUsage ?? {},
      });
      const allowance = decisionAllowance(decision);

      // A Limited decision can trim generations the picker's scope filter (`session.story.scopeGraph`)
      // knows nothing about (`readFamily`'s allowance, applied again for real inside `composeBook`
      // below) -- so whoever the allowance would cut is dropped from the graph "Whose story"
      // searches, and a pick that lands on one of them is cleared, before the dialog can show a
      // person as chosen whom the composed book is about to silently leave out (`resolveFeatured`'s
      // own fallback). Keyed on the allowance itself, always narrowed from the untouched scope
      // graph rather than chained onto whatever the previous recompute narrowed it to -- switching
      // templates can change the decision (and so the allowance) without the scope changing, and an
      // empty allowance (the common case) never calls `readFamily` or `restrictedGraph` at all.
      const allowanceKey = JSON.stringify(allowance);
      if (session.story.scopeGraph && session.story.allowanceKey !== allowanceKey) {
        session.story.graph = Object.keys(allowance).length
          ? restrictedGraph(session.story.scopeGraph,
              new Set(readFamily(session.doc, { now, scope }, allowance).byId.keys()))
          : session.story.scopeGraph;
        session.story.allowanceKey = allowanceKey;
        if (session.options.featured && !session.story.graph.people.has(session.options.featured)) {
          session.options.featured = null;
          paintStoryValue();
        }
      }

      const book = composeBook(session.doc, baseOptions, template, allowance);
      const personById = new Map(session.doc.people.map((p) => [p.id, p]));
      const photoUrls = book.photos.length
        ? await resolvePhotoUrls(book.photos, personById, hooks.photoBytes)
        : new Map();
      if (token !== session.token) return;

      // Every template's own mini cover, painted from the same options so the picker shows the
      // reader's own family rather than a stock thumbnail (docs/family-book.md). A template that
      // fails to compose loses only its own chip's cover, not the dialog. `coverOptions` stops
      // each non-selected template at its own first page (`compose.js`'s `coverOnly`) rather than
      // composing the whole book just to throw away everything after page one.
      const covers = new Map();
      const coverBaseOptions = coverOptions(baseOptions);
      for (const other of session.templates) {
        try {
          const coverBook = other.id === entry.id
            ? book
            : composeBook(session.doc, coverBaseOptions, other.template, allowance);
          covers.set(other.id, paintPage(coverBook, 0, {
            photo: () => null, font: (key) => key, idPrefix: `tpl-${other.id}-`,
          }));
        } catch { /* that chip simply shows no cover */ }
      }
      if (token !== session.token) return;

      session.decision = decision;
      session.book = book;
      session.photoUrls = photoUrls;
      session.error = null;

      paintTemplates(covers);
      paintDecision();
      await paintPreview(book, photoUrls);
      if (token !== session.token) return;
      paintPhotosNote(book);
    } catch (error) {
      if (token !== session.token) return;
      session.error = error;
      session.book = null;
      paintError(error);
    } finally {
      if (token === session.token) setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- saving */

  async function save() {
    if (!session.book || session.busy || !canSave(session.decision)) return;
    setBusy(true, 'Making your book…');
    try {
      const pages = [...preview.querySelectorAll('svg')].map((svg) => svg.outerHTML);
      const result = await shell.book.save({ fileName: session.book.fileName, pages });
      if (result?.canceled) return;
      if (!result?.path) {
        status.textContent = result?.error || 'That book could not be saved.';
        return;
      }

      // Only a save that actually happened counts against the soft allowance (docs/premium.md);
      // a Locked decision never reaches here because Save is disabled for it.
      const usage = hooks.getSettings()?.bookUsage ?? {};
      await hooks.setBookUsage(nextBookUsage(usage, 'book.export'));

      const fileName = session.book.fileName;
      const path = result.path;
      dialog.close();
      hooks.onSaved(fileName, path);
    } catch (error) {
      status.textContent = `That book could not be saved. ${error?.message ?? ''}`.trim();
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- opening and closing */

  /** @param {string|null} scopePersonId  set when opened as "Family book from {name}" */
  async function open(scopePersonId = null) {
    if (dialog.open) return;
    const doc = hooks.getDocument();
    // The toolbar, the menu and the person panel all grey their own entry point on an empty tree;
    // this is the same rule enforced a second time, for whatever reaches here despite that.
    if (!doc || !doc.people?.length) return;

    await ensureAssets();

    session.doc = doc;
    session.scopePersonId = scopePersonId;
    session.scopePersonName = scopePersonId ? hooks.personName(scopePersonId) : null;
    // Every opening starts on the catalogue's choice for the day -- the festival in season, else
    // the first template -- the same rule the Android screen follows.
    session.templates = offered(todayIso());
    session.options = {
      ...DEFAULT_OPTIONS,
      templateId: session.templates[0]?.id ?? null,
      scopeKind: scopePersonId ? 'branch' : 'everyone',
    };
    session.error = null;
    session.derivedFeaturedId = null;
    refreshStoryGraph();

    paintWho();
    photosCheck.checked = session.options.photos;
    livingCheck.checked = session.options.livingDates;
    notesCheck.checked = session.options.notes;
    storyHint.hidden = true;
    decisionNote.hidden = true;
    status.textContent = '';
    preview.replaceChildren();

    dialog.showModal();
    head.focus();
    await recompute({ immediate: true });
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    clearTimeout(debounceTimer);
    session.token += 1; // any recompute still in flight is now stale and paints nothing
    session.doc = null;
    session.book = null;
    session.story.scopeGraph = null;
    session.story.graph = null;
    session.story.allowanceKey = undefined;
    closeStoryList();
    preview.replaceChildren();
    templatesBox.replaceChildren();
  });

  /* ---------------------------------------------------------------- wiring */

  cancelButton.addEventListener('click', close);
  saveButton.addEventListener('click', save);

  titleInput.addEventListener('input', () => {
    session.options.titleOverride = titleInput.value;
    titleReset.hidden = false;
    scheduleRecompute();
  });
  titleReset.addEventListener('click', () => {
    session.options.titleOverride = null;
    titleInput.value = session.derivedTitle;
    titleReset.hidden = true;
    scheduleRecompute();
    titleInput.focus();
  });

  for (const button of whoBox.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      if (session.options.scopeKind === button.dataset.scope) return;
      session.options.scopeKind = button.dataset.scope;
      // The scope just changed who "Whose story" may offer at all -- rebuild before anything else
      // touches the picker, so a stale search never outlives the scope it was run against.
      refreshStoryGraph();
      paintWho();
      paintStoryValue();
      scheduleRecompute();
    });
  }

  photosCheck.addEventListener('change', () => {
    session.options.photos = photosCheck.checked;
    scheduleRecompute();
  });
  livingCheck.addEventListener('change', () => {
    session.options.livingDates = livingCheck.checked;
    scheduleRecompute();
  });
  notesCheck.addEventListener('change', () => {
    session.options.notes = notesCheck.checked;
    scheduleRecompute();
  });

  /*
   * "Whose story": an editable combobox over `searchPeople` (`site/playground/search.js`), built to
   * the WAI-ARIA "combobox with list autocomplete" pattern -- `role="combobox"` on the input itself
   * rather than a wrapping element, `aria-expanded`/`aria-activedescendant` kept in step with the
   * highlighted option, arrow keys move the highlight, Enter picks it, Escape closes the list
   * without touching the dialog underneath it.
   */
  storyInput.addEventListener('input', () => {
    const query = storyInput.value.trim();
    if (!query || !session.story.graph) { closeStoryList(); return; }
    paintStoryResults(searchPeople(session.story.graph, query, 8));
  });

  storyInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (storyResults.hidden) {
        const query = storyInput.value.trim();
        if (query && session.story.graph) paintStoryResults(searchPeople(session.story.graph, query, 8));
      } else {
        moveStoryActive(1);
      }
    } else if (event.key === 'ArrowUp') {
      if (!storyResults.hidden) { event.preventDefault(); moveStoryActive(-1); }
    } else if (event.key === 'Enter') {
      if (!storyResults.hidden && session.story.activeIndex >= 0) {
        event.preventDefault();
        const person = session.story.results[session.story.activeIndex];
        if (person) pickStoryPerson(person);
      }
    } else if (event.key === 'Escape' && !storyResults.hidden) {
      // Closes the list only. A second Escape reaches the dialog's own Escape-to-cancel, same as
      // it would from any other field in this dialog.
      event.preventDefault();
      event.stopPropagation();
      closeStoryList();
    }
  });

  // A blur that lands back inside this control -- typically a click on one of its own option
  // buttons -- is not "the reader left the field", so only a focus that actually leaves closes it.
  // `paintStoryValue` puts the input's text back in step with the real selection: leaving behind a
  // typed query that was never picked (no match wanted, or the reader just moved on) must not go
  // on looking like a choice the composer never actually made.
  storyPicker.addEventListener('focusout', (event) => {
    if (!storyPicker.contains(event.relatedTarget)) {
      closeStoryList();
      paintStoryValue();
    }
  });

  storyReset.addEventListener('click', () => {
    session.options.featured = null;
    closeStoryList();
    paintStoryValue();
    scheduleRecompute();
    storyInput.focus();
  });

  return { open, close, get isOpen() { return dialog.open; } };
}
