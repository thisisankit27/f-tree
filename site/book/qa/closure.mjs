/*
 * The static import closure of a composer entry file, walked the same way Android stages it.
 *
 * `bookEngine()` (app/build.gradle.kts) is what decides which JS files ship inside the release:
 * it seeds a queue with `site/book/compose.js`, matches only static relative `import`/`export`
 * specifiers with a regex, and resolves them breadth-first. Nothing that isn't reachable that way
 * is ever staged into the WebView, and nothing reachable that way escapes it -- so this is also
 * the exact set of files the banned-API guard has to cover. A fixed file list has to be remembered;
 * this walk cannot go stale, because it is the same computation Gradle performs.
 *
 * The regex below is a deliberate line-for-line port of Gradle's Kotlin one:
 *   Regex("""^\s*(?:import|export)\b[^'"]*['"](\.{1,2}/[^'"]+)['"]""", RegexOption.MULTILINE)
 * Keep the two in sync; a change to one without the other is a guard that stops matching what
 * actually ships.
 */

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const IMPORT_SPECIFIER = /^\s*(?:import|export)\b[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm;

/**
 * Every file reachable from `entryFile` by a static relative import/export, entryFile included.
 * Mirrors `bookEngine()`'s BFS: a file is visited once, and every relative specifier its own text
 * names is queued, resolved against that file's own directory.
 */
export function importClosure(entryFile) {
  const found = new Set();
  const order = [];
  const queue = [path.resolve(entryFile)];
  while (queue.length) {
    const file = queue.shift();
    const real = realpathSync(file);
    if (found.has(real)) continue;
    found.add(real);
    order.push(real);
    const text = readFileSync(real, 'utf8');
    for (const m of text.matchAll(IMPORT_SPECIFIER)) {
      queue.push(path.resolve(path.dirname(real), m[1]));
    }
  }
  return order;
}

/**
 * Strips block and line comments the same way the old fixed-list test did -- but as a single scan
 * that tracks comment state and string/template state *together*, rather than a bare
 * `/\/\*[\s\S]*?\*\/|\/\/.*$/gm` match against the raw text. A bare match is fooled both ways: a
 * comment-start token sitting inside a string or template literal (`'https://...'`, in qr.js today)
 * is mistaken for a real comment and truncates the rest of that line; and, the other direction, a
 * quote character sitting inside a real comment (an apostrophe in an English sentence -- svg.js has
 * "the portrait's ring" in a `//` comment) is mistaken for the start of a string, which then
 * swallows everything up to the next matching quote *anywhere later in the file* as if it were
 * string content. Tracking both kinds of region in one pass, so a comment can never be misread as a
 * string or vice versa, is what a two-stage strip-then-mask (or mask-then-strip) approach cannot do
 * correctly on its own.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;

  function copyQuoted(quote) {
    let s = quote;
    i++;
    while (i < n) {
      if (src[i] === '\\' && i + 1 < n) { s += src[i] + src[i + 1]; i += 2; continue; }
      if (src[i] === '\n') break; // an unterminated literal: not valid JS, bail out without consuming it
      s += src[i];
      if (src[i] === quote) { i++; break; }
      i++;
    }
    return s;
  }

  function skipLineComment() {
    while (i < n && src[i] !== '\n') i++;
  }

  function skipBlockComment() {
    i += 2;
    while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
    i = Math.min(i + 2, n);
  }

  function copyTemplate() {
    let s = '`';
    i++;
    while (i < n) {
      if (src[i] === '\\' && i + 1 < n) { s += src[i] + src[i + 1]; i += 2; continue; }
      if (src[i] === '`') { s += '`'; i++; break; }
      if (src[i] === '$' && src[i + 1] === '{') {
        s += '${';
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          if (src[i] === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
          if (src[i] === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
          if (src[i] === '`') { s += copyTemplate(); continue; }
          if (src[i] === '"' || src[i] === "'") { s += copyQuoted(src[i]); continue; }
          if (src[i] === '{') depth++;
          if (src[i] === '}') { depth--; if (depth === 0) { s += '}'; i++; break; } }
          s += src[i]; i++;
        }
        continue;
      }
      s += src[i]; i++;
    }
    return s;
  }

  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
    if (c === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
    if (c === '"' || c === "'") { out += copyQuoted(c); continue; }
    if (c === '`') { out += copyTemplate(); continue; }
    out += c; i++;
  }
  return out;
}

/**
 * Blanks out the contents of string and template literals, keeping every character's position (so
 * offsets found in the result still index correctly into the comment-stripped source callers pass
 * in). Used only so brace-matching in `functionSpan` cannot be thrown off by a stray `{` or `}`
 * inside a literal's own text. Callers always run this on `stripComments`'s output, never on raw
 * source, so it does not need to understand comments itself.
 *
 * A `${...}` interpolation is real code, not literal text -- it is walked and copied through
 * unmasked (recursively, so a nested template literal or a nested quoted string inside the
 * interpolation is itself scanned the same way) so its own braces still count normally toward the
 * enclosing function's brace depth. svg.js does this today: a template literal's interpolation
 * itself contains a nested template literal.
 */
function maskStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;

  function maskQuoted(quote) {
    let s = '';
    while (i < n) {
      if (src[i] === '\\' && i + 1 < n) { s += 'xx'; i += 2; continue; }
      if (src[i] === quote) { s += quote; i++; break; }
      s += 'x'; i++;
    }
    return s;
  }

  function maskTemplate() {
    let s = '`';
    i++;
    while (i < n) {
      if (src[i] === '\\' && i + 1 < n) { s += 'xx'; i += 2; continue; }
      if (src[i] === '`') { s += '`'; i++; break; }
      if (src[i] === '$' && src[i + 1] === '{') {
        s += '${';
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          if (src[i] === '`') { s += maskTemplate(); continue; }
          if (src[i] === '"' || src[i] === "'") { const q = src[i]; s += q; i++; s += maskQuoted(q); continue; }
          if (src[i] === '{') depth++;
          if (src[i] === '}') { depth--; if (depth === 0) { s += '}'; i++; break; } }
          s += src[i]; i++;
        }
        continue;
      }
      s += 'x'; i++;
    }
    return s;
  }

  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") { out += c; i++; out += maskQuoted(c); continue; }
    if (c === '`') { out += maskTemplate(); continue; }
    out += c; i++;
  }
  return out;
}

