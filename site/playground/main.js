/*
 * The viewer's wiring.
 *
 * Nothing here is asynchronous beyond reading the file the user hands over: no fetch of their data,
 * no telemetry, no persistence of anything but four display preferences. The whole point of the
 * page is that a family archive can be put on a big screen without it leaving the device, and that
 * is only worth saying if the code makes it obviously true.
 */

import { readTreeFile, ArchiveError, canDecompress } from './archive.js';
import {
  buildGraph, relationsOf, relate, displayName, displayDate, lifespan, initials, ageOf,
} from './model.js';
import { layoutArchive } from './layout.js';
import { Chart } from './chart.js';

const $ = (id) => document.getElementById(id);

const viewer = $('viewer');
const state = {
  graph: null,
  layout: null,
  archive: null,
  fileName: '',
  selected: null,
  view: 'chart',
  relateA: null,
  relateB: null,
  photoUrls: new Map(),
};

const prefs = loadPrefs();
const chart = new Chart($('canvas'), {
  onSelect: (id) => select(id, { centre: false }),
  onHover: () => {},
  onViewChange: updateZoomReadout,
});

/* ------------------------------------------------------------------ preferences */

function loadPrefs() {
  const fallback = { theme: 'light', photos: true, big: false, status: true };
  try {
    const saved = JSON.parse(localStorage.getItem('ftree.viewer') ?? '{}');
    return { ...fallback, ...saved };
  } catch {
    return fallback;   // private windows and blocked storage both land here; defaults are fine
  }
}

function savePrefs() {
  try {
    localStorage.setItem('ftree.viewer', JSON.stringify(prefs));
  } catch { /* storage is a convenience here, never a requirement */ }
}

function applyPrefs() {
  viewer.dataset.theme = prefs.theme;
  viewer.dataset.big = String(prefs.big);
  viewer.dataset.status = prefs.status ? 'on' : 'off';
  chart.setTheme(prefs.theme);
  chart.showPhotos = prefs.photos;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', prefs.theme === 'dark' ? '#10150f' : '#f7f6f1');
  for (const [key, on] of Object.entries({
    theme: prefs.theme === 'dark', photos: prefs.photos, big: prefs.big, status: prefs.status,
  })) {
    $('display-menu').querySelector(`[data-toggle="${key}"]`)?.setAttribute('aria-checked', String(on));
  }
  chart.resize();
}

/* ------------------------------------------------------------------ loading a file */

function showBusy(on) { $('busy').hidden = !on; }

function showOpenerError(message) {
  const box = $('opener-error');
  box.textContent = message;
  box.hidden = false;
}

async function openFile(file) {
  $('opener-error').hidden = true;
  showBusy(true);
  // Yield once so the spinner actually paints before a large file blocks the thread.
  await new Promise((r) => setTimeout(r, 16));
  try {
    const { document: doc, archive } = await readTreeFile(file);
    const graph = buildGraph(doc);
    if (graph.people.size === 0) {
      throw new ArchiveError('That file parsed, but it has no people in it.');
    }
    const layout = layoutArchive(graph);

    releasePhotos();
    state.graph = graph;
    state.layout = layout;
    state.archive = archive;
    state.fileName = file.name || 'tree.ftree';
    state.selected = null;
    state.relateA = null;
    state.relateB = null;

    chart.load(graph, layout, archive);
    viewer.dataset.state = 'loaded';
    setView('chart');
    $('file-name').textContent = state.fileName;
    renderStatus();
    renderIndex();
    closePanels();
    frameOnLoad();
  } catch (error) {
    const message = error instanceof ArchiveError
      ? error.message
      : `That file could not be read. ${error.message ?? ''}`.trim();
    if (viewer.dataset.state === 'loaded') showHint(message, 6000);
    else showOpenerError(message);
  } finally {
    showBusy(false);
  }
}

/**
 * Chooses the opening view.
 *
 * Fitting a whole archive on screen is the right first sight of a family of forty. For a family of
 * two thousand it is a grey smear, so past the point where a card would be too small to mean
 * anything the chart opens at a readable scale on the largest family instead, and says so.
 */
