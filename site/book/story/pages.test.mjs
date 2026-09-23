/*
 * The page-archetype dispatch (site/book/story/pages/) and the storybook template the wave-3
 * issues compose against.
 *
 * The archetypes themselves are #256-#258, each with its own tests; what is checked here is the
 * contract the three share - that every archetype the planner can ask for has a home, that the
 * composer refuses by name until they all do, and that the shared template is a template.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { composeBook, DRAWABLE_FORMATS, missingArchetypes } from '../compose.js';
import { PAGES } from './pages/index.js';
import * as hero from './pages/hero.js';
import * as family from './pages/family.js';
import * as lists from './pages/lists.js';
import { VARIANTS, CHAPTERS, planStory } from './plan.js';
import { kinOf } from './kin.js';
import { resolveFeatured } from './featured.js';
import { readFamily } from '../family.js';
import { validateTemplate, PAPERCUT_PALETTE_KEYS, HAND_FONT_KEY } from '../template.js';
import { STORY_TEMPLATE } from '../qa/story-template.mjs';
import { loadFixture, NOW } from '../qa/book-fixtures.mjs';

/* ------------------------------------------------------------------ the dispatch */

test('every archetype the planner can ask for is owned by exactly one module', () => {
  const owners = { hero: Object.keys(hero.PAGES), family: Object.keys(family.PAGES), lists: Object.keys(lists.PAGES) };
  const seen = new Map();
  for (const [module, ids] of Object.entries(owners)) {
    for (const id of ids) {
      assert.ok(!seen.has(id), `${id} is drawn by both ${seen.get(id)}.js and ${module}.js`);
      seen.set(id, module);
      assert.ok(Object.hasOwn(VARIANTS, id), `${module}.js draws "${id}", which story/plan.js never asks for`);
      assert.equal(typeof PAGES[id], 'function', `${id} is not in the dispatch`);
    }
  }
  assert.equal(Object.keys(PAGES).length, seen.size, 'the dispatch holds an archetype no module claims');
});

test('missingArchetypes is what the planner asks for minus what is built', () => {
  assert.deepEqual(missingArchetypes({}), Object.keys(VARIANTS), 'with nothing built, every archetype is missing');
  const all = Object.fromEntries(Object.keys(VARIANTS).map((a) => [a, () => ({ label: a, items: [] })]));
  assert.deepEqual(missingArchetypes(all), [], 'with everything built, none is');
  delete all.register;
  assert.deepEqual(missingArchetypes(all), ['register']);
});

test('format 2 becomes drawable exactly when the last archetype lands', () => {
  // No issue flips a flag by hand: this is the flag, and #245's invariant suite reads it.
  assert.deepEqual([...DRAWABLE_FORMATS], missingArchetypes().length ? [1] : [1, 2]);
  assert.ok(DRAWABLE_FORMATS.includes(1), 'Heirloom never stops being drawable');
});

/** What a real book of this fixture would be made of: its plan, and the archetypes it needs. */
async function plannedArchetypes(fixture) {
  const doc = await loadFixture(fixture);
  const family = readFamily(doc, { now: NOW });
  const plan = planStory(kinOf(family, resolveFeatured(family, {})), validateTemplate(STORY_TEMPLATE), family);
  return { plan, archetypes: [...new Set(plan.pages.map((p) => p.archetype))] };
}

test('a storybook page nobody has drawn yet is refused by name, not printed empty', async (t) => {
  if (!missingArchetypes().length) return t.skip('every archetype is built: the composer draws the storybook now');
  const doc = await loadFixture('story-eldest');
  const { plan, archetypes } = await plannedArchetypes('story-eldest');
  assert.throws(() => composeBook(doc, { now: NOW }, STORY_TEMPLATE), (e) => {
    assert.match(e.message, /"diwali-story" is a format-2 storybook template/);
    assert.ok(e.message.includes(`its ${plan.pages.length} pages are planned`), e.message);
    // Every archetype this book needs and nobody has built is named, and nothing else is.
    for (const a of archetypes) {
      const named = new RegExp(`\\b${a}\\b`).test(e.message);
      assert.equal(named, !PAGES[a], `${a}: ${named ? 'named although it is built' : 'built nothing and went unnamed'}`);
    }
    return true;
  });
});

test('coverOnly draws the cover alone, and so needs only the cover to exist', async (t) => {
  if (!missingArchetypes().length) return t.skip('every archetype is built');
  const doc = await loadFixture('story-eldest');
  const whole = (() => { try { composeBook(doc, { now: NOW }, STORY_TEMPLATE); return ''; } catch (e) { return e.message; } })();
  const cover = (() => { try { composeBook(doc, { now: NOW, coverOnly: true }, STORY_TEMPLATE); return ''; } catch (e) { return e.message; } })();
  if (!cover) return;   // the cover archetype exists: coverOnly drew it, which is the point
  assert.ok(cover.length < whole.length, 'coverOnly still asks for every archetype the whole book would');
  assert.match(cover, /\bcover\b/);
  assert.ok(!/\bregister\b/.test(cover), 'coverOnly asked for the register');
});

/* ------------------------------------------------------------------ the shared template */

test('the shared storybook template is a valid format-2 template', () => {
  const t = validateTemplate(STORY_TEMPLATE);
  assert.equal(t.format, 2);
  assert.equal(t.id, 'diwali-story');
  assert.equal(t.art, 'papercut');
  assert.deepEqual(Object.keys(t.palette).sort(), [...PAPERCUT_PALETTE_KEYS].sort());
  assert.equal(t.fonts.hand, HAND_FONT_KEY, 'the hand role is Kalam, and only the hand role is');
  assert.equal(t.cover.greeting, 'शुभ दीपावली');
});

test('it carries every chapter the planner knows, in the story\'s order', () => {
  assert.deepEqual(validateTemplate(STORY_TEMPLATE).story.chapters, [...CHAPTERS]);
});

test('its copy names only chapters it lists, and every chapter but the cover has a title', () => {
  const t = validateTemplate(STORY_TEMPLATE);
  for (const chapter of Object.keys(t.copy)) {
    assert.ok(t.story.chapters.includes(chapter), `copy.${chapter} is not a chapter`);
    assert.ok(t.copy[chapter].title, `copy.${chapter} has no title`);
  }
  for (const chapter of t.story.chapters) {
    if (chapter === 'cover') continue;   // the cover's words are `cover`, not `copy.cover`
    assert.ok(t.copy[chapter], `no copy for the "${chapter}" chapter`);
  }
});