/**
 * The `[start, end)` character span of the body of the function named `name` in `src`, or `null`
 * if no such function is found. Recognizes `function NAME(` and `const NAME = ` (including a
 * curried arrow like `const NAME = (a) => (b) => { ... }`, where the body is the first `{...}`
 * block reached, since the parameter lists themselves never contain braces here).
 *
 * `src` should already have comments stripped and strings masked (same length, so offsets line up
 * with the comment-stripped, un-masked source that callers scan for banned substrings).
 */
export function functionSpan(src, name) {
  const re = new RegExp(`(?:\\bfunction\\s+${name}\\s*\\(|\\bconst\\s+${name}\\s*=)`);
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return [m.index, i + 1];
    }
  }
  return null;
}

/** Today's banned substrings (book.test.mjs's own list, unchanged). */
export const BANNED_APIS = ['new Date', 'Date.now', 'localeCompare', 'Intl.', 'document.', 'window.', 'Math.random', 'requestAnimationFrame', 'setTimeout', 'fetch('];

/** `file`'s path relative to `repoRoot`, posix-style, or its basename if no `repoRoot` is given. */
function keyFor(file, repoRoot) {
  return repoRoot ? path.relative(repoRoot, file).split(path.sep).join('/') : path.basename(file);
}

/**
 * Every violation found across `files` (absolute paths), as `{ file, banned }`. Only `.js`/`.mjs`
 * files are scanned -- the closure also carries `.json` templates, which are data, not code, and
 * cannot call anything.
 *
 * `allow`, keyed by `file`'s path relative to `repoRoot` (never a bare basename -- two files with
 * the same name in different directories must not share an exception), maps to a list of
 * `{ banned, fn }`: the substring is tolerated only inside the named function's own body, found by
 * `functionSpan`. A second, unrelated occurrence of the same substring elsewhere in the file is
 * still a violation. This exists for exactly two pre-existing, reviewed entries (book.test.mjs
 * wires them up) and is not how a new violation gets past this guard -- widening it, or adding a
 * file to it, is itself the kind of change a reviewer has to see and mean.
 */
export function bannedApiViolations(files, { banned = BANNED_APIS, allow = new Map(), repoRoot } = {}) {
  const violations = [];
  for (const file of files) {
    if (!/\.m?js$/.test(file)) continue;
    const exceptions = allow.get(keyFor(file, repoRoot)) ?? [];
    const src = stripComments(readFileSync(file, 'utf8'));
    const spanSrc = maskStrings(src);
    for (const b of banned) {
      const relevant = exceptions.filter((e) => e.banned === b);
      if (relevant.length === 0) {
        if (src.includes(b)) violations.push({ file, banned: b });
        continue;
      }
      const spans = relevant.map((e) => functionSpan(spanSrc, e.fn)).filter(Boolean);
      let idx = -1;
      let outside = false;
      while ((idx = src.indexOf(b, idx + 1)) !== -1) {
        if (!spans.some(([start, end]) => idx >= start && idx < end)) outside = true;
      }
      if (outside) violations.push({ file, banned: b });
    }
  }
  return violations;
}

/**
 * Exceptions in `allow` (same shape as `bannedApiViolations`'s) that no longer match anything: the
 * file is not in `files` at all, the named function no longer exists, or the function's body no
 * longer contains the banned substring it was written to excuse. A guard that only ever narrows is
 * not enough -- an exception nobody re-checks is a hole with a comment taped over it. Once a bug an
 * exception was carved out for is fixed (or the code around it changes shape), the exception itself
 * must be deleted, and this is what forces that.
 */
export function staleExceptions(files, allow, { repoRoot } = {}) {
  const byKey = new Map(files.map((f) => [keyFor(f, repoRoot), f]));
  const stale = [];
  for (const [key, exceptions] of allow) {
    const file = byKey.get(key);
    if (!file) {
      for (const { banned, fn } of exceptions) stale.push({ file: key, banned, fn, reason: 'file is not in the closure' });
      continue;
    }
    const src = stripComments(readFileSync(file, 'utf8'));
    const spanSrc = maskStrings(src);
    for (const { banned, fn } of exceptions) {
      const span = functionSpan(spanSrc, fn);
      if (!span) {
        stale.push({ file: key, banned, fn, reason: `function ${fn} not found` });
        continue;
      }
      let idx = -1;
      let found = false;
      while ((idx = src.indexOf(banned, idx + 1)) !== -1) {
        if (idx >= span[0] && idx < span[1]) { found = true; break; }
      }
      if (!found) stale.push({ file: key, banned, fn, reason: `${fn} no longer contains ${banned}` });
    }
  }
  return stale;
}
