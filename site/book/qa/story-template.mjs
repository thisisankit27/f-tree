/*
 * The storybook template every wave-3 test composes against.
 *
 * The real template ships as `templates/diwali-story.json` when there is something to ship: a file
 * in `templates/` must be in the catalogue (`catalog.test.mjs`), and a catalogue entry at format 2
 * must be drawable (`invariants.test.mjs`), so the template arrives with the last archetype, not
 * before it. Until then this is the same document, in one place, so that the archetype issues
 * (#256-#258) all draw against the same palette, chapters and copy instead of three inline
 * near-copies that drift.
 *
 * The palette is the one the approved style frames were rendered from
 * (`art/style-frames/motifs.mjs`), which is what `docs/book-design-system.md` documents and what
 * `art/src/papercut/swatches.json` maps authoring colours onto. The copy is the story sequence in
 * `docs/storybook-plan.md`. #259 owns the final wording when Diwali swaps over.
 *
 * Test-only: nothing the composer imports may reach this file.
 */

/** The 29 paper-cut palette tokens, at the approved frames' own colours. */
export const PAPERCUT_PALETTE = Object.freeze({
  paper: '#f6ecda', paperDeep: '#ead7b5', card: '#fff8ec',
  ink: '#2a1a33', inkSoft: '#5e4a66',
  night: '#1f1840', deep: '#17122e', glow: '#3a2352', dusk: '#7a3e63', haze: '#5a3462',
  gold: '#f2b84b', flame: '#ffe7a6', brass: '#b9822a',
  marigold: '#f2a71b', saffron: '#e8762b', sindoor: '#c23b2e', rani: '#d6336c',
  peacock: '#0f7b7a', indigo: '#3b4a8c', leaf: '#5a8a3c', leafDeep: '#2f5a2a',
  stone: '#d9a77a', clay: '#b5562a', skin: '#b97a52', silver: '#d9d2ca',
  sky: '#f3ddb8', wash: '#6f93c7', dayHaze: '#e9b777', dayMid: '#d99a62',
});

/**
 * The storybook template as a template document (not yet validated), every chapter the planner
 * knows, in the story's order.
 *
 * `{featured}`, `{featured-first}`, `{family}`, `{n}` and `{year}` are the only placeholders a
 * template may use, and a line that has no fact to fill one drops the clause rather than printing
 * a gap (`copy.js`'s `renderCopy`). A `line` written as `{ one, other }` picks by `{n}`.
 */
export const STORY_TEMPLATE = Object.freeze({
  format: 2,
  id: 'diwali-story',
  name: 'Diwali, the storybook',
  fileSuffix: 'Diwali Book',
  art: 'papercut',
  fonts: { display: 'book_display', text: 'book_text', strong: 'book_strong', hand: 'book_hand' },
  palette: PAPERCUT_PALETTE,
  cover: {
    greeting: 'शुभ दीपावली',
    subtitle: 'from the {family} family',
    line: { one: 'One lamp, and the family behind it', other: 'One lamp for each of us' },
  },
  story: {
    chapters: [
      'cover', 'opening', 'roots', 'courtyards', 'parents', 'siblings', 'spouses', 'children',
      'lane', 'numbers', 'register', 'still-to-be-found', 'legacy', 'closing',
    ],
  },
  copy: {
    opening: { title: 'This is {featured}', line: 'This is the family behind {featured-first}.' },
    roots: { title: 'Where it begins', line: { one: 'The earliest name this family remembers.', other: 'The earliest names this family remembers.' } },
    courtyards: { title: 'Two courtyards', line: 'The houses {featured-first} comes from.' },
    parents: { title: 'माँ and पिताजी', line: 'The two who began this house, and the family they grew up in.' },
    siblings: { title: 'Growing up together', line: { one: 'The one who shared the house with {featured-first}.', other: 'The ones who shared the house with {featured-first}.' } },
    spouses: { title: 'A new family joins', line: 'A second family, joined to this one.' },
    children: { title: 'The next lamps', line: { one: 'The lamp lit after {featured-first}.', other: 'The lamps lit after {featured-first}.' } },
    lane: { title: 'Our lane', line: 'A house for every branch of the family.' },
    numbers: { title: 'In numbers', line: 'This family, counted from where {featured-first} stands.' },
    register: { title: 'Everyone', line: { one: '{n} person, and where to find them.', other: 'All {n} of us, and where to find each one.' } },
    'still-to-be-found': { title: 'Still to be found', line: { one: 'One lamp is lit for a name nobody has written down yet.', other: '{n} lamps are lit for names nobody has written down yet.' } },
    legacy: { title: 'One line of light', line: 'One lamp for every generation behind {featured-first}.' },
    closing: { title: 'शुभ दीपावली', line: 'Is someone missing? Add them, and send the book again next year.' },
  },
});
