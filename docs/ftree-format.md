# The `.ftree` format, sharing, and merging

An f-tree export is an ordinary ZIP with a documented JSON document inside it. It is the only way
a tree leaves the phone, and it is designed so that **importing one adds to your tree rather than
replacing it**.

This page covers the file format, what travels when you share a single branch, and the rules the
merge follows.

**Contents**

- [The `.ftree` format](#the-ftree-format)
- [Sharing one branch](#sharing-one-branch)
- [Joining a shared branch to your own tree](#joining-a-shared-branch-to-your-own-tree)
- [Merge behaviour](#merge-behaviour)

---

## The `.ftree` format

A ZIP. Version 1:

```
tree.json
photos/<photoId>.jpg
```

```json
{
  "format": "f-tree",
  "version": 1,
  "exportedAt": "2026-08-31T00:00:00Z",
  "sourceTreeId": "<uuid, stable for the life of an installation>",
  "people": [
    {
      "id": "…", "name": "Ankit Kumar", "gender": "MALE",
      "birthDate": "1990-05-01", "deathDate": null, "deceased": false,
      "photo": "photos/….jpg", "notes": "…",
      "origins": [{ "treeId": "…", "personId": "…" }]
    }
  ],
  "relationships": [
    { "id": "…", "from": "<parent>", "to": "<child>", "type": "PARENT", "subtype": null }
  ]
}
```

ZIP rather than one large JSON: base64-encoding a few hundred photographs would inflate them by a
third and force the whole tree through memory to read one person's name.

**Compatibility.** Every field but `format` and `version` is optional, and unknown keys are ignored
on read, so a file written by a future release still opens. Those two are always written even though
they equal their defaults, because they are how a reader knows what it is holding. A file claiming a
*higher* version is refused rather than partly understood.

`sourceTreeId` identifies the installation that wrote the file. With a person's id it forms a stable
identity across exports; each person also carries the `origins` they were imported with, so a tree
that has already been merged once still matches exactly on a later import.

## Sharing one branch

Export writes the whole archive, because it is the user's archive and they are keeping it. Sharing
is a different act with a different shape: it is a message, it goes to somebody who may not have the
app, and it should carry a part of the family rather than all of it.

**What travels is a household and the households under it** — the person, everyone descended from
them, and the partners of all of them. Sandeep's share is Sandeep, his wife, his children and their
partners, and so on down. What stays behind is everything *above* and *beside* him: his parents, his
siblings, their children. Sending somebody a branch should not quietly hand over the rest of the
sharer's family, and a recipient starting their own tree from a relative's file wants the people
below that relative, not the archive they came from.

Partners come along at every level, because a couple is how a family is read and a child arriving
without the parent they married is a hole in the story. Their *parents* do not: they are the doorway
back into another whole family, which is exactly what this is not.

A relationship travels only when **both** ends do. A shared branch therefore never carries an edge
pointing at somebody who is not in the file — the reader could not resolve it, and it would leak the
existence of a person deliberately left behind.

The rule is [`FamilyGraph.branchFrom`](../app/src/main/java/com/vibethroughcode/ftree/graph/FamilyGraph.kt),
which is an ordinary function over adjacency lookups and is tested as one.

### The file, and the message with it

The whole-tree export asks where to put the file. A share does not: nobody wants to name a message.
It is written to the cache as `Sandeep-Kumar-family.ftree`, handed over as a content URI for the
length of one intent, and the previous one is deleted on the next share rather than leaving copies of
a family in a temporary directory. It has its own `FileProvider` — a subclass, because two
`<provider>` entries naming the same class are one component to Android, and the first version of
this shipped URIs that arrived at the updater's provider and were refused.

The message that goes with it has to work for somebody looking at an attachment in a chat who has
never heard of this app: whose family it is, how many people, where to get the app, and that
importing will not overwrite anything they already have. Whether a given chat app *shows* that
message beside the document is that app's decision — which is why the file is named after whose
family it is. The name is the part that always arrives.

### Sharing a relationship as a picture

Sending a `.ftree` taught us something: **a chat app handed a document quietly drops the message
that came with it.** The file arrives, the sentence explaining it does not. Handed an `image/png`,
the same app shows the text beside the picture — Android's own share sheet does it too, which is how
this was confirmed rather than assumed.

So a relationship can also be sent as a card. Not a screenshot: a screenshot carries a status bar, a
navigation bar and whatever font size the sender happens to use, none of which is the answer. The
card is the app's own sentence and its own notation, laid out for the purpose, in two drawings of
the same line — **Tree**, cards down a spine with each step named on the rule that makes it, and
**List**, a register with a rail through the faces. The reader sees it before sending and picks.

The preview *is* the card. The same composable is drawn on screen and recorded into the file through
a `GraphicsLayer`, so there is no second rendering that could disagree with what was shown. Its
density is pinned at three pixels to the point rather than read from the device, which is what makes
the picture 1080 x 1350 from every phone; the preview scales that to fit after layout, so nothing is
re-measured. The ground is painted opaque, because a PNG with transparent corners is at the mercy of
whatever it lands on.

A line of any length fits, because both ends are always shown and a middle that will not fit is
counted rather than cut — "+4 more" is true where a silently shortened chain is not.

## Joining a shared branch to your own tree

This is the other half of why it exists. Import the branch, then create one relationship between
somebody in it and somebody in yours, and the two families are one graph: your wife's father is your
father-in-law, her brother your brother-in-law, and the relation finder can walk between them. There
is no special "merge two trees" mode, because there does not need to be — a tree is a graph and a
marriage is an edge.

Re-importing the same file is a no-op. Every record carries where it came from, so the second import
recognises those people outright rather than proposing them as duplicates.

## Merge behaviour

**An import adds; it never replaces.** Nothing already in the tree is deleted, and no existing value
is overwritten. The worst an import can do is add people who turn out to be duplicates — which can
then be merged. The opposite mistake, silently collapsing two real people into one, cannot be undone.
Every default follows from that asymmetry.

Reading and judging a file **writes nothing**; only a plan the user has confirmed is applied, in one
transaction.

| Evidence | Default |
|---|---|
| Provable — the file's origins name someone already held | merge, without asking |
| Same name **and a relative already matched** | proposed **merge** |
| Same name alone | proposed **keep separate** |
| Dates that cannot both be true, or an unnamed person | no match at all |

Matching runs in passes, so confirmed matches become evidence for their relatives: two people with
the same name are far likelier to be the same once their father has already matched. Names are
compared past accents, punctuation and spacing, but never abbreviations — guessing that "R. Kumar"
is "Raj Kumar" is how a merge quietly destroys data.

Applying:

- Imported ids are **always remapped** to fresh local ones; an id in someone else's file may belong
  to a different person here.
- Merging **fills gaps only**. An empty field takes the imported value; a field that already says
  something keeps saying it, and the disagreement is reported.
- Existing relationships are skipped, not duplicated.
- A **backup is written first**, to `files/backups/`, and the three most recent are kept.

Re-importing the same file, or the app's own export, is a no-op.


---

## Reading a `.ftree` yourself

The format is deliberately boring so that anything can read it: unzip the file and parse
`tree.json`. There is no proprietary container, no encryption and no server involved, which is the
point — a family record that only one program can open is a family record with an expiry date.

The [browser viewer](https://ftree.vibethroughcode.com/playground/) is a working reference reader
in about a thousand lines of dependency-free JavaScript. Its `archive.js` is the part that reads
the ZIP, and it documents the one real trap: **read the central directory, never the local file
headers** — see [the site notes](site.md#the-viewer).

```bash
unzip -l family.ftree
unzip -p family.ftree tree.json | python3 -m json.tool | head -40
```

## Where to go next

- [Architecture](architecture.md)
- [The data model, field by field](data-model.md)
- [The website and the browser viewer](site.md)
