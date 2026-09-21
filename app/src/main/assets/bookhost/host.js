/*
 * The composer's end of the bridge. The app sets the input, calls ftreeCompose(), and waits for
 * deliver or fail - synchronously composed, because a WebView with no window fires no animation
 * frames and throttles its timers (see site/book/compose.js).
 */
import { composeBook } from '../book/site/book/compose.js';
import { readFamily } from '../book/site/book/family.js';
import { resolveFeatured } from '../book/site/book/story/featured.js';

window.ftreeCompose = () => {
  try {
    const input = JSON.parse(FTreeBook.input());
    const book = composeBook(input.doc, input.options, input.template, input.allowance || {});
    FTreeBook.deliver(JSON.stringify(book));
  } catch (error) {
    FTreeBook.fail(String((error && error.stack) || error));
  }
};

/*
 * Who resolveFeatured would pick for the same input ftreeCompose() takes, without laying out a
 * whole book - the book screen's "Whose story" row asks this so "Chosen for you" agrees with what
 * the composer would actually draw, before the reader has picked anybody (BookComposer.kt).
 */
window.ftreeFeatured = () => {
  try {
    const input = JSON.parse(FTreeBook.input());
    const family = readFamily(input.doc, input.options, input.allowance || {});
    FTreeBook.deliver(JSON.stringify({ featured: resolveFeatured(family, input.options) }));
  } catch (error) {
    FTreeBook.fail(String((error && error.stack) || error));
  }
};

FTreeBook.ready();
