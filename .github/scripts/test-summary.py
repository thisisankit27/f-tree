#!/usr/bin/env python3
"""Summarise a connected-test run from its JUnit XML.

Written as a file with a fixture beside it, rather than a line of grep in the workflow, because
the grep it replaces got the answer backwards: it counted `<failure ` with a trailing space, and
UTP writes `<failure>` with no attributes at all, so a run where every test errored on a missing
class reported "failed: 0" and read as a pass.

Counts elements by parsing the XML, so the presence or absence of attributes cannot change the
answer, and counts <error> separately from <failure> because a test that could not run at all is
not the same as one that ran and disagreed.
"""
import collections
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def summarise(root: Path):
    cases = failures = errors = 0
    causes: collections.Counter[str] = collections.Counter()
    failed: list[str] = []
    for xml in sorted(root.rglob("*.xml")):
        try:
            tree = ET.parse(xml)
        except ET.ParseError:
            continue
        for case in tree.iter("testcase"):
            cases += 1
            bad = list(case.findall("failure")) + list(case.findall("error"))
            failures += len(case.findall("failure"))
            errors += len(case.findall("error"))
            if bad:
                failed.append(f'{case.get("classname")}.{case.get("name")}')
            for node in bad:
                text = (node.get("message") or node.text or "").strip()
                first = text.splitlines()[0] if text else "(no message)"
                # The interesting part is the kind of breakage, not the receiver's obfuscated name.
                first = re.sub(r"\s+", " ", first)[:160]
                causes[first] += 1
    return cases, failures, errors, causes, failed


def selftest() -> int:
    """Check the parser against the two shapes UTP actually writes.

    The first fixture is the run this script exists because of: 201 tests, every one an <error>
    with no attributes. The grep it replaced reported 0 for that, which read as success.
    """
    here = Path(__file__).parent / "testdata"
    cases, failures, errors, _, failed = summarise(here / "errored-run")
    assert (cases, failures, errors) == (201, 0, 201), (cases, failures, errors)
    assert len(failed) == 201, len(failed)
    cases, failures, errors, causes, failed = summarise(here / "mixed-run")
    assert (cases, failures, errors) == (3, 1, 1), (cases, failures, errors)
    assert len(failed) == 2, failed
    # `message` is preferred over the element text where both exist, being the more useful of
    # the two -- the assertion's own words rather than the name of its exception class.
    assert any("expected:<2> but was:<3>" in c for c in causes), causes
    print("test-summary selftest: ok")
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        return selftest()
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    if not root.is_dir():
        print(f"no results at {root} -- the run did not get far enough to write any")
        return 0
    cases, failures, errors, causes, failed = summarise(root)
    print(f"ran:      {cases}")
    print(f"failed:   {failures}")
    print(f"errored:  {errors}")
    print(f"not ok:   {failures + errors}")
    if causes:
        print("--- why, most common first ---")
        for text, n in causes.most_common(15):
            print(f"{n:5d}  {text}")
    if failed:
        print(f"--- {len(failed)} tests not ok ---")
        for name in sorted(set(failed))[:40]:
            print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
