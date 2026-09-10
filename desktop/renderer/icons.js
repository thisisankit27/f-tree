/*
 * The two glyphs the desktop draws in more than one place.
 *
 * "How are we related?" is offered from the bar, the person panel, the people list and the compact
 * view (#150, #151), and it wears the same mark in all four so it reads as one feature reached four
 * ways -- the mark Android uses at all three of its own entry points, Material's `compare_arrows`, so
 * somebody moving between the phone and the laptop recognises it.
 */

const NS = 'http://www.w3.org/2000/svg';

/** Material `compare_arrows`, the 24px path, as the Android app draws it (`Icons.Default.CompareArrows`). */
const RELATE_PATH = 'M9.01 14H2v2h7.01v3L13 15l-3.99-4v3zm5.98-1v-3H22V8h-7.01V5L11 9l3.99 4z';

/** A gear, stroked to match the bar's other stroked glyphs (the moon and the sun). */
const PREFS_PATHS = [
  'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73'
    + 'l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 '
    + '2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44'
    + 'a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 '
    + '0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38'
    + 'a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
];

function svg(size) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  return el;
}

/** The relation mark, filled in the current colour. */
export function relateIcon(size = 16) {
  const el = svg(size);
  el.setAttribute('fill', 'currentColor');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', RELATE_PATH);
  el.append(path);
  return el;
}

/** The preferences gear. */
export function prefsIcon(size = 15) {
  const el = svg(size);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.8');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  for (const d of PREFS_PATHS) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    el.append(path);
  }
  const hub = document.createElementNS(NS, 'circle');
  hub.setAttribute('cx', '12');
  hub.setAttribute('cy', '12');
  hub.setAttribute('r', '3');
  el.append(hub);
  return el;
}

export { RELATE_PATH };
