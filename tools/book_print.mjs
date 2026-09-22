/*
 * Painting Books in headless Chromium, the way the desktop does, for the book's by-eye and by-size
 * tools (#245): `book_contact_sheet.mjs` and `book_pdf_size.mjs`. Not a test and not run in CI.
 *
 * The HTML is `printBookToPdf`'s (desktop/main.js): the four book faces as data: URLs, one A4 box
 * per page with `@page { size: 595pt 842pt; margin: 0 }`, each page the SVG that `svg.js` paints,
 * `fitText` once the fonts are ready (as the renderer's preview does), and `page.pdf` with
 * `printBackground` and `preferCSSPageSize` - Playwright's name for Electron's `printToPDF` with the
 * same options. Both are Chromium's Skia PDF backend, so a byte measured here is a byte the desktop
 * writes, give or take the Chromium version.
 *
 * Playwright is not a dependency of this repository. Point FTREE_PLAYWRIGHT at an installed copy
 * (`.../node_modules/playwright/index.mjs`), or run from a directory where `import('playwright')`
 * resolves. `npx playwright --version` shows whether one is installed; `npx playwright install
 * chromium` fetches the browser it drives.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fitText } from '../site/book/svg.js';
import { FONT_KEYS } from '../site/book/template.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FONT_DIR = path.join(repo, 'app/src/main/res/font');

export async function loadPlaywright() {
  const spec = process.env.FTREE_PLAYWRIGHT;
  try {
    const mod = await import(spec ? pathToFileURL(path.resolve(spec)).href : 'playwright');
    return mod.chromium ? mod : mod.default;
  } catch (error) {
    throw new Error(`Playwright could not be loaded (${error.message}).\n`
      + 'Set FTREE_PLAYWRIGHT to an installed copy, e.g.\n'
      + '  FTREE_PLAYWRIGHT=~/.npm/_npx/<hash>/node_modules/playwright/index.mjs\n'
      + '(`npx playwright --version` installs one into the npx cache), then `npx playwright install chromium`.');
  }
}

/** The book faces as @font-face rules, family names the font keys svg.js paints with. Read once. */
let faces;
export const fontFaces = () => (faces ??= FONT_KEYS.map((key) => `@font-face{font-family:"${key}";`
  + `src:url(data:font/ttf;base64,${readFileSync(path.join(FONT_DIR, `${key}.ttf`)).toString('base64')}) format("truetype");font-display:block}`).join(''));

/** The desktop's print document, around already-painted SVG pages. */
export function printHtml(svgs) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
@page { size: 595pt 842pt; margin: 0; }
html, body { margin: 0; }
.page { width: 595pt; height: 842pt; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
.page svg { display: block; width: 595pt; height: 842pt; }
</style></head><body>${svgs.map((svg) => `<div class="page">${svg}</div>`).join('')}</body></html>`;
}

/**
 * Loads the pages, waits for the faces (with a Devanagari string, as the desktop does, so shaping
 * data is really there) and runs `svg.js`'s `fitText` over them, exactly as a preview would.
 */
export async function openPages(browser, svgs, { scale = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: scale });
  await page.setContent(printHtml(svgs), { waitUntil: 'load' });
  await settle(page);
  return page;
}

/**
 * Waits for the faces and runs svg.js's own `fitText` over the page, as the preview and the print
 * window do. The function itself is sent into the page, so this can never drift from it.
 */
const FIT_TEXT = fitText.toString();
export async function settle(page) {
  await page.evaluate(async ({ keys, fit }) => {
    await document.fonts.ready;
    await Promise.all(keys.map((k) => document.fonts.load(`16px "${k}"`, 'शर्मा')));
    new Function(`return (${fit})(document.body);`)();
  }, { keys: FONT_KEYS, fit: FIT_TEXT });
}

/** The PDF Chromium prints for these pages: the desktop's `printToPDF`, as Playwright spells it. */
export async function printPdf(browser, svgs) {
  const page = await openPages(browser, svgs);
  try {
    return await page.pdf({ printBackground: true, preferCSSPageSize: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    await page.close();
  }
}
