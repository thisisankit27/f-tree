/*
 * Templates are data, and are read as though they came from a stranger.
 *
 * Today every template ships inside the release. One day they may be downloaded (#214), and a
 * downloaded file is content the app renders, so the rule is set now: a template is a JSON
 * document that chooses among things the composer already knows how to draw - a palette, three
 * font roles, which pages in which order, a few lines of copy - and can do nothing else. There is
 * no script in it and no way to reference anything outside it. Anything unexpected is refused
 * rather than guessed at, so a template written for a newer app fails loudly on an older one
 * instead of drawing a book half-right.
 *
 * Format 2 (#243) is the storybook's schema: a paper-cut palette, four font roles instead of
 * three, and a chapter list instead of a fixed page order. It is a second, separate shape, not an
 * extension of format 1 - a format-1 template keeps validating exactly as before, and gains no new
 * required field. `validateTemplate` checks `format` before it looks at a single other key, so a
 * template written for a format this app cannot draw fails on that alone, never on a key it
 * happens to be missing.
 */

export const TEMPLATE_FORMAT = 1;

/** The storybook's template format (#243). Hidden from the catalogue until #244 reads it by default. */
const FORMAT_PAPERCUT = 2;

export const BLOCKS = ['cover', 'tree', 'numbers', 'generations', 'find', 'closing'];

/**
 * The font files a template may choose among - the ones the release embeds.
 *
 * `book_hand` (#242) joined `book_display`/`book_text`/`book_strong` here without a format bump,
 * because `Book.fonts` is an open map (docs/family-book.md). A format-1 template still names
 * exactly the three roles below - see the `fonts` check further down, which does not change - and
 * a format-2 template is the first to use `hand` (#243). `FONT_KEYS` is enumerated in four other
 * places that cannot import this file and must be kept in step by hand: the hard-coded font map in
 * `app/.../book/BookFonts.kt`, `BOOK_FONT_FILES` in `desktop/main.js`, the `@font-face` rules in
 * `preview.html`, and the tables gathered into `METRICS` in `metrics/index.js`. `font-keys.json`
 * plus `font-keys.test.mjs` and `FontKeysTest.kt` fail the build if any of the five disagree.
 */
export const FONT_KEYS = ['book_display', 'book_text', 'book_strong', 'book_hand'];

/** The paper-cut template's fourth role, its handwritten voice (Kalam, `book_hand.ttf`, #242). */
export const HAND_FONT_KEY = 'book_hand';

/**
 * The faces the display, text and strong roles may use, in either format. Kalam is only ever the
 * hand role: a format-1 template naming it would print on an app that predates #242 with that
 * text missing, and it has no bold or display cut.
 */
export const ROLE_FONT_KEYS = FONT_KEYS.filter((k) => k !== HAND_FONT_KEY);

export const PALETTE_KEYS = [
  'night', 'deep', 'glow', 'gold', 'goldSoft', 'star', 'mist',
  'paper', 'ink', 'inkSoft', 'aged', 'card', 'rule',
  'female', 'male', 'other',
  'clay', 'flame', 'petalA', 'petalB', 'lanternBody', 'lanternTop',
];

/**
 * The palette an `art: "papercut"` template must supply, all 29 required. This is the same
 * `PALETTE` the approved style frames were rendered from
 * (`site/book/art/style-frames/motifs.mjs`), and the single source of truth for it: #247's
 * `tools/book_art.mjs --check` fails when `art/src/papercut/swatches.json` names a different set,
 * so the authoring swatches and this schema cannot drift apart again.
 */
export const PAPERCUT_PALETTE_KEYS = [
  'paper', 'paperDeep', 'card', 'ink', 'inkSoft', 'night', 'deep', 'glow', 'dusk', 'gold', 'flame',
  'brass', 'marigold', 'saffron', 'sindoor', 'rani', 'peacock', 'indigo', 'leaf', 'leafDeep',
  'stone', 'clay', 'skin', 'silver', 'sky', 'wash', 'haze', 'dayHaze', 'dayMid',
];

/** The chapters every paper-cut template must carry, whatever else it adds around them. */
export const REQUIRED_CHAPTERS = ['cover', 'opening', 'register', 'closing'];

/** `copy` and cover text may only interpolate these - anything else is refused, not skipped. */
const PLACEHOLDERS = new Set(['featured', 'featured-first', 'family', 'n', 'year']);
const PLACEHOLDER = /\{([^{}]*)\}/g;

const ART_KINDS = ['papercut'];

