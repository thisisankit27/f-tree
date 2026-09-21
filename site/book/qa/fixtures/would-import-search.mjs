// A meta-test fixture proving the guard catches the exact accident storybook-plan.md warns about:
// a composer-path file importing the UI-only search module, which sorts with localeCompare
// (site/playground/search.js:44) and would both break determinism and stage the module into the
// WebView.
export { searchPeople } from '../../../playground/search.js';
