/*
 * Only a link looks like a link.
 *
 * #146: the website's stylesheet underlined `.wordmark` on hover. On the website the wordmark is an
 * anchor back to the landing page, so that was right. The desktop app loads the same stylesheet and
 * uses the same class on a <span>, because an app window has nowhere to go -- and the rule, matched
 * on the class rather than the element, underlined it anyway. Hovering the title bar promised a
 * click that did nothing.
 *
 * The rule here is general rather than about the wordmark: a hover underline is only ever given to
 * an anchor. (`.link-btn` is underlined at rest, on purpose, and is not a hover rule.)
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHEETS = {
  'playground.css': readFileSync(path.join(here, '..', '..', 'site', 'playground', 'playground.css'), 'utf8'),
  'editor.css': readFileSync(path.join(here, 'editor.css'), 'utf8'),
};

/** Each rule as [selector, body], comments removed so a selector inside one is not counted. */
function rules(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body]);
}

test('a hover underline is only ever given to an anchor', () => {
  const offenders = [];
  for (const [file, css] of Object.entries(SHEETS)) {
    for (const [selectors, body] of rules(css)) {
      if (!/text-decoration\s*:\s*underline/.test(body)) continue;
      for (const selector of selectors.split(',').map((s) => s.trim())) {
        if (!selector.includes(':hover')) continue;
        // The compound that is hovered must name the element `a`, not only a class an anchor has.
        const hovered = selector.split(/\s+|>|\+|~/).find((part) => part.includes(':hover'));
        if (!/^a[.:#[]/.test(hovered)) offenders.push(`${file}: ${selector}`);
      }
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('the desktop wordmark is not an anchor, so nothing may underline it', () => {
  const html = readFileSync(path.join(here, 'index.html'), 'utf8');
  assert.match(html, /<span class="wordmark">/);
  assert.doesNotMatch(html, /<a[^>]*class="wordmark"/);
});
