# The website and the browser viewer

[ftree.vibethroughcode.com](https://ftree.vibethroughcode.com/) is the landing page and install
guide. [ftree.vibethroughcode.com/playground/](https://ftree.vibethroughcode.com/playground/) is a
browser-only reader for an exported `.ftree` — it draws the whole archive at once, including the
people no relationship reaches.

Neither page has an analytics script. The viewer never uploads the file you open.

---

## The landing page

`site/` is the public landing page and install guide, deployed to GitHub Pages by
`.github/workflows/pages.yml` on any push to `main` that touches it. There is no build step —
edit the HTML and push.

It reads version, size, release date, SHA-256 and the download count from the GitHub Releases API
at run time, so cutting a release updates the site with no edit here, and the download count is
real asset downloads rather than a third-party tracker. There is no analytics script on either
page. Asset paths are relative, so the site works both at `thisisankit27.github.io/f-tree/` and at
a custom domain.

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
python3 tools/make_sample_tree.py /tmp/fixtures   # .ftree files, including odd ones
node tools/check_layout.mjs /tmp/fixtures         # layout invariants, run in CI
```

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