function frameOnLoad() {
  const fitScale = chart.fitScale();
  if (fitScale >= 0.26) {
    chart.fit();
    const groups = state.layout.groups.length;
    showHint(groups > 1
      ? `${state.graph.people.size} people in ${groups} groups. Tap anyone to see how they connect.`
      : 'Tap anyone to see how they connect.', 5200);
  } else {
    const biggest = state.layout.groups.find((g) => g.kind === 'family') ?? state.layout.groups[0];
    const first = biggest?.members?.[0];
    chart.scale = 0.62;
    if (first) chart.centreOn(first, 0.62);
    // True of a huge archive on a television and of a modest one on a phone, which is the point:
    // what has run out is legible screen, and blaming the file for that would be misleading.
    showHint('More people here than fit legibly on this screen. Search for a name, or use Fit to '
      + 'see the whole shape.', 8000);
  }
  updateZoomReadout();
}

function releasePhotos() {
  for (const url of state.photoUrls.values()) URL.revokeObjectURL(url);
  state.photoUrls.clear();
}

function closeFile() {
  releasePhotos();
  state.graph = null;
  state.layout = null;
  state.archive = null;
  state.selected = null;
  chart.layout = null;
  chart.invalidate();
  viewer.dataset.state = 'empty';
  closePanels();
  $('search').value = '';
  $('opener-error').hidden = true;
}

/* ------------------------------------------------------------------ selection */

function select(id, { centre = true, quiet = false } = {}) {
  if (!state.graph) return;
  if (!id) {
    state.selected = null;
    chart.selected = null;
    chart.related = null;
    chart.invalidate();
    $('panel').hidden = true;
    return;
  }
  state.selected = id;
  chart.selected = id;
  chart.pathIds = null;

  // Everyone one step away stays at full strength; the rest fade, which is what makes a person
  // findable in a chart with two thousand cards on it.
  const near = new Set([id]);
  for (const p of state.graph.parents(id)) near.add(p.id);
  for (const c of state.graph.children(id)) near.add(c.id);
  for (const s of state.graph.spouses(id)) near.add(s.id);
  for (const s of state.graph.siblings(id)) near.add(s.id);
  chart.related = near;

  if (centre && state.view === 'chart') chart.centreOn(id, Math.max(chart.scale, 0.7));
  chart.invalidate();
  renderPanel(id);
  if (!quiet) $('relate').hidden = true;
}

/* ------------------------------------------------------------------ the person panel */

function photoUrl(person) {
  if (!person.photo || !state.archive?.has(person.photo)) return null;
  if (state.photoUrls.has(person.photo)) return state.photoUrls.get(person.photo);
  const placeholder = null;
  state.photoUrls.set(person.photo, placeholder);
  state.archive.read(person.photo).then((bytes) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    state.photoUrls.set(person.photo, url);
    if (state.selected && state.graph.people.get(state.selected)?.photo === person.photo) {
      renderPanel(state.selected);
    }
  }).catch(() => {});
  return placeholder;
}