const COLOUR = /^#[0-9a-f]{6}$/;
const ID = /^[a-z][a-z0-9-]{1,31}$/;
const TOP = new Set(['format', 'id', 'name', 'fonts', 'palette', 'pages', 'cover', 'fileSuffix']);
const COVER = new Set(['motif', 'greeting', 'subtitle', 'line', 'ornaments']);
const ORNAMENTS = ['lanterns', 'rangoli'];

const TOP_PAPERCUT = new Set(['format', 'id', 'name', 'fileSuffix', 'art', 'fonts', 'palette', 'cover', 'story', 'copy']);
const COVER_PAPERCUT = new Set(['greeting', 'subtitle', 'line']);

function fail(msg) {
  throw new Error(`template: ${msg}`);
}

const plainText = (v, max, what) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f<>]/.test(v)) fail(`${what} must be plain text under ${max} characters`);
  return v;
};

/**
 * Copy that counts people may say it both ways - `{ one, other }` - because "One lamps" is the
 * first thing a new reader with a tree of one would see. A plain string is used for every count.
 */
function plural(v, max, what) {
  if (typeof v === 'string') return { one: plainText(v, max, what), other: v };
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== 'one,other') fail(`${what} must be text, or { one, other }`);
  return { one: plainText(v.one, max, `${what}.one`), other: plainText(v.other, max, `${what}.other`) };
}

/** Plain text that may also carry `{placeholder}` tokens, each checked against the known set. */
function copyText(v, max, what) {
  const s = plainText(v, max, what);
  for (const m of s.matchAll(PLACEHOLDER)) if (!PLACEHOLDERS.has(m[1])) fail(`${what} has an unknown placeholder "{${m[1]}}"`);
  // A brace left over once the placeholders are gone is a broken one ("{family", "{{n}}"), and
  // would print as it is.
  if (/[{}]/.test(s.replace(PLACEHOLDER, ''))) fail(`${what} has an unmatched "{" or "}"`);
  return s;
}

/** `plural`, but each variant may carry the same placeholders as `copyText`. */
function copyPlural(v, max, what) {
  if (typeof v === 'string') return { one: copyText(v, max, what), other: v };
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== 'one,other') fail(`${what} must be text, or { one, other }`);
  return { one: copyText(v.one, max, `${what}.one`), other: copyText(v.other, max, `${what}.other`) };
}

export function validateTemplate(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) fail('not an object');
  if (t.format === FORMAT_PAPERCUT) return validatePapercutTemplate(t);
  if (t.format !== TEMPLATE_FORMAT) fail(`format ${t.format} - this app reads format ${TEMPLATE_FORMAT} or ${FORMAT_PAPERCUT}`);
  for (const k of Object.keys(t)) if (!TOP.has(k)) fail(`unknown key "${k}"`);
  if (typeof t.id !== 'string' || !ID.test(t.id)) fail('id must be lower-case letters, digits and hyphens');
  const name = plainText(t.name, 40, 'name');

  // A format-1 template still names exactly these three roles, from ROLE_FONT_KEYS: `book_hand`
  // is in FONT_KEYS but is never a format-1 face (#242, #243).
  const fonts = {};
  for (const role of ['display', 'text', 'strong']) {
    if (!ROLE_FONT_KEYS.includes(t.fonts?.[role])) fail(`font for "${role}" must be one of ${ROLE_FONT_KEYS.join(', ')}`);
    fonts[role] = t.fonts[role];
  }
  if (Object.keys(t.fonts).length !== 3) fail('fonts has keys other than display, text and strong');

  const palette = {};
  for (const k of PALETTE_KEYS) {
    const v = t.palette?.[k];
    if (typeof v !== 'string' || !COLOUR.test(v)) fail(`palette.${k} must be a #rrggbb colour`);
    palette[k] = v;
  }
  for (const k of Object.keys(t.palette)) if (!PALETTE_KEYS.includes(k)) fail(`unknown palette key "${k}"`);

  if (!Array.isArray(t.pages) || !t.pages.length) fail('pages must list blocks');
  for (const p of t.pages) if (!BLOCKS.includes(p)) fail(`unknown block "${p}"`);
  if (new Set(t.pages).size !== t.pages.length) fail('a block is listed twice');
  if (t.pages[0] !== 'cover') fail('the first page must be the cover - it is the one a chat app shows');

  const c = t.cover ?? {};
  for (const k of Object.keys(c)) if (!COVER.has(k)) fail(`unknown cover key "${k}"`);
  if (!['stars', 'lamps'].includes(c.motif)) fail('cover.motif must be "stars" or "lamps"');
  const ornaments = c.ornaments ?? [];
  if (!Array.isArray(ornaments) || ornaments.some((o) => !ORNAMENTS.includes(o))) fail(`cover.ornaments may only be ${ORNAMENTS.join(', ')}`);
  const cover = {
    motif: c.motif,
    greeting: c.greeting === undefined ? null : plainText(c.greeting, 40, 'cover.greeting'),
    subtitle: c.subtitle === undefined ? null : plainText(c.subtitle, 60, 'cover.subtitle'),
    line: c.line === undefined ? null : plural(c.line, 80, 'cover.line'),
    ornaments: [...ornaments],
  };

  const fileSuffix = t.fileSuffix === undefined ? 'Book' : plainText(t.fileSuffix, 20, 'fileSuffix');
  return Object.freeze({ format: t.format, id: t.id, name, fonts, palette, pages: [...t.pages], cover, fileSuffix });
}

