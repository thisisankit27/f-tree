# The policy switch

f-tree has one piece of groundwork for a feature that might one day cost money: a single place
that asks *"may this person do this, and how much of it?"* Today it always answers **yes, all of
it**. Nothing in the app is gated. This page is what to read before that ever changes.

The evaluator itself is `site/book/policy.js` on desktop and
`app/src/main/java/com/vibethroughcode/ftree/entitlement/Entitlements.kt` on Android — the same
rules, ported once, checked against one shared table
(`site/book/policy-cases.json`). This page is the *why*, not the *how*; read those files for the
mechanism.

## The principle: gate presentation, never data

**Export to `.ftree`, import, and everything needed to read or leave your own tree stay free,
forever.** Premium, if it ever exists, can only ever apply to an *extra* — a designed PDF export, a
festival template. A family's own records must never be held behind a payment. Anyone who has typed
their family into this app must always be able to get it back out in the format the app already
uses to back itself up.

This is also why an unreadable or too-new policy file **fails open, not closed** — see the doc
comment on `decide()` in `policy.js` and `Entitlements.kt`. The instinct everywhere else in this
codebase is to fail closed: an unreadable `.ftree` file is refused, a malformed setting reverts to
its default, a bad database row is null rather than trusted. The policy switch is the one
deliberate exception. What it protects is not a family's data but a business rule, and a corrupted
or newer-than-this-build policy must never take away an export that worked yesterday. A broken gate
is a bug for the maintainer to fix, not a reason to lock out someone who did nothing wrong.

## Where the switch lives, and why

`site/book/policy.json` ships inside the release — the APK's assets, the desktop package — rather
than being fetched from anywhere. Two things this buys:

- **The existing updater is the only way the answer changes.** The app's own promise is that
  nothing else touches the network (`strings.xml:362`), and remote config would break that the
  moment it shipped, even if the first version of it granted everything. A release the reader
  chooses to install is a real, auditable step; a value silently flipped on a server the app
  polls is not.
- **A fork points at its own policy by cloning the repository**, the same as it points at its own
  update endpoint (`app/build.gradle.kts:29-54`) — nothing extra to configure.

The cost of this design is that changing the answer needs a release. That is accepted: the
alternative is a second, permanent network surface for an app whose entire pitch is that it has
none.

## The allowance is soft, on purpose, and that is written down here so nobody discovers it later

`UsageLedger` — `SharedPreferences` on Android, a `bookUsage` key in `desktop/settings.js` on
desktop — counts how many times a feature has been used. Both are **local and trivially
resettable**: clearing app data, reinstalling, or deleting the settings file forgets every count.

This is accepted, not overlooked. A "two free exports" counter that resets on reinstall is not a
meaningful barrier to someone determined to avoid paying, and this app will never pretend it is
one to a reader. What it *is* good for is the same thing a free trial is good for anywhere: making
the honest, common case (someone who is not thinking about the limit at all) work exactly as
advertised, without asking for an account or a network call to enforce a number that low-stakes
enforcement was never going to hold anyway.

## The code is public: a gate is a product control, not enforcement

f-tree ships its source. Anyone who wants to read `policy.json`, or build the app with a version of
`Entitlements.kt` that always returns `Allowed`, can already do that today, and nothing proposed
here changes that. The switch this issue builds is for the overwhelming majority of readers who
install the app as published and would simply like to know, honestly, what is free and what is
not — not a mechanism that resists a determined adversary. Treating it as the latter would be lying
to ourselves about what it can do; treating it honestly as the former is enough to run a real
product decision through.

There is no Play Billing (the Android app is not distributed on the Play Store) and no account or
backend to verify a purchase against. How anyone would actually pay — an offline-signed licence
key, something else entirely — is explicitly out of scope for the groundwork in this issue. What
exists is `EntitlementSource`, an interface with exactly one implementation, `FreeForEveryone`. A
future licence check is a second implementation of that interface, not a rewrite of anything that
calls `decide()`.

## Example rules

None of these ship. `site/book/policy.json` today has exactly two rules, both `"grant": "full"`.
These are here so the shape of a real change is visible before anyone has to invent it under
pressure.

