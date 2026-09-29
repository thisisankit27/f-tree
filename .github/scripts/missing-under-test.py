#!/usr/bin/env python3
"""Every class the test APK names that R8 removed from the app -- the whole set, in one build.

Finding these one per run costs a quarter of an hour each and never tells you how many are left.
Both halves of the answer are already on disk after a release assemble:

  * what R8 removed from the app  -- `mapping/release/usage.txt`, which lists every discarded
    class and member;
  * what the test APK refers to   -- the `type_ids` table of its dex files, which is exactly the
    set of types its code can mention.

A class in both is one the runner will die on, because the test APK does not carry its own copy:
it arrives in the app transitively, AGP leaves it out of the test APK as a duplicate, and then
the app's R8 drops it because no app code names it.

The dex table is read directly rather than through dexdump, whose output for an APK this size is
hundreds of megabytes of disassembly to grep for something the header already indexes.

Prints two lists. The first is third-party scaffolding, which is safe to keep in the app under
test: keeping Room or tracing plumbing hides nothing, because the breakage this run exists to
catch lives in app code. The second is anything under com.vibethroughcode, which is NOT to be
kept -- app code stays minified, and a name in that list means something needs solving other
than with a keep rule.
"""
import struct
import sys
import zipfile
from pathlib import Path

APP_PACKAGE = "com.vibethroughcode."


def dex_type_names(dex: bytes) -> set[str]:
    """The type_ids table of one dex, as dotted class names."""
    if dex[:4] not in (b"dex\n", b"dey\n"):
        return set()
    string_ids_size, string_ids_off = struct.unpack_from("<II", dex, 56)
    type_ids_size, type_ids_off = struct.unpack_from("<II", dex, 64)

    def string_at(index: int) -> str:
        off = struct.unpack_from("<I", dex, string_ids_off + index * 4)[0]
        # uleb128 length, then modified-UTF8 up to a NUL.
        shift = 0
        while dex[off] & 0x80:
            off += 1
            shift += 7
        off += 1
        end = dex.index(b"\x00", off)
        return dex[off:end].decode("utf-8", "replace")

    names = set()
    for i in range(type_ids_size):
        descriptor = string_at(struct.unpack_from("<I", dex, type_ids_off + i * 4)[0])
        if descriptor.startswith("L") and descriptor.endswith(";"):
            names.add(descriptor[1:-1].replace("/", "."))
    return names


def referenced_by(apk: Path) -> set[str]:
    names: set[str] = set()
    with zipfile.ZipFile(apk) as zf:
        for entry in zf.namelist():
            if entry.startswith("classes") and entry.endswith(".dex"):
                names |= dex_type_names(zf.read(entry))
    return names


def removed_from_app(usage: Path) -> set[str]:
    """Class names in usage.txt. Members are indented; a bare line is a whole class R8 discarded."""
    removed = set()
    for line in usage.read_text(errors="replace").splitlines():
        if not line or line[0].isspace() or line.lstrip().startswith("#"):
            continue
        name = line.split(":")[0].strip()
        if name and "(" not in name:
            removed.add(name)
    return removed


def main() -> int:
    apk, usage = Path(sys.argv[1]), Path(sys.argv[2])
    if not apk.exists() or not usage.exists():
        print(f"need both {apk} and {usage}")
        return 1
    missing = sorted(referenced_by(apk) & removed_from_app(usage))
    scaffolding = [n for n in missing if not n.startswith(APP_PACKAGE)]
    app = [n for n in missing if n.startswith(APP_PACKAGE)]

    print(f"--- {len(scaffolding)} third-party classes the test APK names and R8 removed ---")
    for n in scaffolding:
        print(f"  {n}")
    print(f"--- {len(app)} app classes in the same position (NOT to be kept) ---")
    for n in app:
        print(f"  {n}")
    if app:
        print("app code stays minified; these need an answer other than a keep rule")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