/**
 * Format 2: the storybook's schema. Reached only once `validateTemplate` has already confirmed
 * `format === 2`, so everything below can assume that and refuse anything else about the shape -
 * an unknown key, a bad colour, a missing palette token or required chapter, an unknown
 * placeholder - the same posture format 1 keeps.
 */
function validatePapercutTemplate(t) {
  for (const k of Object.keys(t)) if (!TOP_PAPERCUT.has(k)) fail(`unknown key "${k}"`);
  if (typeof t.id !== 'string' || !ID.test(t.id)) fail('id must be lower-case letters, digits and hyphens');
  const name = plainText(t.name, 40, 'name');
  if (!ART_KINDS.includes(t.art)) fail(`art must be one of ${ART_KINDS.join(', ')}`);

  const fonts = {};
  for (const role of ['display', 'text', 'strong', 'hand']) {
    const allowed = role === 'hand' ? [HAND_FONT_KEY] : ROLE_FONT_KEYS;
    if (!allowed.includes(t.fonts?.[role])) fail(`font for "${role}" must be one of ${allowed.join(', ')}`);
    fonts[role] = t.fonts[role];
  }
  if (Object.keys(t.fonts ?? {}).length !== 4) fail('fonts has keys other than display, text, strong and hand');

  const palette = {};
  for (const k of PAPERCUT_PALETTE_KEYS) {
    const v = t.palette?.[k];
    if (typeof v !== 'string' || !COLOUR.test(v)) fail(`palette.${k} must be a #rrggbb colour`);
    palette[k] = v;
  }
  for (const k of Object.keys(t.palette ?? {})) if (!PAPERCUT_PALETTE_KEYS.includes(k)) fail(`unknown palette key "${k}"`);

  const c = t.cover;
  if (!c || typeof c !== 'object' || Array.isArray(c)) fail('cover must be an object');
  for (const k of Object.keys(c)) if (!COVER_PAPERCUT.has(k)) fail(`unknown cover key "${k}"`);
  const cover = {
    greeting: copyText(c.greeting, 40, 'cover.greeting'),
    subtitle: copyText(c.subtitle, 60, 'cover.subtitle'),
    line: copyPlural(c.line, 80, 'cover.line'),
  };

  const story = t.story;
  if (!story || typeof story !== 'object' || Array.isArray(story)) fail('story must be an object');
  for (const k of Object.keys(story)) if (k !== 'chapters') fail(`unknown story key "${k}"`);
  if (!Array.isArray(story.chapters) || !story.chapters.length) fail('story.chapters must list chapters');
  for (const ch of story.chapters) if (typeof ch !== 'string' || !ID.test(ch)) fail(`chapter "${ch}" must be lower-case letters, digits and hyphens`);
  if (new Set(story.chapters).size !== story.chapters.length) fail('a chapter is listed twice');
  for (const req of REQUIRED_CHAPTERS) if (!story.chapters.includes(req)) fail(`story.chapters must include "${req}"`);

  const copy = {};
  const rawCopy = t.copy;
  if (!rawCopy || typeof rawCopy !== 'object' || Array.isArray(rawCopy)) fail('copy must be an object');
  for (const chapter of Object.keys(rawCopy)) {
    if (!story.chapters.includes(chapter)) fail(`copy names a chapter "${chapter}" not in story.chapters`);
    const entry = rawCopy[chapter];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`copy.${chapter} must be an object`);
    for (const k of Object.keys(entry)) if (k !== 'title' && k !== 'line') fail(`unknown key "${k}" in copy.${chapter}`);
    copy[chapter] = {
      title: copyText(entry.title, 60, `copy.${chapter}.title`),
      line: copyPlural(entry.line, 240, `copy.${chapter}.line`),
    };
  }

  const fileSuffix = t.fileSuffix === undefined ? 'Book' : plainText(t.fileSuffix, 20, 'fileSuffix');
  return Object.freeze({
    format: FORMAT_PAPERCUT, id: t.id, name, fileSuffix, art: t.art, fonts, palette, cover,
    story: Object.freeze({ chapters: [...story.chapters] }), copy,
  });
}