```jsonc
// A hard cap: at most two book exports, ever, on the free plan. Once used up, Locked with
// reason "quota-used"; before that, Limited with however many are left. `context.usage` comes
// from UsageLedger, keyed by feature name exactly like the policy rule that reads it.
{ "feature": "book.export", "plan": "free", "grant": { "quota": { "count": 2 } } }

// A soft cap instead of a hard one: any tree may be exported for free, but only the first two
// generations of it. A deeper request is Limited to two generations rather than refused outright
// -- "one generation is free, here it is" -- which is the whole reason Limited exists as a third
// outcome instead of a boolean.
{ "feature": "book.export", "plan": "free", "grant": { "scope": { "maxGenerations": 2 } } }

// A tier condition: the catalogue's evergreen templates (Heirloom) stay free, but a template
// marked "premium" in the catalogue (a future festival template, say) is Locked for the free
// plan. `when` is matched against the request, so this rule only ever applies to a request that
// actually asks for a premium-tier template -- every other template falls through to a separate,
// unconditional "full" rule for the same feature.
{
  "feature": "book.template",
  "plan": "free",
  "when": { "templateTier": "premium" },
  "grant": "none",
  "reason": "premium-template"
}

// Attribution removal: the closing page's "Made with f-tree" and the quiet per-page footer
// (see the family-book umbrella, issue #200) are a plausible premium extra precisely because
// they are presentation, not data -- removing them changes nothing about what the book contains.
{ "feature": "book.attribution-removal", "plan": "free", "grant": "none", "reason": "not-included" }
```

## The checklist: every place that currently says "free"

If a feature is ever actually gated, **revise every line below in the same change**, not
afterwards. Shipping a gate while the app still tells people everywhere else that it is
unconditionally free is the one outcome worse than not building the gate at all.

### The app

| Where | What it says today |
|---|---|
| `app/src/main/res/values/strings.xml:185` | `share_message` — the text attached to a shared branch: *"f-tree is a free family tree app that keeps everything on your phone."* |
| `app/src/main/res/values/strings.xml:186` | `share_message_unnamed` — the same claim, for a share with no name recorded: *"f-tree is a free family tree app that keeps everything on your phone."* |
| `app/src/main/res/values/strings.xml:216` | `about_body`, the About screen: *"A local-first family tree. Everything stays on this device: no account, no cloud, no backend."* Does not use the word "free," but reads as a complete, unconditional promise and needs to keep meaning that once anything is gated. |

These two `share_message` strings are the ones that travel the furthest: they are attached to
every `.ftree` file sent through a chat app, to people who have never opened f-tree. A share sent
the day before a gate ships is a promise that outlives the release.

### The website (`site/index.html`)

| Line | What it says today |
|---|---|
| `:7` | `<meta name="description">`: *"A free, offline family tree app for Android, Windows and Linux."* |
| `:17` | `<meta property="og:description">`: *"...Free for Android, Windows and Linux. No account, no server..."* |
| `:18` | `<meta property="og:image">` — not a claim of its own, but the social-card image sits directly beside the description above and should be checked (and likely regenerated) whenever that text changes, so the card does not show a picture making a promise the text no longer does. |
| `:25` | `<meta name="twitter:description">`: *"...Free for Android, Windows and Linux. No account, no server."* |
| `:26` | `<meta name="twitter:image">` — the same paired-image note as `:18`. |
| `:45` | The structured-data block's `"isAccessibleForFree": true`. |
| `:46` | `"inLanguage": ["en", "hi"]` — not a claim about cost; listed only because it sits between the two lines that are, in the same JSON object, so the block is easy to find as a whole. |
| `:47` | `"offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }` — the machine-readable price. Search engines and social previews read this, not just the visible page. |
| `:165` | The hero eyebrow: *"Android, Windows & Linux · Free · No account · Open source."* |
| `:535` | The last line of the "Nots" list: *"subscription, no trial, no upsell. MIT licence."* — the single most specific commitment on the page, and the one a gate would most directly contradict. |

`:45` and `:47` matter in a way the visible copy does not: they are what a search engine or a
social-media unfurl reads to decide how to describe this app to someone who has never seen the
page, and they are far more easily forgotten than a headline, because nothing on the rendered page
points back at them.

## What this issue did not build

No feature is gated. No UI reads a `Decision`. No `BookGate` composes the three steps the family
book umbrella (#200) describes as *plan → decide → compose(allowance)* — that composition belongs
to the book itself (#155 onward), once there is a feature for it to gate. What exists after this
issue is the switch, wired to nothing, always answering the same way, so that the day an answer
needs to change is a data change in `policy.json` and a rewrite of this checklist — never a new
release of every screen that exports.
