// A meta-test fixture: an entry that reaches a clock call two hops away, the way a real regression
// would -- through a file compose.js does not import directly.
export { stamp } from './violating-leaf.mjs';
