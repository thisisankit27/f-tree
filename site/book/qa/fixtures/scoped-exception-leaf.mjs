// A meta-test fixture: proves a function-scoped exception does not blanket the whole file the way
// the old basename-and-substring-keyed exception did. `insideException` mirrors the shape of the
// real model.js/ageOf exception; `outsideException` is a second, unrelated call to the same banned
// API that a file-wide exception would have let through silently.
export function insideException() {
  return new Date().getFullYear();
}

export function outsideException() {
  return new Date().getFullYear();
}