function nameHtml(person) {
  return person.name ? escape(person.name) : '<em>Unknown</em>';
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function renderPanel(id) {
  const person = state.graph.people.get(id);
  if (!person) return;
  const body = $('panel-body');
  const groups = relationsOf(state.graph, id);
  const node = state.layout.byId.get(id);
  const url = photoUrl(person);
  const age = ageOf(person);

  const facts = [];
  if (person.birthDate) facts.push(['Born', escape(displayDate(person.birthDate) ?? person.birthDate)]);
  if (person.deathDate) facts.push(['Died', escape(displayDate(person.deathDate) ?? person.deathDate)]);
  if (age !== null) facts.push([person.deceased ? 'Lived' : 'Age', `${age} years`]);
  if (person.gender && person.gender !== 'UNSPECIFIED') {
    facts.push(['Gender', escape(person.gender[0] + person.gender.slice(1).toLowerCase())]);
  }
  if (node && !node.isolated) facts.push(['Generation', `${node.level + 1}`]);
  if (person.origins) facts.push(['Origins', `${person.origins} imported record${person.origins === 1 ? '' : 's'}`]);

  const alone = groups.length === 0;

  body.innerHTML = `
    <div class="p-head">
      ${url
        ? `<img class="p-photo" src="${url}" alt="">`
        : `<div class="p-photo blank${person.name ? '' : ' unknown'}" aria-hidden="true">${escape(initials(person))}</div>`}
      <div>
        <h2 class="p-name" id="panel-name">${nameHtml(person)}</h2>
        ${lifespan(person) ? `<p class="p-when">${escape(lifespan(person))}</p>` : ''}
      </div>
    </div>

    ${alone ? `<p class="p-alone">No relationship to anyone else is recorded yet. The app cannot
      draw this person at all; here they are, waiting for a connection.</p>` : ''}

    ${facts.length ? `<dl class="p-facts">${facts
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}

    ${person.notes ? `<p class="p-notes">${escape(person.notes)}</p>` : ''}

    ${groups.map((group) => `
      <div class="p-group">
        <h3>${group.heading}</h3>
        <ul class="p-rel">${group.items.map((item) => `
          <li><button type="button" data-goto="${escape(item.id)}">
            <span>${nameHtml(state.graph.people.get(item.id))}</span>
            <span class="kind">${escape(item.label)}</span>
          </button></li>`).join('')}
        </ul>
      </div>`).join('')}

    <div class="p-actions">
      <button type="button" class="tool" data-action="centre">Centre on this person</button>
      <button type="button" class="tool" data-action="relate-from">Relate to someone</button>
    </div>
  `;

  $('panel').hidden = false;
  $('panel').scrollTop = 0;
}

/* ------------------------------------------------------------------ search */

function searchPeople(query, limit = 14) {
  if (!state.graph) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const person of state.graph.people.values()) {
    const name = person.name?.toLowerCase() ?? '';
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (name.includes(q)) rank = 1;
    else if (!person.name && ('unknown'.startsWith(q) || 'unnamed'.startsWith(q))) rank = 2;
    else if ((person.birthDate ?? '').startsWith(q) || (person.deathDate ?? '').startsWith(q)) rank = 3;
    if (rank >= 0) hits.push({ person, rank });
  }
  hits.sort((a, b) => a.rank - b.rank
    || (a.person.name ?? '').localeCompare(b.person.name ?? ''));
  return hits.slice(0, limit).map((h) => h.person);
}

function renderResults(listEl, people, onPick) {
  if (!people.length) {
    listEl.innerHTML = '<li class="row-none">Nobody by that name in this file.</li>';
    listEl.hidden = false;
    return;
  }
  listEl.innerHTML = people.map((person) => `
    <li><button type="button" data-id="${escape(person.id)}">
      ${nameHtml(person)}<span class="row-dates">${escape(lifespan(person))}</span>
    </button></li>`).join('');
  listEl.hidden = false;
  listEl.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => onPick(button.dataset.id));
  });
}

function wireSearch() {
  const input = $('search');
  const list = $('search-results');

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };

  input.addEventListener('input', () => {
    const query = input.value;
    if (state.view === 'index') { renderIndex(query); close(); return; }
    const found = searchPeople(query);
    chart.matches = query.trim() ? new Set(found.map((p) => p.id)) : null;
    chart.invalidate();
    if (!query.trim()) { close(); return; }
    renderResults(list, found, (id) => { input.value = ''; close(); chart.matches = null; select(id); });
    input.setAttribute('aria-expanded', 'true');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; chart.matches = null; chart.invalidate(); close(); input.blur(); }
    if (e.key === 'Enter') {
      const first = list.querySelector('button');
      if (first) first.click();
    }
    if (e.key === 'ArrowDown') { list.querySelector('button')?.focus(); e.preventDefault(); }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) close();
  });
}

/* ------------------------------------------------------------------ relate */

function wireRelate() {
  for (const slot of ['a', 'b']) {
    const input = $(`relate-${slot}`);
    const list = $(`relate-${slot}-results`);
    input.addEventListener('input', () => {
      if (!input.value.trim()) { list.hidden = true; return; }
      renderResults(list, searchPeople(input.value, 8), (id) => {
        state[slot === 'a' ? 'relateA' : 'relateB'] = id;
        input.value = displayName(state.graph.people.get(id));
        list.hidden = true;
        renderRelation();
      });
    });
    input.addEventListener('focus', () => { input.select(); });
  }
}

function renderRelation() {
  const box = $('relate-answer');
  const { relateA: a, relateB: b } = state;
  if (!a || !b) { box.innerHTML = ''; chart.pathIds = null; chart.invalidate(); return; }

  const from = state.graph.people.get(a);
  const to = state.graph.people.get(b);
  const result = relate(state.graph, a, b);

  if (result.kind === 'same') {
    box.innerHTML = '<p class="r-term r-none">Those are the same person.</p>';
    return;
  }
  if (result.kind === 'none' || !result.path) {
    box.innerHTML = `<p class="r-term r-none">Nothing in this file connects
      <b>${nameHtml(from)}</b> to <b>${nameHtml(to)}</b>. They may still be related — the record
      simply does not say how.</p>`;
    chart.pathIds = null;
    chart.invalidate();
    return;
  }

  /*
   * Two sentences, because a relationship with no blood in it cannot be said the same way. Where
   * there is a shared ancestor there is a word for it. Where there is not, a short chain still
   * reads as one - "wife's mother" is how a family actually says it - and only a long way round
   * falls back to counting steps.
   */
  const steps = result.path.length;
  let sentence;
  if (result.term) {
    sentence = `${nameHtml(to)} is ${nameHtml(from)}'s <b>${escape(result.term)}</b>.`;
  } else if (steps <= 3) {
    const chain = result.path.map((step) => escape(step.label)).join("'s ");
    sentence = `${nameHtml(to)} is ${nameHtml(from)}'s <b>${chain}</b> — no blood relation in this file.`;
  } else {
    sentence = `${nameHtml(to)} and ${nameHtml(from)} are connected only through marriage or `
      + `adoption, <b>${steps} steps</b> apart, with no ancestor in common in this file.`;
  }

  box.innerHTML = `
    <p class="r-term">${sentence}</p>
    <ol class="r-chain">
      <li><span class="step">start</span><span class="who">${nameHtml(from)}</span></li>
      ${result.path.map((step) => `
        <li>
          <span class="step">${escape(step.label)}</span>
          <span class="who"><button type="button" class="link-btn" data-goto="${escape(step.id)}"
            >${nameHtml(state.graph.people.get(step.id))}</button></span>
        </li>`).join('')}
    </ol>`;

  // Light the chain up on the chart, and frame both ends of it.
  chart.pathIds = new Set([a, ...result.path.map((s) => s.id)]);
  chart.related = chart.pathIds;
  chart.selected = null;
  chart.invalidate();
  if (state.view === 'chart') chart.centreOn(a, Math.max(chart.scale, 0.5));
}

