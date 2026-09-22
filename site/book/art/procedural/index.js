/*
 * The seeded generators (#255): one static-import surface for whichever archetype needs a
 * rangoli, a toran or a row of diyas. STATIC IMPORTS ONLY (site/book/art/index.js explains why):
 * Android stages the composer by walking relative import specifiers from compose.js, so a page
 * that reaches these through a dynamic import() would silently never ship.
 */

export { rangoli } from './rangoli.js';
export { toran } from './toran.js';
export { diyaRow } from './diyaRow.js';
