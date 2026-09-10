/*
 * What the reader has chosen, and the rules about what one choice does to another.
 *
 * Pure: no disk, no Electron, no menu. `main.js` reads and writes the file; this decides what a
 * settings object may become. Written that way because the interesting part is not storage -- it is
 * that some of these settings are not independent of each other, and the places that get that wrong
 * are places nobody looks at twice.
 *
 * Ported from `app/.../update/UpdatePreferences.kt`, with its reasoning. Two of the rules there
 * exist for failures that are invisible until they bite:
 *
 *   turning update checking off clears the remembered result, because "leaving a remembered result
 *   behind would let a stale banner outlive the setting";
 *
 *   changing channel clears the skipped version, because "a version skipped on one channel means
 *   nothing on the other: leaving it behind would silently hide the first release the reader has
 *   just asked to be offered".
 */

/**
 * Off until switched on, deliberately, for the two that reach the network.
 *
 * This app makes no request of any kind unless somebody has asked it to, and a default of "on"
 * would quietly make that untrue for everybody who never opened the menu. The rest are about how
 * the app looks and reads, and default to what most readers want.
 */
const DEFAULTS = Object.freeze({
  /** English or Hindi kinship words. Inert until the Hindi vocabulary lands (#124). */
  familyWords: 'en',
  /** Whether the chart draws photographs at all. */
  photosOnChart: true,
  /** 'light' or 'dark'. */
  theme: 'light',
  checkForUpdates: false,
  betaReleases: false,
  /** When the updater last got an answer, as epoch milliseconds. 0 means never. */
  lastCheckedAt: 0,
  /** A version the reader has dismissed; they are not asked about it again. */
  skippedVersion: null,
});



/** The settings this app knows about, and what counts as a value for each. */
const SHAPE = {
  familyWords: (v) => (v === 'hi' ? 'hi' : 'en'),
  photosOnChart: (v) => v !== false,
  theme: (v) => (v === 'dark' ? 'dark' : 'light'),
  checkForUpdates: (v) => v === true,
  betaReleases: (v) => v === true,
  lastCheckedAt: (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0),
  skippedVersion: (v) => (typeof v === 'string' && v.trim() ? v.trim() : null),
};

/**
 * A stored object made safe to use.
 *
 * Every value is put through its own rule rather than trusted, and anything unrecognised is
 * dropped. The file lives in a directory the reader can edit, and a settings file that has been
 * hand-edited into nonsense -- or written by a newer version of the app -- should give an app that
 * starts with sensible defaults rather than one that behaves strangely.
 */
function normalise(stored) {
  const raw = stored && typeof stored === 'object' ? stored : {};
  const out = {};
  for (const [key, clean] of Object.entries(SHAPE)) {
    out[key] = key in raw ? clean(raw[key]) : DEFAULTS[key];
  }
  return out;
}

/**
 * Applies a change, with the rules one setting has on another.
 *
 * Returns a whole new settings object rather than mutating, so the caller can compare and decide
 * whether anything needs writing or rebuilding.
 */
function applyChange(current, key, value) {
  if (!(key in SHAPE)) return normalise(current);

  const next = { ...normalise(current), [key]: SHAPE[key](value) };

  if (key === 'checkForUpdates' && next.checkForUpdates === false) {
    // Leaving a remembered result behind would let a stale banner outlive the setting.
    next.lastCheckedAt = 0;
    next.skippedVersion = null;
  }

  if (key === 'betaReleases' && next.betaReleases !== normalise(current).betaReleases) {
    /*
     * A version skipped on one channel means nothing on the other.
     *
     * Somebody who skipped 0.5.0 on the stable channel and then asks for betas is asking to be
     * offered what is new. Leaving the skip behind would silently withhold the first release they
     * turned this on for, and they would have no way of telling why.
     */
    next.skippedVersion = null;
  }

  return next;
}

/**
 * Whether the updater may make a request at all.
 *
 * The beta setting is separate from this rather than being a third state of it, because they answer
 * different questions: whether the app may ask GitHub anything, and which answer it will accept.
 * Turning betas on while checking is off does nothing, which is the honest arrangement -- no
 * setting here can start a request on its own.
 */
function mayCheckForUpdates(settings) {
  return normalise(settings).checkForUpdates === true;
}

/** Whether a found version should be offered, or has already been declined. */
function shouldOffer(settings, version) {
  const { skippedVersion } = normalise(settings);
  return !skippedVersion || skippedVersion !== version;
}

module.exports = {
  DEFAULT_SETTINGS: DEFAULTS,
  normalise,
  applyChange,
  mayCheckForUpdates,
  shouldOffer,
};