function openRelate(seed) {
  $('panel').hidden = true;
  $('relate').hidden = false;
  if (seed) {
    state.relateA = seed;
    $('relate-a').value = displayName(state.graph.people.get(seed));
    $('relate-b').focus();
  } else {
    $('relate-a').focus();
  }
  renderRelation();
}

/* ------------------------------------------------------------------ the index view */

/** One line saying who a person is to everybody else, for scanning rather than for study. */
function buildSummary(groups) {
  const named = (item) => nameHtml(state.graph.people.get(item.id));

  // Commas and a final "and", then a count once a list stops being worth reading in full.
  const list = (items) => {
    const shown = items.slice(0, 3).map(named);
    const rest = items.length - shown.length;
    if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
    if (shown.length === 1) return shown[0];
    return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  };

  // One relative can be named exactly - Mother, Wife - but a group of them needs the plural, or a
  // mother ends up filed under "Father" because she happened to be listed second.
  const heading = (group) => {
    if (group.items.length === 1) return group.items[0].label;
    return { Parents: 'Parents', Partners: 'Partners', Siblings: 'Siblings', Children: 'Children' }[group.heading];
  };

  return groups
    .map((group) => `<b>${escape(heading(group))}</b>: ${list(group.items)}`)
    .join(' &nbsp;·&nbsp; ');
}

