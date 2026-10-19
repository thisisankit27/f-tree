# The website and the browser viewer

[ftree.vibethroughcode.com](https://ftree.vibethroughcode.com/) is the landing page and install
guide. [ftree.vibethroughcode.com/playground/](https://ftree.vibethroughcode.com/playground/) is a
browser-only reader for an exported `.ftree` — it draws the whole archive at once, including the
people no relationship reaches.

Neither page has an analytics script. The viewer never uploads the file you open.

---

## The marketing site

`site/` is the public site, deployed to GitHub Pages by `.github/workflows/pages.yml` on any push to
`main` that touches it. There is no build step — each page is a plain HTML file, so edit it and push.

| Page | What it is for |
|---|---|
| `/` | The home page: what f-tree is, who it is for, the platforms, privacy, free, FAQ teaser |
| `/features/` | Every feature, with screenshots |
| `/download/` | Android, Windows and Linux in one place, with live version, size and checksums |
| `/privacy/` | What stays on the device, what can reach a network, every Android permission |
| `/faq/` | The questions, grouped, with `FAQPage` structured data |
| `/relationship-finder/`, `/hindi-kinship/`, `/family-book/` | One page each for the three things people search for |
| `/guides/`, `/guides/unknown-ancestors/`, `/guides/merge-family-trees/` | Plain-language how-to articles, each with a visible author and date |
| `/about/` | Why f-tree exists, who makes it, and what is next |
| `/thanks/`, `/desktop/thanks/` | Install guides. `noindex`; the download buttons and the in-app updater send people here |
| `/desktop/` | A redirect to `/download/`, kept because older links point at it |
| `/playground/` | The browser viewer (see below) |

The header and footer are copied into every page rather than built, so `pages.yml` fails the
deploy if any page's copy differs from the home page's. Change one, change all of them.

It reads version, size, release date, SHA-256 and the download count from the GitHub Releases API
at run time, so cutting a release updates the site with no edit here. There is no analytics script
and no cookie. Fonts are self-hosted and subset (`site/fonts/`), so no page makes a third-party
request except to `api.github.com`. Asset paths are relative, so the site works both at
`thisisankit27.github.io/f-tree/` and at a custom domain; each page names its depth in
`<html data-root>` so `app.js` can build links from any of them.

**Keep these when editing.** `app.js` fills elements by id and by `data-spec` / `data-dl-meta`
attributes (`#platforms`, `#files-windows`, `#dl-menu`, `[data-spec="size"]` and the rest), and the
install guides' markup is written by script. `site/style-tokens.test.mjs` fails when a colour is
used but not defined in both themes.

### Screenshots

Desktop pictures come from the app itself, so they cannot drift from it: the `FTREE_SMOKE_SHOT*`
hooks in `desktop/main.js` (see [the desktop guide](desktop.md)) write the PNGs, and Playwright's
Electron support can drive the real window for the rest (zoom with the `menu:command` IPC, switch
theme with `#theme-btn`). Light and dark takes of a picture are two images, shown by the
`.on-light` / `.on-dark` classes, which follow the theme toggle as well as the system setting. Encode
as WebP at about quality 80; every picture on the site is under 40 KB.

## The viewer

`site/playground/` is a browser-only reader for an exported `.ftree`. Where the app draws the
family *around one person* a few relationships deep — the right answer on a phone — the viewer
draws the whole archive at once, on a tablet or a television, **including the people no
relationship reaches**, who the app has nowhere to put at all.

It is plain ES modules, no build, no dependencies:

| | |
|---|---|
| `archive.js` | reads the ZIP and validates the document |
| `model.js` | derives siblings, family units, components, kinship terms |
| `layout.js` | generations, crossing reduction, coordinates, packing |
| `chart.js` | the canvas renderer |
| `main.js` | the interface |

Three decisions in there are load-bearing:

**The ZIP is read through its central directory, never the local file headers.** The app writes
the archive with `java.util.zip.ZipOutputStream`, which for DEFLATED entries emits a local header
with the CRC and both sizes zeroed and puts the real values in a trailing data descriptor. A reader
that trusts the local header sees a length of zero for every entry.
`tools/make_sample_tree.py` therefore emits one fixture through an unseekable stream so CI keeps
testing that path.

**Semantic zoom is what makes a large archive readable.** Drawing every name at every scale gives a
grey wash the moment a whole family is on screen, so the chart draws less as it pulls back: at a
distance the cards are plain shapes and what you read is the shape of the family — how many
generations, how wide each got, and where the record has holes, because an unknown person keeps
their brass dashed edge at every scale.

**A generation is a relative fact, not a depth.** A child sits exactly one row below each parent,
and spouses — and siblings whose parents nobody recorded — sit on the same row; those offsets are
propagated out from one seed per connected family, which fixes every row exactly, because the offset
between two people is the same along every route between them.

The textbook alternative, ranking people by their longest path down from the oldest ancestor on
record, is wrong in a way that takes a real family to notice: it makes a person's row depend on how
far back *their* ancestry happens to be written down. A maternal grandfather whose own parents are
unknown lands on the top row beside a great-great-grandfather from the other side of the family, and
his children scatter across rows, each dragged down by however deep their own spouse's ancestry ran.

Everything happens in the tab. The file is never uploaded, there is no analytics on the page, and
the only thing stored is four display preferences in `localStorage`.

```bash
python3 -m pip install pillow                     # needed: the sample tree has photographs in it
python3 tools/make_sample_tree.py /tmp/fixtures   # .ftree files, including odd ones
node tools/check_layout.mjs /tmp/fixtures         # layout invariants, run in CI
```

The generator **refuses to run** without Pillow rather than writing a photo-less archive, which is
what it used to do. No CI runner had the library, so every fixture CI built was missing the four
photographs the sample family is supposed to have — and a photograph is the hardest thing in the
format to round-trip. A tool that quietly emits different test data depending on what is installed
is worse than one that will not start.

To preview it locally:

```bash
python3 -m http.server 8731 --directory site
```

## Custom domain

The site is served at **[ftree.vibethroughcode.com](https://ftree.vibethroughcode.com/)**, with
`thisisankit27.github.io/f-tree/` still working. Asset paths are relative so that both do.

The domain is held in the repository's **Pages settings**, not in a `site/CNAME` file — this
deployment builds the pages as a workflow artifact rather than serving a branch, so GitHub keeps
the custom domain as a repository setting and there is nothing to commit. Check it with:

```bash
gh api repos/thisisankit27/f-tree/pages --jq '.cname'
```

If you are pointing a *new* subdomain at this repository, order matters: add the `CNAME` record
first, wait for it to resolve, and only then set the custom domain. Claiming a hostname that does
not yet answer redirects the working `github.io` URL to one that is dead.


---

## Where to go next

- [The `.ftree` format](ftree-format.md)
- [Architecture](architecture.md)
