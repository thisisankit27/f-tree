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

function merge(modules) {
  const symbols = {}, gradients = {};
  for (const m of modules) {
    for (const [k, v] of Object.entries(m.symbols)) {
      if (Object.hasOwn(symbols, k)) throw new Error(`art: "${k}" is compiled twice - rerun node tools/book_art.mjs`);
      symbols[k] = v;
    }
    Object.assign(gradients, m.gradients);
  }
  return { symbols, gradients };
}

/** `{ symbols, gradients }`: every drawing and part by id, their fills still palette tokens. */
export const LIBRARY = merge([scenes, avatars, frames, motifs, ornaments]);

/** The art helpers for one book (draw.js), over the whole library: `ctx.art = artFor(ctx)`. */
export const artFor = (ctx) => createArt(ctx, LIBRARY);