function renderIndex(query = '') {
  if (!state.graph) return;
  const list = $('index-list');
  const q = query.trim().toLowerCase();
  const match = (person) => !q
    || (person.name ?? 'unknown').toLowerCase().includes(q)
    || (person.birthDate ?? '').includes(q);

  const html = [];
  let shown = 0;

  for (const group of state.layout.groups) {
    const members = group.members
      .map((id) => state.graph.people.get(id))
      .filter(match)
      .sort((a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿'));
    if (!members.length) continue;

    html.push(`<li class="index-group">${group.kind === 'isolated'
      ? `Not connected to anyone · ${group.count} ${group.count === 1 ? 'person' : 'people'}`
      : `A family of ${group.count} · ${group.generations} generation${group.generations === 1 ? '' : 's'}`}</li>`);

    for (const person of members) {
      shown++;
      html.push(`<li><button type="button" class="index-row" data-goto="${escape(person.id)}">
        <span>
          <span class="who">${nameHtml(person)}</span><br>
          <span class="when">${escape(lifespan(person)) || '&nbsp;'}</span>
        </span>
        <span class="how">${buildSummary(relationsOf(state.graph, person.id))
          || '<span class="none">No recorded relatives</span>'}</span>
      </button></li>`);
    }
  }

  list.innerHTML = html.join('');
  $('index-note').innerHTML = q
    ? `${shown} of ${state.graph.people.size} people match “${escape(query)}”.`
    : `Every person in the file, grouped by the families the relationships actually form. `
      + `Unlike the app's chart, nobody is left out for being unconnected.`;
}

/* ------------------------------------------------------------------ status */

function renderStatus() {
  const g = state.graph;
  const unnamed = [...g.people.values()].filter((p) => !p.name).length;
  const families = state.layout.groups.filter((x) => x.kind === 'family').length;
  const generations = Math.max(...state.layout.bands.map((b) => b.level + 1), 1);

  const count = (n, one, many) => `<b>${n}</b> ${n === 1 ? one : many}`;

  const bits = [
    count(g.people.size, 'person', 'people'),
    count(g.edges.length, 'connection', 'connections'),
  ];
  // With nobody connected to anybody there are no families and no depth to report, and printing
  // "0 families - 1 generation deep" says less than nothing.
  if (families) {
    bits.push(count(families, 'family', 'families'));
    bits.push(`${count(generations, 'generation', 'generations')} deep`);
  }
  if (unnamed) bits.push(`<b>${unnamed}</b> without a name`);
  if (g.isolated.length) bits.push(`<span class="warn"><b>${g.isolated.length}</b> with no relatives recorded</span>`);
  if (g.droppedEdges) bits.push(`<span class="warn">${g.droppedEdges} unreadable connections skipped</span>`);

  $('counts').innerHTML = bits.join('<span class="sep">·</span>');
}

/* ------------------------------------------------------------------ chrome */

let hintTimer = null;
function showHint(text, ms = 4000) {
  const hint = $('hint');
  hint.textContent = text;
  hint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hint.hidden = true; }, ms);
}

function updateZoomReadout() {
  $('zoom-level').textContent = `${Math.round(chart.scale * 100)}%`;
}

function setView(view) {
  state.view = view;
  viewer.dataset.view = view;
  $('index').hidden = view !== 'index';
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  });
  $('search').placeholder = view === 'index' ? 'Filter this list' : 'Search people';
  if (view === 'index') renderIndex($('search').value);
  else { chart.resize(); chart.invalidate(); }
}

function closePanels() {
  $('panel').hidden = true;
  $('relate').hidden = true;
  $('shortcuts').hidden = true;
  $('display-menu').hidden = true;
  $('display-btn').setAttribute('aria-expanded', 'false');
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else viewer.requestFullscreen?.().catch(() => showHint('This browser would not go full screen.'));
}

/* ------------------------------------------------------------------ events */

