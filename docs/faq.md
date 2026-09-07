# Frequently asked questions

[← back to the README](../README.md) · [all documentation](README.md)

---

## Getting it

### Is f-tree free?

Yes, and open source under the [MIT licence](../LICENSE). There is no paid tier, no subscription,
no advertisement and no upsell. There is nothing to buy because there is no server to pay for.

### Is it on the Google Play Store?

No. It is distributed as an APK from [GitHub
Releases](https://github.com/thisisankit27/f-tree/releases/latest) and from
[ftree.vibethroughcode.com](https://ftree.vibethroughcode.com/).

Android will ask you to allow installing from your browser or file manager once. The website walks
through it with the exact wording your phone shows.

### How do I know the APK I downloaded is the real one?

Every release publishes a SHA-256, shown on the website and in the GitHub release. Check it before
installing:

```bash
sha256sum f-tree-0.7.0.apk
```

The APK is built and signed by [GitHub Actions from a
tag](../.github/workflows/release.yml), not uploaded from a laptop.

### What Android version do I need?

Android 8.0 (Oreo, API 26) or newer. The app is about 2 MB.

### Is there an iPhone, web or desktop version?

No app, but there is a **[browser viewer](https://ftree.vibethroughcode.com/playground/)** that
opens an exported `.ftree` on any device with a browser and draws the whole family at once. It is
read-only. The file is never uploaded — it is read in the tab.

---

## Privacy and data

### Where is my family tree stored?

In the app's own storage on your phone, and nowhere else. There is no account, no login, no
backend, and no sync.

### Does anything leave my phone?

Only what you send yourself: an export, a shared branch, or a relationship card. Nothing is
transmitted automatically.

The app declares two permissions, `INTERNET` and `REQUEST_INSTALL_PACKAGES`, and both exist only
for the **opt-in updater**. `UpdateRepository` refuses to make a request while the preference is
false, so "no network unless you ask for it" is a property of the code rather than of the interface.
`update/` is deliberately the only package in the app that opens a socket, so that claim is
checkable by reading it.

### Is there analytics or crash reporting?

None, in the app or on either web page. The download count shown on the website is read from the
GitHub Releases API at run time — real asset downloads, not a third-party tracker.

### Can I get my data out?

At any time, as a single `.ftree` file. It is an ordinary ZIP with a `tree.json` and the
photographs in it, and the [format is documented](ftree-format.md) so that anything can read it.
`unzip -p family.ftree tree.json` works.

### Is my tree encrypted?

Beyond Android's own full-disk encryption, no, and the export is a plain ZIP on purpose — so the
data outlives the app. Somebody with your unlocked phone can open f-tree. This is a documented
limitation rather than an oversight; see the [security policy](../SECURITY.md).

### What happens to my tree if this project is abandoned?

You keep it. It is on your device in a documented open format, the app is MIT-licensed, and there
is no server whose shutdown could take anything with it.

---

## Using it

### How do I record someone whose name nobody remembers?

Add them and leave the name blank. **A person with no name is a valid person in f-tree** — not a
placeholder, not an error — and they appear on the chart with a dashed brass edge, meaning the gap
is in what the family remembers rather than a fault in the record.

They can be named years later without disturbing a single relationship. This is the thing the app
is built around.

### Can it handle remarriage, half-siblings, adoption, step-parents?

Yes, and without special cases, because the underlying model is a **graph of people and typed
edges** rather than a tree of households. Multiple spouses, children across different marriages,
half-siblings, adoptive and step relationships and unknown ancestors are all ordinary states.

### Do I have to know exact dates?

No. Dates are partial ISO-8601 — `1938`, `1938-04`, or `1938-04-17` — so nobody has to invent a day
they do not know. There is no separate "approximate" flag because the precision *is* the statement
about what is known.

### How does the relation finder work?

Pick any two people. f-tree gives you two things:

- **The word for it**, from the nearest shared ancestor — *first cousin once removed*,
  *great-great-grandfather*, *mother-in-law*.
- **The line between them**: every person the relationship runs through. This is the form that can
  also answer the relationships English has no word for.

It walks marriages as well as blood, because "my wife's mother" is what people actually ask. On a
real 148-person tree it names 55% of all 21,756 ordered pairs; the rest read the answer off the
chain.

### Why does it sometimes not give me a single word?

Because English often has none. "My aunt's husband's brother" is what he is, and the chain says it
better than an invented word could. Rather than a flat "related by marriage", f-tree shows the
chain and says who married whom.

### What is the difference between Compact, Chart and Everyone?

- **Compact** reads the family as text — generations down the page, a tap to walk to anybody. No
  pinching, works at any text size, and can be read aloud by a screen reader.
- **Chart** draws the same people as a picture, with pan, zoom and tap-to-recentre.
- **Everyone** draws the entire tree at once, including the people no relationship reaches.

Compact and Chart share one centre, so switching between them never loses your place.

### Why does the chart not show my cousins?

The focused chart is ego-centric on purpose: ancestors above, descendants below, siblings beside.
Cousins and siblings' descendants multiply the width far faster than they add meaning, and they are
one tap away — tap the relative they hang from and the chart re-centres. Use **Everyone** to see
the whole graph at once.

### Can I use it in Hindi?

The **family words**, yes. Turn on *Family words → हिन्दी* and relationships are named the way the
family does: your mother's brother is **मामा**, your father's younger brother **चाचा**, his wife
**चाची**.

The interface itself — buttons, settings, error messages — stays English. Translating those is a
separate job needing a fluent reviewer, and a half-translated app reads worse than an English one.

### Why does it say पिता के भाई instead of चाचा or ताऊ?

Because it does not know which. ताऊ is a father's *elder* brother and चाचा a *younger* one, so
without birth years the app gives the descriptive term and offers to sharpen it. Guessing would be
wrong half the time, in a way a family notices at once.

### Can you add my language?

Very likely, and this is the contribution the project most wants. Bengali, Marathi, Gujarati,
Punjabi, Tamil and Telugu are already covered structurally — each is a word list plus a small rules
file. It needs a **native speaker** more than a developer.

[Open an issue and say which language.](https://github.com/thisisankit27/f-tree/issues/new/choose)

---

## Sharing and merging

### How do two people combine their family trees?

One exports, the other imports. **An import adds; it never replaces.** Nothing already in the tree
is deleted and no existing value is overwritten — the worst an import can do is add people who turn
out to be duplicates, which can then be merged. The opposite mistake, silently collapsing two real
people into one, cannot be undone, and every default follows from that asymmetry.

To join two families: import the other person's file, then create **one relationship** between
somebody in it and somebody in yours. There is no special "merge two trees" mode because there does
not need to be — a tree is a graph and a marriage is an edge.

### Can I send just part of my tree?

Yes. Tap somebody and share their household — the person, everyone descended from them, and the
partners of all of them. Everything *above* and *beside* them stays behind, so sending somebody a
branch does not quietly hand over the rest of your family.

### What if I import the same file twice?

Nothing happens. Every record carries where it came from, so the second import recognises those
people outright rather than proposing them as duplicates.

### Will importing overwrite what I have already written?

No. Merging **fills gaps only** — an empty field takes the imported value, a field that already
says something keeps saying it, and the disagreement is reported to you. A backup is also written
before every import, to `files/backups/`, and the three most recent are kept.

### Does it import GEDCOM?

No, and [deliberately so](../README.md#deliberately-not-built): it is a large format for a
lightweight app, and the documented `.ftree` schema covers sharing between users of this app.

---

## Updating

### Will I lose my tree when I update?

No. Installing a new APK over the old one keeps the app's data directory — that is ordinary Android
behaviour, and it is why the in-place updater exists at all. Without it, moving to a new version
would mean exporting, uninstalling, reinstalling and importing: four steps in which a family can be
lost.

### How do in-app updates work?

Off until you switch them on in Settings. When on, f-tree checks GitHub for a newer release and,
before installing anything, verifies three things in order:

1. the download's SHA-256 against the digest GitHub publishes for the asset,
2. that the archive's package name is this app,
3. that its signing certificate matches the copy already installed.

The third is the one that protects your tree: an APK signed with a different key *cannot* update
this one — Android refuses it — and the only way to install it would be to uninstall first, taking
the family with it.

### What is the beta channel?

An opt-in setting at the very bottom of Settings that offers pre-releases. Most people should leave
it alone: a beta is an unfinished build of an app you keep your family in.

Note that turning it back **off does not move you off a beta** — Android will not install an older
version over a newer one. The next stable release does. Export your tree before installing a beta.

---

## The project

### Who makes this?

[Ankit Srivastava](https://github.com/thisisankit27). It is MIT-licensed and contributions are
welcome — see [CONTRIBUTING.md](../CONTRIBUTING.md).

### How can I help?

The two most useful contributions need no Android experience: **kinship terms in another language**
(native speakers especially), and **real families that break the layout**. Accessibility testing
with TalkBack and documentation are next. And starring the repository genuinely does help other
families find it.

### I found a security problem.

Please do not open a public issue. Report it through the [private advisory
form](https://github.com/thisisankit27/f-tree/security/advisories/new); scope and expectations are
in [SECURITY.md](../SECURITY.md).
