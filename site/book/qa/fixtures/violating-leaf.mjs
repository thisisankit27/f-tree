// A meta-test fixture: deliberately violates the composer's determinism rule, so the guard has
// something real to catch. This file is never imported by compose.js -- the guard's own test walks
// a synthetic entry to it, on purpose, so the real closure never carries a clock call.
export function stamp() {
  return Date.now();
}
