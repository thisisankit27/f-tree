# Security Policy

## Supported versions

f-tree ships as a single APK from GitHub Releases. Only the **latest stable release** is supported.
Pre-releases (`-beta.N`) are supported only in the sense that a report against one is welcome —
fixes land in the next release rather than being backported.

| Version | Supported |
|---|---|
| Latest stable release | ✅ |
| Older releases | ❌ — please update |
| Beta channel | ⚠️ reports welcome, fixes go forward |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's [Report a
vulnerability](https://github.com/thisisankit27/f-tree/security/advisories/new) form, which opens a
private advisory visible only to the maintainer.

Please include what you were able to do, the version you tested, and — if you have one — a proof of
concept. You will get an acknowledgement within **7 days** and, where the report is valid, an
estimate of when a fix will ship. You will be credited in the advisory and the release notes unless
you would rather not be.

## What is in scope

The parts of f-tree where a vulnerability would have real consequences:

### The updater (`update/`)

This is the only code in the app that opens a socket, and the highest-value area to look at. Before
installing anything it checks, in this order:

1. the download's SHA-256 against the `digest` GitHub publishes for the asset,
2. that the archive's package name is this app,
3. that its signing certificate matches the copy already installed.

Anything that defeats one of those checks, or that causes the app to install an artefact it should
have refused, is in scope. So is any request made while the update preference is off — the
repository is supposed to refuse outright.

### Import (`transfer/`)

A `.ftree` is an untrusted ZIP from a stranger in a chat app. In scope: path traversal via entry
names, zip bombs, anything that writes outside the app's own storage, and any crafted file that
causes data loss in an existing tree. Import is meant to be additive — nothing already held is
deleted and no existing value is overwritten — so **any input that causes an import to destroy or
overwrite existing data is a security bug**, not merely a bug.

### File sharing

The exported and shared files, the `FileProvider` configuration, and the content URIs handed to
other apps. In scope: any way another app obtains a file it was not granted, or any way a shared
branch carries a person who was meant to stay behind.

### The website and browser viewer

[ftree.vibethroughcode.com](https://ftree.vibethroughcode.com/) and its
[playground](https://ftree.vibethroughcode.com/playground/). The viewer parses an untrusted ZIP in
the browser; XSS through crafted names or notes is in scope. The viewer must never upload the file
it opens.

## What is out of scope

- **Physical access to an unlocked phone.** The tree is stored in the app's own storage with no
  separate passphrase. This is a documented limitation, not a defect — see below.
- Anything requiring a rooted or already-compromised device.
- The absence of at-rest encryption beyond Android's own full-disk encryption.
- Reports that an exported `.ftree` is unencrypted. It is a plain ZIP on purpose, so the data
  outlives the app.
- Missing hardening headers on the static site, absent a demonstrated impact.
- Automated scanner output with no working proof of concept.

## Design notes a reporter should know

These are deliberate, and knowing them may save you time:

- **There is no server, account or sync.** There is no backend to attack; the entire threat surface
  is the app on the device, the release artefacts, and the static site.
- **The tree never touches the network.** The two permissions the app declares, `INTERNET` and
  `REQUEST_INSTALL_PACKAGES`, exist only for the opt-in updater.
- **An APK signed with a different key cannot update an installed f-tree** — Android refuses it.
  The updater checks the certificate itself so that this is refused early, with an explanation,
  rather than discovered at the end of a download.
- **Verify your download.** Every release publishes a SHA-256, shown on the
  [website](https://ftree.vibethroughcode.com/) and in the GitHub release:
  `sha256sum f-tree-<version>.apk`.

## Thank you

f-tree holds something people cannot re-create if it is lost. Time spent looking at it carefully is
genuinely appreciated.
