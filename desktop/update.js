/*
 * Deciding whether there is a newer desktop release, and nothing else.
 *
 * Pure on purpose, and separate from the shell for the same reason `update/Release.kt` is pure in
 * the Android app: the awkward cases - a draft, a pre-release, a release with no installer for
 * this platform, a tag that is not a version - are settled by a test table rather than against
 * the network. `update.test.js` is that table.
 *
 * The rules are the app's rules, ported deliberately. Where they differ from the Kotlin they
 * differ because the artefact differs, and the difference is commented.
 */

/** `desktop-v0.2.0` -> [0, 2, 0] plus a suffix; anything else -> null. */
function parseVersion(tag) {
  const match = /^(?:desktop-)?v?(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(String(tag ?? '').trim());
  if (!match) return null;
  return {
    numbers: match[1].split('.').map(Number),
    suffix: match[2] ?? null,
  };
}

/**
 * Newer, older or the same.
 *
 * A release without a suffix beats the same numbers with one, so 0.2.0 supersedes 0.2.0-beta.1 -
 * the same rule the app uses, and the reason a beta reader is moved onto the stable build that
 * overtakes their beta rather than being left on it.
 */
function compareVersions(a, b) {
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let i = 0; i < length; i++) {
    const left = a.numbers[i] ?? 0;
    const right = b.numbers[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  if (a.suffix === b.suffix) return 0;
  if (!a.suffix) return 1;
  if (!b.suffix) return -1;
  return a.suffix < b.suffix ? -1 : 1;
}

/** Which file this platform can actually use. */
function assetFor(platform, assets) {
  const pick = (test) => assets.find((a) => test(a.name) && /^https:/.test(a.browser_download_url || ''));
  if (platform === 'win32') return pick((n) => /\.exe$/i.test(n));
  // A .deb can only be installed by apt, an AppImage is a file the reader replaces themselves.
  // The AppImage is offered because it is the one that needs no permission to put in place.
  if (platform === 'linux') return pick((n) => /\.AppImage$/i.test(n));
  return null;
}

/**
 * The newest desktop release worth offering, or why there is none.
 *
 * Only `desktop-` tags are considered. Every desktop release is published as a GitHub pre-release
 * to stay invisible to the Android updater, so `prerelease` cannot mean "beta" here the way it does
 * there - the *suffix on the tag* does. `desktop-v0.2.0` is stable; `desktop-v0.2.0-beta.1` is not.
 */
function chooseUpdate({ releases, currentVersion, platform, allowPreRelease = false }) {
  const current = parseVersion(currentVersion);
  if (!current) return { kind: 'no-usable-release' };
  if (!Array.isArray(releases)) return { kind: 'no-usable-release' };

  const desktopReleases = [];
  for (const release of releases) {
    if (!release || release.draft) continue;
    if (!/^desktop-/.test(String(release.tag_name ?? ''))) continue;
    const version = parseVersion(release.tag_name);
    if (!version) continue;
    desktopReleases.push({ version, release });
  }
  // Nothing for this app at all: a state of the repository, not of the reader.
  if (!desktopReleases.length) return { kind: 'no-usable-release' };

  /*
   * Where this parts company with the Kotlin, deliberately.
   *
   * `chooseFrom` treats an empty candidate list as "nothing usable", which is right there because
   * the stable channel reads an endpoint that has already dropped pre-releases - an empty list
   * means something is genuinely wrong. Here the channel filter runs over the whole list, so it
   * empties whenever the only newer build is a beta and the reader has not asked for betas. That
   * reader is up to date; telling them the repository is broken would point at the wrong thing.
   */
  const candidates = desktopReleases.filter((c) => allowPreRelease || !c.version.suffix);
  if (!candidates.length) return { kind: 'up-to-date' };

  candidates.sort((a, b) => compareVersions(b.version, a.version));
  const best = candidates[0];
  if (compareVersions(best.version, current) <= 0) return { kind: 'up-to-date' };

  const asset = assetFor(platform, best.release.assets || []);
  // "Up to date" and "nothing usable" are told apart deliberately: the second is a state of the
  // repository, not of the reader, and alarming somebody about it points at the wrong thing.
  if (!asset) return { kind: 'no-usable-release' };

  return {
    kind: 'newer',
    version: String(best.release.tag_name).replace(/^desktop-v?/, ''),
    tag: best.release.tag_name,
    notes: (best.release.body || '').trim() || null,
    notesUrl: best.release.html_url,
    publishedAt: best.release.published_at,
    file: {
      name: asset.name,
      size: asset.size,
      url: asset.browser_download_url,
      // GitHub publishes this as "sha256:<hex>"; absent on older releases.
      sha256: /^sha256:[0-9a-f]{64}$/i.test(asset.digest || '')
        ? asset.digest.slice(7).toLowerCase()
        : null,
    },
  };
}

module.exports = { parseVersion, compareVersions, assetFor, chooseUpdate };
