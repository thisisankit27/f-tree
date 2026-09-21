// A meta-test fixture: an entry that reaches a leaf with two calls to the same banned API, only one
// of which a test-supplied exception names.
export { insideException, outsideException } from './scoped-exception-leaf.mjs';
