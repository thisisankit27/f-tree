/*
 * The paper-cut art library: every compiled drawing, merged, and the one way a page reaches it.
 *
 * STATIC IMPORTS ONLY. Android stages the composer by walking `import ... from './x.js'` specifiers
 * from compose.js (app/build.gradle.kts bookEngine(), mirrored by qa/closure.mjs); a dynamic
 * `import()` is invisible to that walk, and the art it loads would silently never ship. Each kind
 * always has a module - the compiler writes an empty one for a kind with no drawings yet - so this
 * list never changes when art is added.
 */

import { createArt } from './draw.js';
import * as scenes from './papercut/scenes.js';
import * as avatars from './papercut/avatars.js';
import * as frames from './papercut/frames.js';
import * as motifs from './papercut/motifs.js';
import * as ornaments from './papercut/ornaments.js';

// tools/book_art.mjs refuses an id used by two kinds, and --check holds these modules to its output.
const merge = (modules) => ({
  symbols: Object.assign({}, ...modules.map((m) => m.symbols)),
  gradients: Object.assign({}, ...modules.map((m) => m.gradients)),
});

/** `{ symbols, gradients }`: every drawing and part by id, their fills still palette tokens. */
export const LIBRARY = merge([scenes, avatars, frames, motifs, ornaments]);

/** The art helpers for one book (draw.js), over the whole library: `ctx.art = artFor(ctx)`. */
export const artFor = (ctx) => createArt(ctx, LIBRARY);
