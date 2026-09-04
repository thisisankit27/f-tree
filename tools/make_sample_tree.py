#!/usr/bin/env python3
"""
Builds .ftree archives for exercising the playground.

The format is the one app/src/main/java/.../transfer/TreeDocument.kt writes: a ZIP holding
tree.json plus a photos/ directory. This writes it two ways on purpose - once the ordinary way,
and once through an unseekable stream, which makes zipfile emit data descriptors and zeroed local
headers exactly as java.util.zip.ZipOutputStream does. A reader that trusts local headers passes
the first file and fails the second.
"""

import io
import json
import random
import sys
import uuid
import zipfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    Image = None


def pid(seed):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"f-tree/{seed}"))


class Tree:
    def __init__(self, source):
        self.people = []
        self.rels = []
        self.source = source

    def person(self, key, name=None, gender="UNSPECIFIED", birth=None, death=None,
               deceased=False, notes=None, photo=None):
        record = {"id": pid(key), "gender": gender}
        if name:
            record["name"] = name
        if birth:
            record["birthDate"] = birth
        if death:
            record["deathDate"] = death
            deceased = True
        if deceased:
            record["deceased"] = True
        if notes:
            record["notes"] = notes
        if photo:
            record["photo"] = f"photos/{photo}"
        self.people.append(record)
        return record["id"]

    def rel(self, frm, to, type_, subtype=None):
        # Symmetric edges are stored in canonical id order, the way Relationship.of does it, so a
        # file from this script collides with a real one on the same unique index.
        if type_ in ("SPOUSE", "SIBLING") and frm > to:
            frm, to = to, frm
        record = {"id": str(uuid.uuid4()), "from": frm, "to": to, "type": type_}
        if subtype:
            record["subtype"] = subtype
        self.rels.append(record)

    def document(self):
        return {
            "format": "f-tree",
            "version": 1,
            "exportedAt": "2026-09-04T10:00:00Z",
            "sourceTreeId": self.source,
            "people": self.people,
            "relationships": self.rels,
        }


