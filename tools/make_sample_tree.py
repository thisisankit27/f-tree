#!/usr/bin/env python3
"""
Builds .ftree archives for exercising the playground, and (with --book-fixtures) the family
book's storybook fixtures in site/book/fixtures.

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
import unicodedata
import uuid
import zipfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    Image = None

# Pillow is not optional, and it used to be treated as though it were.
#
# `jpeg()` returned None without it and `with_photo` quietly skipped the person, so the script still
# exited 0 and still wrote a valid archive -- just one with no photographs in it. No CI runner has
# ever had Pillow installed, so every fixture CI has ever built has been photo-less, and everything
# downstream has been checking a tree that does not contain the one thing hardest to round-trip:
# the binary payload. `check_writer.mjs` compares a written archive against what Android's reader
# would see and never once saw a photo entry.
#
# A tool that silently emits different test data depending on what happens to be installed is worse
# than one that will not run. So it will not run.
def require_pillow():
    if Image is None:
        sys.exit(
            "make_sample_tree.py needs Pillow to draw the photographs in the sample tree.\n"
            "Without it this script would write a valid archive with no photographs in it, and\n"
            "every check downstream would pass while never once reading a photo entry.\n\n"
            "    python3 -m pip install pillow\n"
        )


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


def cousins():
    """
    A relative's file that overlaps the tree the desktop smoke test builds by hand.

    It has to overlap on *names* and not on provenance: this is the ordinary case, where two people
    recorded the same family on two machines that have never met. Shyam Lal matches on his name
    alone, which is only a weak claim; Ravi matches on his name *and* on having Shyam as a parent
    in both files, which is what makes a strong one. One of each is what the review dialog exists
    to tell apart, so the fixture produces one of each on purpose.

    The birth years *agree* deliberately, and the notes disagree. Two different birth years are not
    a weak signal, they are a veto -- the matcher rules the pairing out entirely, which is the whole
    point of PartialDate.isCompatibleWith. So the field that differs here has to be one that cannot
    rule anything out, because a merge keeps the local value and the screen has to be able to show
    which of theirs is being set aside.
    """
    t = Tree(pid("a-cousins-tree"))
    shyam = t.person("cousin-shyam", "Shyam Lal", "MALE", birth="1938",
                     notes="Moved to Kanpur in 1961. Worked on the railways.")
    ravi = t.person("cousin-ravi", "Ravi", "MALE", birth="1962")
    meena = t.person("cousin-meena", "Meena Devi", "FEMALE", birth="1965")
    asha = t.person("cousin-asha", "Asha Lal", "FEMALE", birth="1990")

    t.rel(shyam, ravi, "PARENT")
    t.rel(ravi, meena, "SPOUSE")
    t.rel(ravi, asha, "PARENT")
    t.rel(meena, asha, "PARENT")
    return t, {}


# ---------------------------------------------------------------------------------------------
# The storybook's fixtures (#245, #250)
#
# The family book's composer reads tree.json and nothing else, so these are written as the JSON
# documents `site/book/fixtures/` already holds, not as archives. Each is one of the shapes the
# story planner has to get right (docs/storybook-plan.md, "Adaptations to the data"), and each is
# small enough to read by eye except the large one, which is the size the plan budgets for.
#
# They are made to be *stable*. Other issues' tests and goldens name these people by id, so:
#   - ids are readable keys ("f", "father", "pgm"), never uuid4;
#   - relationship ids are counted ("r0", "r1", ...), never uuid4;
#   - there is no randomness at all - the large family's shape comes from fixed sequences, not
#     `random`, whose streams are not a promise across Python versions;
#   - the output is byte-for-byte the same on every run, which `--check-book-fixtures` holds CI to.
# Changing one changes every downstream golden that reads it. Add a fixture rather than edit one.
#
# Everyone here is invented. Never add a real family.

BOOK_FIXTURE_PREFIX = "story-"


class BookTree:
    """A tree.json document with readable ids and counted relationship ids."""

    def __init__(self):
        self.people = []
        self.rels = []

    def person(self, key, name=None, gender="UNSPECIFIED", birth=None, death=None,
               deceased=False, notes=None, photo=False):
        record = {"id": key, "name": name, "gender": gender, "birthDate": birth,
                  "deathDate": death, "deceased": bool(deceased or death),
                  "photo": f"photos/{key}.jpg" if photo else None, "notes": notes, "origins": []}
        self.people.append(record)
        return key

    def rel(self, frm, to, type_, subtype=None):
        # Symmetric edges in canonical order, as Relationship.of stores them.
        if type_ in ("SPOUSE", "SIBLING") and frm > to:
            frm, to = to, frm
        self.rels.append({"id": f"r{len(self.rels)}", "from": frm, "to": to, "type": type_,
                          "subtype": subtype})

    def couple(self, a, b, subtype="MARRIED"):
        self.rel(a, b, "SPOUSE", subtype)

    def child(self, parents, kid, subtype=None):
        for parent in parents:
            self.rel(parent, kid, "PARENT", subtype)

    def document(self):
        return {"format": "f-tree", "version": 1, "people": self.people,
                "relationships": self.rels}


# Fixed name pools, indexed by a person's position, never sampled.
MEN = ["Ramesh", "Suresh", "Mahesh", "Dinesh", "Rakesh", "Mukesh", "Naresh", "Umesh", "Girish",
       "Harish", "Satish", "Vinay", "Ajay", "Sanjay", "Vijay", "Manoj", "Anil", "Sunil", "Kapil",
       "Nitin", "Rohit", "Amit", "Sumit", "Arjun", "Kabir", "Ishaan", "Vihaan", "Reyansh", "Aarav"]
WOMEN = ["Sunita", "Anita", "Kavita", "Savita", "Geeta", "Seema", "Reena", "Meena", "Neelam",
         "Poonam", "Asha", "Usha", "Nisha", "Pooja", "Priya", "Neha", "Sneha", "Ritu", "Swati",
         "Divya", "Ananya", "Diya", "Kiara", "Myra", "Saanvi", "Aadhya", "Anika", "Tara", "Ira"]
SURNAMES = ["Sharma", "Verma", "Gupta", "Mishra", "Tiwari", "Pandey", "Saxena", "Shukla",
            "Dubey", "Tripathi", "Srivastava", "Agarwal"]


def story_large(budget=200):
    """
    About two hundred people over six generations, with both of F's sides known.

    F (`f`) is in the fourth generation. Four great-grandparent couples head four families; the
    paternal grandparents are a son and a daughter of two of them, and so are the maternal ones.
    Below that every couple has children by a fixed sequence of counts, most children marry
    somebody from outside (whose own parents are sometimes known: an in-law's household), and it
    stops at the budget. The eldest two generations have all died and the third partly; a few
    people are unnamed, one in five carries a photograph path, and dates are years only.
    """
    t = BookTree()
    counts = [3, 4, 2, 5, 3, 1, 4, 2, 3, 0, 2, 3]
    state = {"count": 0}

    def next_count():
        c = counts[state["count"] % len(counts)]
        state["count"] += 1
        return c

    def new_person(gen, gender, surname, key=None, unnamed=False):
        i = len(t.people)   # everyone in this tree is made here, so this counts them
        pool = MEN if gender == "MALE" else WOMEN
        born = 1886 + gen * 26 + (i * 5) % 9
        death = None
        if gen <= 1 or (gen == 2 and i % 3 == 0):
            death = str(min(born + 62 + (i * 11) % 27, 2024))
        name = None if unnamed else f"{pool[(i * 7) % len(pool)]} {surname}"
        return t.person(key or f"p{i}", name, gender, str(born), death, photo=(i % 5 == 0))

    def surname_of(key):
        name = next(p["name"] for p in t.people if p["id"] == key)
        return name.split()[-1] if name else "Sharma"

    def marry_out(person, gender, gen, with_parents):
        other = SURNAMES[(len(t.people) * 5) % len(SURNAMES)]
        spouse = new_person(gen, "FEMALE" if gender == "MALE" else "MALE",
                            surname_of(person) if gender == "MALE" else other)
        t.couple(person, spouse, "MARRIED" if gen >= 2 else "WIDOWED")
        if with_parents:
            # An in-law's own parents: the other household a marriage brings into the book.
            pf = new_person(gen - 1, "MALE", other)
            pm = new_person(gen - 1, "FEMALE", other)
            t.couple(pf, pm, "WIDOWED" if gen <= 3 else "MARRIED")
            t.child([pf, pm], spouse)
        return spouse

    # Generation 0: four great-grandparent couples. One great-grandmother's name was never written
    # down, so a storybook names her by relation.
    heads = []
    for k, surname in enumerate(["Sharma", "Mishra", "Tiwari", "Pandey"]):
        husband = new_person(0, "MALE", surname, key=f"gg{k}m")
        wife = new_person(0, "FEMALE", surname, key=f"gg{k}f", unnamed=(k == 1))
        t.couple(husband, wife, "WIDOWED")
        heads.append((husband, wife, surname))

    # Generation 1: the grandparents and their siblings.
    roles = {(0, 0): "pgf", (1, 1): "pgm", (2, 0): "mgf", (3, 1): "mgm"}
    couples = []
    others = []
    for k, (m, w, surname) in enumerate(heads):
        for j in range(3 + (k % 2)):
            gender = "MALE" if j % 2 == 0 else "FEMALE"
            kid = new_person(1, gender, surname, key=roles.get((k, j)))
            t.child([m, w], kid)
            if (k, j) not in roles:
                others.append((kid, gender))
    t.couple("pgf", "pgm", "WIDOWED")
    t.couple("mgf", "mgm", "WIDOWED")

    # Generation 2: F's parents and their siblings (F's aunts and uncles).
    for (pa, ma), surname, role, first in [(("pgf", "pgm"), "Sharma", "father", "MALE"),
                                           (("mgf", "mgm"), "Tiwari", "mother", "FEMALE")]:
        for j in range(4):
            gender = first if j % 2 == 0 else ("FEMALE" if first == "MALE" else "MALE")
            kid = new_person(2, gender, surname, key=role if j == 0 else None)
            t.child([pa, ma], kid)
            if j:
                couples.append((kid, marry_out(kid, gender, 2, with_parents=(j == 1)), 3))
    t.couple("father", "mother")

    # The grandparents' siblings marry out too, and their lines are F's parents' cousins.
    for kid, gender in others:
        couples.append((kid, marry_out(kid, gender, 1, with_parents=False), 2))

    # Generation 3: F and two siblings.
    f = new_person(3, "FEMALE", "Sharma", key="f")
    t.child(["father", "mother"], f)
    couples.insert(0, (f, marry_out(f, "FEMALE", 3, with_parents=True), 4))
    for j, gender in enumerate(["MALE", "FEMALE"]):
        sib = new_person(3, gender, "Sharma", key=f"f-sib{j}")
        t.child(["father", "mother"], sib)
        couples.insert(1 + j, (sib, marry_out(sib, gender, 3, with_parents=(j == 0)), 4))

    # Every couple has children, breadth first, until the budget runs out.
    queue = list(couples)
    while queue and len(t.people) < budget:
        a, b, gen = queue.pop(0)
        if gen > 5:
            continue
        family = surname_of(a) if next(p["gender"] for p in t.people if p["id"] == a) == "MALE" else surname_of(b)
        for j in range(next_count()):
            if len(t.people) >= budget:
                break
            gender = "MALE" if (len(t.people) + j) % 2 == 0 else "FEMALE"
            kid = new_person(gen, gender, family, unnamed=(len(t.people) % 41 == 17))
            t.child([a, b], kid)
            if gen < 5 and len(t.people) < budget - 1 and len(t.people) % 3 != 1:
                queue.append((kid, marry_out(kid, gender, gen, with_parents=False), gen + 1))
    return t


def story_eldest():
    """F is the eldest: nobody above her is known, so the story can only flow downward."""
    t = BookTree()
    t.person("f", "Kamala Iyer", "FEMALE", "1931")
    t.person("f-husband", "Venkatesh Iyer", "MALE", "1927", "1999")
    t.couple("f", "f-husband", "WIDOWED")
    kids = [("c1", "Raghavan Iyer", "MALE", 1953, "Meenakshi Iyer"),
            ("c2", "Lakshmi Rao", "FEMALE", 1956, "Gopal Rao"),
            ("c3", "Srinivas Iyer", "MALE", 1960, "Janaki Iyer")]
    grandkids = ["Anand", "Deepa", "Karthik", "Vidya", "Hari", "Uma"]
    for i, (key, name, gender, born, spouse) in enumerate(kids):
        t.person(key, name, gender, str(born))
        t.child(["f", "f-husband"], key)
        t.person(f"{key}-sp", spouse, "FEMALE" if gender == "MALE" else "MALE", str(born + 3))
        t.couple(key, f"{key}-sp")
        for j in range(2):
            surname = name.split()[-1] if gender == "MALE" else spouse.split()[-1]
            t.person(f"{key}-k{j}", f"{grandkids[i * 2 + j]} {surname}",
                     "MALE" if j == 0 else "FEMALE", str(born + 27 + j * 3))
            t.child([key, f"{key}-sp"], f"{key}-k{j}")
    t.person("c1-k0-k0", "Aditi Iyer", "FEMALE", "2012")
    t.child(["c1-k0"], "c1-k0-k0")
    return t


def story_leaf():
    """F is a child: parents and all four grandparents known, no spouse and no children."""
    t = BookTree()
    t.person("pgf", "Harbans Singh", "MALE", "1938", "2015")
    t.person("pgm", "Gurmeet Kaur", "FEMALE", "1942")
    t.person("mgf", "Balwant Gill", "MALE", "1940", "2008")
    t.person("mgm", "Surinder Kaur Gill", "FEMALE", "1944", "2020")
    t.couple("pgf", "pgm", "WIDOWED")
    t.couple("mgf", "mgm", "WIDOWED")
    t.person("father", "Jaspreet Singh", "MALE", "1968")
    t.person("mother", "Harleen Kaur", "FEMALE", "1971")
    t.person("uncle", "Manpreet Singh", "MALE", "1972")
    t.person("aunt", "Simran Gill", "FEMALE", "1975")
    t.child(["pgf", "pgm"], "father")
    t.child(["pgf", "pgm"], "uncle")
    t.child(["mgf", "mgm"], "mother")
    t.child(["mgf", "mgm"], "aunt")
    t.couple("father", "mother")
    t.person("brother", "Arjan Singh", "MALE", "2004")
    t.person("f", "Noor Kaur", "FEMALE", "2009")
    t.child(["father", "mother"], "brother")
    t.child(["father", "mother"], "f")
    return t


def story_half_siblings():
    """
    A remarriage. F's father had a first wife (divorced), then F's mother, who had a son with an
    earlier partner whom F's father then raised (a step edge). So F has a full brother, two
    half-siblings on each side, and a half-sister known only by an explicit edge. Two siblings of
    the grandfather are explicit edges too, since nobody recorded their parents.
    """
    t = BookTree()
    t.person("gf", "Prakash Menon", "MALE", "1930", "2001")
    t.person("gf-brother", "Mohan Menon", "MALE", "1933", "2010")
    t.person("gf-sister", "Radha Menon", "FEMALE", "1936", "2019")
    t.rel("gf", "gf-brother", "SIBLING", "FULL")
    t.rel("gf", "gf-sister", "SIBLING", "HALF")
    t.person("father", "Suresh Menon", "MALE", "1958")
    t.child(["gf"], "father")
    t.person("first-wife", "Latha Nair", "FEMALE", "1960")
    t.person("mother", "Rekha Pillai", "FEMALE", "1964")
    t.person("mothers-ex", "Jose Thomas", "MALE", "1961")
    t.couple("father", "first-wife", "DIVORCED")
    t.couple("father", "mother", "MARRIED")
    t.couple("mother", "mothers-ex", "DIVORCED")
    t.person("half-1", "Arun Menon", "MALE", "1982")
    t.person("half-2", "Asha Menon", "FEMALE", "1985")
    t.child(["father", "first-wife"], "half-1")
    t.child(["father", "first-wife"], "half-2")
    t.person("half-3", "Joel Thomas", "MALE", "1986")
    t.child(["mother", "mothers-ex"], "half-3")
    t.rel("father", "half-3", "PARENT", "STEP")
    t.person("f", "Anjali Menon", "FEMALE", "1990")
    t.person("full-1", "Nikhil Menon", "MALE", "1993")
    t.child(["father", "mother"], "f")
    t.child(["father", "mother"], "full-1")
    # The record knows these two share a parent, and not which one.
    t.person("half-4", "Divya Menon", "FEMALE", "1979")
    t.rel("f", "half-4", "SIBLING", "HALF")
    return t


def story_twelve_siblings():
    """Twelve children of one couple, F the seventh: a sibling set too large for one page."""
    t = BookTree()
    t.person("father", "Ramkishan Yadav", "MALE", "1925", "1990")
    t.person("mother", "Phoolmati Devi", "FEMALE", "1929", "2004")
    t.couple("father", "mother", "WIDOWED")
    names = [("Shivram", "MALE"), ("Kaushalya", "FEMALE"), ("Jagdish", "MALE"),
             ("Shanti", "FEMALE"), ("Rambabu", "MALE"), ("Pushpa", "FEMALE"),
             ("Omprakash", "MALE"), ("Kamla", "FEMALE"), ("Raghunath", "MALE"),
             ("Sarla", "FEMALE"), ("Devendra", "MALE"), ("Munni", "FEMALE")]
    for i, (first, gender) in enumerate(names):
        key = "f" if i == 6 else f"sib{i + 1}"
        born = 1946 + i * 2
        t.person(key, f"{first} Yadav" if gender == "MALE" else f"{first} Devi", gender, str(born),
                 str(born + 60 + i) if i < 3 else None)
        t.child(["father", "mother"], key)
    return t


def story_three_spouses():
    """F married three times: a former wife (divorced), a late wife (died), and a current one."""
    t = BookTree()
    t.person("f-father", "Bhanu Pratap Chauhan", "MALE", "1922", "1988")
    t.person("f", "Devraj Chauhan", "MALE", "1950")
    t.child(["f-father"], "f")
    t.person("former", "Nirmala Rathore", "FEMALE", "1952")
    t.person("late", "Sushma Chauhan", "FEMALE", "1956", "1994-03-12")
    t.person("current", "Madhuri Chauhan", "FEMALE", "1962")
    t.couple("f", "former", "DIVORCED")
    t.couple("f", "late", "WIDOWED")
    t.couple("f", "current", "MARRIED")
    t.person("k-former", "Vikram Chauhan", "MALE", "1975")
    t.child(["f", "former"], "k-former")
    t.person("k-late-1", "Pallavi Chauhan", "FEMALE", "1982")
    t.person("k-late-2", "Rahul Chauhan", "MALE", "1986")
    t.child(["f", "late"], "k-late-1")
    t.child(["f", "late"], "k-late-2")
    t.person("k-current", "Aditya Chauhan", "MALE", "1997")
    t.child(["f", "current"], "k-current")
    return t


def story_unlinked():
    """
    F is linked to nobody: the eldest named person in the record, from the back of a photograph,
    beside a small family who are linked to each other. Asking for F must still make a book.
    """
    t = BookTree()
    t.person("f", "Bhagwati Prasad", "MALE", "1901", "1972",
             notes="From the back of a studio photograph, Allahabad, 1931.")
    t.person("a", "Rajendra Kumar", "MALE", "1950")
    t.person("b", "Shobha Kumar", "FEMALE", "1954")
    t.person("c", "Mohit Kumar", "MALE", "1980")
    t.couple("a", "b")
    t.child(["a", "b"], "c")
    t.person("loose", "Kishori Lal", "MALE", "1934", "1999")
    return t


def story_unknown_names():
    """People whose names are lost, whom a storybook names by relation ("Shyam Lal's wife")."""
    t = BookTree()
    t.person("unknown-father", None, "MALE", "1880")
    t.person("shyam", "Shyam Lal", "MALE", "1905", "1978")
    t.child(["unknown-father"], "shyam")
    t.person("shyam-wife", None, "FEMALE", "1909", "1981")
    t.couple("shyam", "shyam-wife", "WIDOWED")
    t.person("son", "Raj Kumar", "MALE", "1938", "2010")
    t.child(["shyam", "shyam-wife"], "son")
    t.person("son-wife", None, "FEMALE", deceased=True)
    t.couple("son", "son-wife", "WIDOWED")
    t.person("f", "Vinod Kumar", "MALE", "1962")
    t.child(["son", "son-wife"], "f")
    t.person("unknown-child", None, "UNSPECIFIED")
    t.child(["f"], "unknown-child")
    return t


# Spelled as code points so this file never holds the raw bytes: an editor could "helpfully" render or
# drop them (see family.js clampNote for the same care).
RLO, PDF, BEL, NUL, BS, ESC, RLI, PDI, RLM = map(chr, (0x202E, 0x202C, 0x07, 0x00, 0x08, 0x1B,
                                                  0x2067, 0x2069, 0x200F))


def story_notes():
    """
    Notes, including the hostile ones: control characters, bidi overrides and isolates, a tab, and
    more lines than a card holds. With `options.notes` off none of it may appear; with it on,
    family.js's clampNote is what stands between these bytes and a page.
    """
    t = BookTree()
    t.person("f", "Farida Khan", "FEMALE", "1948",
             notes="Taught at the girls' school in Lucknow for thirty years.\n"
                   "Kept every letter.\nPlanted the neem in the courtyard.\n"
                   "A fourth line no card has room for.")
    t.person("husband", "Salim Khan", "MALE", "1944", "2012",
             notes=f"Ran the {RLO}yrotcaf{PDF} paper factory{BEL} on\tStation Road.")
    t.couple("f", "husband", "WIDOWED")
    t.person("son", "Imran Khan", "MALE", "1972",
             notes=f"{NUL}{BS}{ESC}[31mnot a colour{ESC}[0m\r\nSecond line\r\n")
    t.person("daughter", "Nasreen Khan", "FEMALE", "1975",
             notes=f"{RLI}Khuda hafiz{PDI}, she said, in three languages. {RLM}ok{RLM}")
    t.person("grandson", "Zaid Khan", "MALE", "2001", notes="   \n\t\n   ")
    t.child(["f", "husband"], "son")
    t.child(["f", "husband"], "daughter")
    t.child(["son"], "grandson")
    return t


def story_devanagari():
    """A family written in Devanagari, with one English name married in and one name lost."""
    t = BookTree()
    t.person("pgf", "रामनारायण द्विवेदी", "MALE", "1928", "1996")
    t.person("pgm", "सरस्वती देवी", "FEMALE", "1932", "2011")
    t.couple("pgf", "pgm", "WIDOWED")
    t.person("mgf", "श्यामसुंदर त्रिपाठी", "MALE", "1930", "2002")
    t.person("mgm", None, "FEMALE", "1935", "1990")
    t.couple("mgf", "mgm", "WIDOWED")
    t.person("father", "कृष्णकांत द्विवेदी", "MALE", "1958")
    t.person("mother", "उर्मिला द्विवेदी", "FEMALE", "1962")
    t.child(["pgf", "pgm"], "father")
    t.child(["mgf", "mgm"], "mother")
    t.couple("father", "mother")
    t.person("chacha", "राधाकांत द्विवेदी", "MALE", "1961")
    t.child(["pgf", "pgm"], "chacha")
    t.person("mama", "गिरीश त्रिपाठी", "MALE", "1965")
    t.child(["mgf", "mgm"], "mama")
    t.person("f", "अनुराधा द्विवेदी", "FEMALE", "1988", notes="संगीत की शिक्षिका।")
    t.person("f-husband", "Daniel Fernandes", "MALE", "1986")
    t.child(["father", "mother"], "f")
    t.couple("f", "f-husband")
    t.person("f-sib", "अभिषेक द्विवेदी", "MALE", "1991")
    t.child(["father", "mother"], "f-sib")
    t.person("f-kid", "आर्या फ़र्नांडिस", "FEMALE", "2018")
    t.child(["f", "f-husband"], "f-kid")
    return t


def story_tiny():
    """Three people: a couple and their son. A storybook collapses to a handful of pages."""
    t = BookTree()
    t.person("father", "Tenzin Dorjee", "MALE", "1984")
    t.person("mother", "Pema Lhamo", "FEMALE", "1987")
    t.couple("father", "mother")
    t.person("f", "Karma Dorjee", "MALE", "2015")
    t.child(["father", "mother"], "f")
    return t


def story_unnamed():
    """
    Five people over three generations, and not one of them has a name. Nobody is asked for by id
    or by branch scope here, so `resolveFeatured` (story/featured.js) falls back to its
    mostConnected pick among named people - and finds none. F is null, and the story planner
    (story/plan.js) takes its `shape.empty` path - the same one an empty tree takes - regardless of
    how many people are in the record: a cover, a page waiting for its family, the register (which
    still has to list everyone, so it is one page or more) and the closing. Five is enough to prove
    that the shape holds past the tiny-family cutoff, not just at zero (#245, per #251's note).
    """
    t = BookTree()
    t.person("gf", None, "MALE", "1930", "1998")
    t.person("gm", None, "FEMALE", "1934", "2015")
    t.couple("gf", "gm", "WIDOWED")
    t.person("parent", None, "MALE", "1958")
    t.child(["gf", "gm"], "parent")
    t.person("child1", None, "FEMALE", "1985")
    t.person("child2", None, "MALE", "1988")
    t.child(["parent"], "child1")
    t.child(["parent"], "child2")
    return t


# name -> (builder, what it is, the people a test can name). A None builder is the empty tree as
# Android's exporter writes it: no people, and no empty lists either.
BOOK_FIXTURES = {
    "large": (story_large, "about 200 people, six generations, both of F's sides known",
              {"featured": "f", "father": "father", "mother": "mother",
               "grandparents": ["pgf", "pgm", "mgf", "mgm"], "siblings": ["f-sib0", "f-sib1"]}),
    "eldest": (story_eldest, "F is the eldest: no ancestors known", {"featured": "f"}),
    "leaf": (story_leaf, "F is a child: parents and four grandparents, no spouse or children",
             {"featured": "f", "father": "father", "mother": "mother", "siblings": ["brother"]}),
    "half-siblings": (story_half_siblings, "a remarriage: full, half, step and explicit siblings",
                      {"featured": "f", "full": ["full-1"],
                       "half": ["half-1", "half-2", "half-3", "half-4"],
                       "explicit": ["half-4", "gf-brother", "gf-sister"]}),
    "twelve-siblings": (story_twelve_siblings, "twelve children of one couple, F the seventh",
                        {"featured": "f"}),
    "three-spouses": (story_three_spouses, "F married three times: former, late and current",
                      {"featured": "f", "former": "former", "late": "late", "current": "current"}),
    "unlinked": (story_unlinked, "F is linked to nobody", {"featured": "f"}),
    "unknown-names": (story_unknown_names, "people whose names are lost",
                      {"featured": "f",
                       "unnamed": ["unknown-father", "shyam-wife", "son-wife", "unknown-child"]}),
    "notes": (story_notes, "notes with control and bidi characters", {"featured": "f"}),
    "devanagari": (story_devanagari, "a family written in Devanagari", {"featured": "f"}),
    "tiny": (story_tiny, "three people", {"featured": "f"}),
    "unnamed": (story_unnamed, "five people over three generations, nobody named",
               {}),
    "empty": (None, "an empty tree, as Android exports it", {}),
}


def visible_json(value):
    """
    JSON with Devanagari left readable and every control or format character escaped: a bidi
    override written raw into a committed file reorders what a reviewer sees on screen, which is
    exactly the trick the notes fixture exists to test the composer against.
    """
    text = json.dumps(value, ensure_ascii=False, indent=1)
    def escape(c):
        n = ord(c)
        if n <= 0xFFFF:
            return f"\\u{n:04x}"
        n -= 0x10000   # JSON has no 5-digit escape: a surrogate pair
        return f"\\u{0xD800 + (n >> 10):04x}\\u{0xDC00 + (n & 0x3FF):04x}"

    return "".join(escape(c) if c != "\n" and unicodedata.category(c) in ("Cc", "Cf") else c
                   for c in text)


def book_fixture_files():
    """Every storybook fixture's file name and exact bytes, plus the manifest describing them."""
    files = {}
    manifest = {"about": "Generated by tools/make_sample_tree.py --book-fixtures. Do not edit by hand.",
                "fixtures": {}}
    for name, (build, about, ids) in BOOK_FIXTURES.items():
        doc = build().document() if build else {"format": "f-tree", "version": 1}
        file = f"{BOOK_FIXTURE_PREFIX}{name}.json"
        files[file] = (visible_json(doc) + "\n").encode()
        manifest["fixtures"][file] = {"about": about, "people": len(doc.get("people", [])),
                                      "ids": ids}
    files["storybook.json"] = (visible_json(manifest) + "\n").encode()
    return files


def write_book_fixtures(out):
    out.mkdir(parents=True, exist_ok=True)
    files = book_fixture_files()
    for orphan in out.glob(f"{BOOK_FIXTURE_PREFIX}*.json"):
        if orphan.name not in files:
            orphan.unlink()
            print(f"removed {orphan}, which the generator no longer makes")
    for file, data in files.items():
        (out / file).write_bytes(data)
        print(f"{out / file}  {len(data) / 1024:.1f} KB")


def check_book_fixtures(out):
    files = book_fixture_files()
    stale = [f for f, data in files.items() if not (out / f).exists() or (out / f).read_bytes() != data]
    # A story-* file nothing generates any more is still loaded by the invariant suite.
    stale += sorted(p.name for p in out.glob(f"{BOOK_FIXTURE_PREFIX}*.json") if p.name not in files)
    if stale:
        sys.exit("These storybook fixtures differ from what tools/make_sample_tree.py makes:\n  "
                 + "\n  ".join(stale)
                 + "\n(a file the generator no longer makes must be deleted)"
                 + "\nOther issues' tests name these people, so check what reads them, then run:\n"
                 "    python3 tools/make_sample_tree.py --book-fixtures site/book/fixtures\n")
    print(f"{len(files)} storybook fixtures in {out} are current")


if __name__ == "__main__":
    # The storybook's fixtures: JSON documents for site/book/fixtures, and CI's check that the
    # committed ones are still exactly what this script makes. They hold no photographs, so they
    # need no Pillow; the archives below do, and still refuse to run without it.
    if len(sys.argv) > 1 and sys.argv[1] in ("--book-fixtures", "--check-book-fixtures"):
        target = Path(sys.argv[2] if len(sys.argv) > 2 else "site/book/fixtures")
        (write_book_fixtures if sys.argv[1] == "--book-fixtures" else check_book_fixtures)(target)
        sys.exit(0)

    require_pillow()

    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)

    tree, photos = sample()
    write_archive(out / "sample-family.ftree", tree, photos)
    write_archive(out / "sample-streamed.ftree", tree, photos, streamed=True)

    kin, _ = cousins()
    write_archive(out / "a-cousins-tree.ftree", kin, {})

    big, _ = large()
    write_archive(out / "large-tree.ftree", big, {})
