// A meta-test fixture proving the closure walker would pick up svg.js the day the composer ever
// imports it -- today's fixed file list (book.test.mjs, before this guard) did not cover it.
export { paintPage } from '../../svg.js';