def jpeg(colour, label):
    if Image is None:
        return None
    img = Image.new("RGB", (200, 200), colour)
    draw = ImageDraw.Draw(img)
    draw.ellipse((40, 30, 160, 150), fill=(255, 255, 255, 60))
    draw.text((92, 165), label, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return buf.getvalue()


class Unseekable(io.RawIOBase):
    """Forces zipfile down the data-descriptor path that Java's ZipOutputStream always takes."""

    def __init__(self, sink):
        self.sink = sink

    def writable(self):
        return True

    def write(self, data):
        return self.sink.write(data)

    def seekable(self):
        return False

    def tell(self):
        return self.sink.tell()


def write_archive(path, tree, photos, streamed=False):
    payload = json.dumps(tree.document(), separators=(",", ":")).encode()
    if streamed:
        raw = io.BytesIO()
        with zipfile.ZipFile(Unseekable(raw), "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("tree.json", payload)
            for name, data in photos.items():
                z.writestr(f"photos/{name}", data)
        path.write_bytes(raw.getvalue())
    else:
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("tree.json", payload)
            for name, data in photos.items():
                z.writestr(f"photos/{name}", data)
    print(f"{path}  {path.stat().st_size / 1024:.1f} KB  "
          f"{len(tree.people)} people, {len(tree.rels)} relationships"
          f"{', streamed' if streamed else ''}")


def sample():
    """A deliberately awkward family: unknowns, a second marriage, an adoption, strangers."""
    t = Tree(pid("sample-tree"))
    photos = {}

    def with_photo(key, colour, label):
        if Image is None:
            return None
        name = f"{pid(key)[:8]}.jpg"
        photos[name] = jpeg(colour, label)
        return name

    # Generation 1. His wife is in the tree; her name is not, which is the whole point of the app.
    shyam = t.person("shyam", "Shyam Lal", "MALE", "1905", "1978",
                     notes="Moved the family to Kanpur after the mill closed.")
    shyam_wife = t.person("shyam-wife", None, "FEMALE", "1909", "1981",
                          notes="Remembered as a fierce cook. Nobody wrote her name down.")
    t.rel(shyam, shyam_wife, "SPOUSE", "WIDOWED")

    # Generation 2, including a second marriage that produces half-siblings.
    raj = t.person("raj", "Raj Kumar", "MALE", "1938-04-17", "2010-11-02",
                   photo=with_photo("raj", (58, 82, 62), "RK"))
    sushila = t.person("sushila", "Sushila Devi", "FEMALE", "1942-08",
                       photo=with_photo("sushila", (122, 88, 40), "SD"))
    kamla = t.person("kamla", "Kamla Devi", "FEMALE", "1948", "2019")
    bhola = t.person("bhola", "Bhola Prasad", "MALE", "1935", "1999")
    t.rel(shyam, raj, "PARENT")
    t.rel(shyam_wife, raj, "PARENT")
    t.rel(shyam, bhola, "PARENT")
    t.rel(shyam_wife, bhola, "PARENT")
    t.rel(raj, sushila, "SPOUSE", "MARRIED")
    t.rel(raj, kamla, "SPOUSE", "DIVORCED")

    # Generation 3.
    vinod = t.person("vinod", "Vinod Kumar", "MALE", "1962-01-09",
                     photo=with_photo("vinod", (42, 81, 56), "VK"))
    anita = t.person("anita", "Anita Kumar", "FEMALE", "1965-06-22")
    meena = t.person("meena", "Meena Kumari", "FEMALE", "1970",
                     notes="Half-sister to Vinod: same father, different mother.")
    arun = t.person("arun", "Arun Prasad", "MALE", "1966")
    t.rel(raj, vinod, "PARENT")
    t.rel(sushila, vinod, "PARENT")
    t.rel(raj, meena, "PARENT")
    t.rel(kamla, meena, "PARENT")
    t.rel(bhola, arun, "PARENT")
    t.rel(vinod, anita, "SPOUSE", "MARRIED")

    # Generation 4, with one child adopted - a relationship the format carries as a subtype.
    ankit = t.person("ankit", "Ankit Kumar", "MALE", "1990-05-01",
                     photo=with_photo("ankit", (26, 63, 43), "AK"))
    neha = t.person("neha", "Neha Kumar", "FEMALE", "1993-02-14")
    priya = t.person("priya", "Priya Sharma", "FEMALE", "1992-11-30")
    rohan = t.person("rohan", "Rohan Kumar", "MALE", "1998",
                     notes="Adopted in 2001.")
    t.rel(vinod, ankit, "PARENT")
    t.rel(anita, ankit, "PARENT")
    t.rel(vinod, neha, "PARENT")
    t.rel(anita, neha, "PARENT")
    t.rel(vinod, rohan, "PARENT", "ADOPTIVE")
    t.rel(anita, rohan, "PARENT", "ADOPTIVE")
    t.rel(ankit, priya, "SPOUSE", "MARRIED")

    # Generation 5.
    aarav = t.person("aarav", "Aarav Kumar", "MALE", "2019-07-11")
    t.rel(ankit, aarav, "PARENT")
    t.rel(priya, aarav, "PARENT")

    # A second family nobody has connected to the first yet - the app would never draw these
    # on the same chart, because no path reaches them from anyone in it.
    gopal = t.person("gopal", "Gopal Sharma", "MALE", "1940", "2008")
    lata = t.person("lata", "Lata Sharma", "FEMALE", "1944")
    t.rel(gopal, lata, "SPOUSE", "WIDOWED")
    t.rel(gopal, priya, "PARENT")
    t.rel(lata, priya, "PARENT")

    # Siblings whose parents are unknown: the one case a derived sibling cannot express, so the
    # format carries an explicit edge for it.
    dada = t.person("dada", "Hari Lal", "MALE", "1902", "1970")
    dadi = t.person("dadi", "Ram Lal", "MALE", "1900", "1968")
    t.rel(dada, dadi, "SIBLING")
    t.rel(dada, shyam, "SIBLING")

    # People recorded but not yet connected to anyone. The app cannot show them at all.
    t.person("stranger-1", "Ishwar Dutt", "MALE", "1928", "1994",
             notes="From the back of a photograph. Nobody living knows how he fits.")
    t.person("stranger-2", "Savitri Bai", "FEMALE", "1931")
    t.person("stranger-3", None, "UNSPECIFIED",
             notes="A child in the 1955 wedding photograph, third from the left.")
    t.person("stranger-4", "Mohan Lal", "MALE", "1955")

    return t, photos


def large(count=2000):
    """A tree big enough to prove the layout and the canvas hold up."""
    rng = random.Random(7)
    t = Tree(pid("large-tree"))
    first = ["Aarav", "Vivaan", "Aditya", "Ananya", "Diya", "Ishaan", "Kavya", "Rohan",
             "Meera", "Arjun", "Saanvi", "Nikhil", "Riya", "Kabir", "Tara"]
    last = ["Kumar", "Sharma", "Verma", "Singh", "Gupta", "Nair", "Iyer", "Bose"]

    generations = [[]]
    year = 1880
    made = 0
    while made < count:
        current = generations[-1]
        if not current:
            for _ in range(4):
                if made >= count:
                    break
                g = rng.choice(["MALE", "FEMALE"])
                current.append(t.person(f"L{made}", f"{rng.choice(first)} {rng.choice(last)}", g,
                                        str(year + rng.randint(0, 6))))
                made += 1
            continue

        nxt = []
        year += 27
        for person in current:
            if made >= count or rng.random() < 0.25:
                continue
            g = rng.choice(["MALE", "FEMALE"])
            spouse = t.person(f"L{made}", f"{rng.choice(first)} {rng.choice(last)}", g,
                              str(year - 27 + rng.randint(0, 5)))
            made += 1
            t.rel(person, spouse, "SPOUSE", "MARRIED")
            for _ in range(rng.randint(1, 3)):
                if made >= count:
                    break
                cg = rng.choice(["MALE", "FEMALE", "UNSPECIFIED"])
                name = None if rng.random() < 0.08 else f"{rng.choice(first)} {rng.choice(last)}"
                child = t.person(f"L{made}", name, cg, str(year + rng.randint(0, 8)))
                made += 1
                t.rel(person, child, "PARENT")
                t.rel(spouse, child, "PARENT")
                nxt.append(child)
        if not nxt:
            generations.append([])
        else:
            generations.append(nxt)

    for i in range(30):
        t.person(f"LX{i}", f"{rng.choice(first)} {rng.choice(last)}", "UNSPECIFIED")
    return t, {}


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)

    tree, photos = sample()
    write_archive(out / "sample-family.ftree", tree, photos)
    write_archive(out / "sample-streamed.ftree", tree, photos, streamed=True)

    big, _ = large()
    write_archive(out / "large-tree.ftree", big, {})