function wireChrome() {
  $('choose').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) openFile(file);
    e.target.value = '';
  });
  $('close-file').addEventListener('click', closeFile);

  $('sample').addEventListener('click', async () => {
    showBusy(true);
    try {
      const response = await fetch('sample-family.ftree');
      if (!response.ok) throw new Error(`${response.status}`);
      const blob = await response.blob();
      await openFile(new File([blob], 'sample-family.ftree'));
    } catch {
      showOpenerError('The sample file could not be loaded. Check your connection, or open your own export.');
    } finally {
      showBusy(false);
    }
  });

  // Drag and drop over the whole page, not only the dashed box.
  const drop = $('drop');
  let dragDepth = 0;
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    drop?.classList.add('over');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; drop?.classList.remove('over'); }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    drop?.classList.remove('over');
    const file = e.dataTransfer?.files?.[0];
    if (file) openFile(file);
  });

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  $('zoom-in').addEventListener('click', () => chart.zoomBy(1.3));
  $('zoom-out').addEventListener('click', () => chart.zoomBy(1 / 1.3));
  $('fit').addEventListener('click', () => { chart.fit(); updateZoomReadout(); });

  $('relate-btn').addEventListener('click', () => {
    if ($('relate').hidden) openRelate(state.selected);
    else $('relate').hidden = true;
  });
  $('relate-close').addEventListener('click', () => {
    $('relate').hidden = true;
    chart.pathIds = null;
    chart.related = null;
    chart.invalidate();
  });
  $('panel-close').addEventListener('click', () => select(null));
  $('shortcuts-close').addEventListener('click', () => { $('shortcuts').hidden = true; });

  const menu = $('display-menu');
  $('display-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    $('display-btn').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) {
      menu.hidden = true;
      $('display-btn').setAttribute('aria-expanded', 'false');
    }
  });

  menu.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const toggle = button.dataset.toggle;
    if (toggle === 'theme') prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
    else if (toggle) prefs[toggle] = !prefs[toggle];
    if (button.dataset.action === 'fullscreen') toggleFullscreen();
    if (button.dataset.action === 'shortcuts') { $('shortcuts').hidden = false; menu.hidden = true; }
    if (toggle) { savePrefs(); applyPrefs(); }
  });

  // One delegated handler covers every "jump to this person" link in every panel.
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) {
      if (state.view === 'index') setView('chart');
      select(goto.dataset.goto);
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'centre' && state.selected) chart.centreOn(state.selected, Math.max(chart.scale, 1));
    if (action === 'relate-from') openRelate(state.selected);
  });

  window.addEventListener('resize', () => chart.resize());
  document.addEventListener('fullscreenchange', () => chart.resize());
}

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

    if (e.key === 'Escape') {
      if (!$('shortcuts').hidden) { $('shortcuts').hidden = true; return; }
      if (!$('relate').hidden) { $('relate').hidden = true; chart.pathIds = null; chart.related = null; chart.invalidate(); return; }
      if (!$('panel').hidden) { select(null); return; }
      if (typing) e.target.blur();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (viewer.dataset.state !== 'loaded') return;

    switch (e.key) {
      case '/':
        e.preventDefault();
        $('search').focus();
        break;
      case 'f': case 'F':
        chart.fit();
        updateZoomReadout();
        break;
      case '+': case '=':
        chart.zoomBy(1.3);
        break;
      case '-': case '_':
        chart.zoomBy(1 / 1.3);
        break;
      case 'd': case 'D':
        prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
        savePrefs();
        applyPrefs();
        break;
      case 'i': case 'I':
        setView(state.view === 'chart' ? 'index' : 'chart');
        break;
      case 'r': case 'R':
        openRelate(state.selected);
        break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (state.view !== 'chart') return;
        e.preventDefault();
        const step = e.shiftKey ? 320 : 120;
        chart.panBy(
          e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0,
          e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
        );
        break;
      }
      case 'Tab': {
        // Steps through people in reading order, which is the only sane traversal of a canvas.
        if (state.view !== 'chart') return;
        e.preventDefault();
        const ordered = [...state.layout.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
        const at = ordered.findIndex((n) => n.id === state.selected);
        const next = ordered[(at + (e.shiftKey ? -1 : 1) + ordered.length) % ordered.length]
          ?? ordered[0];
        if (next) select(next.id);
        break;
      }
      default:
        break;
    }
  });
}

/* ------------------------------------------------------------------ start */

if (!canDecompress) {
  showOpenerError('This browser cannot unzip files on its own, so it cannot open a .ftree here. '
    + 'A current Chrome, Safari, Firefox or Edge can.');
  $('choose').disabled = true;
  $('sample').disabled = true;
}

wireChrome();
wireSearch();
wireRelate();
wireKeys();
applyPrefs();

// Canvas text is measured against the real faces, so the first paint waits for them.
document.fonts?.ready.then(() => chart.invalidate());

// A file can be handed over by the OS share sheet or a launch handler on some platforms.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer((launch) => {
    if (launch.files?.length) launch.files[0].getFile().then(openFile);
  });
}
