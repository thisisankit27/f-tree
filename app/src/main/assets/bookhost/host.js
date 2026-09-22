/*
 * The composer's end of the bridge. The app sets the input, calls ftreeCompose(), and waits for
 * deliver or fail - synchronously composed, because a WebView with no window fires no animation
 * frames and throttles its timers (see site/book/compose.js).
 */
import { composeBook } from '../book/site/book/compose.js';
import { readFamily } from '../book/site/book/family.js';
import { resolveFeatured } from '../book/site/book/story/featured.js';

/** Parses the bridge's input once, hands it to `fn`, and delivers or fails - the one path both
 * entry points below take, so a change to how a failure is reported reaches both. */
function run(fn) {
  try {
    const input = JSON.parse(FTreeBook.input());
    FTreeBook.deliver(JSON.stringify(fn(input)));
  } catch (error) {
    FTreeBook.fail(String((error && error.stack) || error));
  }
}

window.ftreeCompose = () => run((input) =>
  composeBook(input.doc, input.options, input.template, input.allowance || {}),
);

/*
 * Who resolveFeatured would pick for the same input ftreeCompose() takes, without laying out a
 * whole book - the book screen's "Whose story" row asks this so "Chosen for you" agrees with what
 * the composer would actually draw, before the reader has picked anybody (BookComposer.kt).
 */
window.ftreeFeatured = () => run((input) => {
  const family = readFamily(input.doc, input.options, input.allowance || {});
  return { featured: resolveFeatured(family, input.options) };
});

FTreeBook.ready();
