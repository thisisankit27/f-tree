/*
 * Reading a .ftree archive in the browser.
 *
 * A .ftree is a ZIP holding tree.json plus a photos/ directory. Nothing here talks to a network:
 * the file is read from the user's own disk into memory and never leaves the tab, which is the
 * same promise the app makes and would be worth nothing if this page quietly posted the tree
 * somewhere to render it.
 *
 * The ZIP is read through its central directory rather than by walking local file headers. That is
 * not a preference — it is required. The app writes the archive with java.util.zip.ZipOutputStream,
 * which for DEFLATED entries emits a local header with the CRC and both sizes zeroed, sets general
 * purpose bit 3, and writes the real values in a data descriptor *after* the compressed bytes. A
 * reader that trusts the local header therefore reads a length of zero for every entry. The central
 * directory always carries the true values, so it is the only honest source.
 */

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export class ArchiveError extends Error {}

/** Inflates a raw deflate stream. Present in every browser this page supports; checked up front. */
export const canDecompress = typeof DecompressionStream === 'function';

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Locates the end-of-central-directory record.
 *
 * It sits at the very end of the file unless a ZIP comment follows it, so the search runs backwards
 * over the last 64KB + 22 bytes — the largest region it can legally be in.
 */
function findEocd(view, size) {
  const limit = Math.max(0, size - 0xffff - 22);
  for (let i = size - 22; i >= limit; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new ArchiveError('This does not look like a .ftree file — no ZIP directory was found.');
}

/**
 * Reads the central directory into a list of entries.
 *
 * ZIP64 is handled for the directory's own location and size. A family archive would need to pass
 * 4GB or 65,535 files to require it, but a photo-heavy tree is not unimaginable and failing on it
 * silently would be worse than the twenty lines it costs to support.
 */
function readDirectory(buffer) {
  const view = new DataView(buffer);
  const size = buffer.byteLength;
  const eocd = findEocd(view, size);

  let count = view.getUint16(eocd + 10, true);
  let dirOffset = view.getUint32(eocd + 16, true);

  const locator = eocd - 20;
  if (locator >= 0 && view.getUint32(locator, true) === SIG_EOCD64_LOCATOR) {
    const eocd64 = Number(view.getBigUint64(locator + 8, true));
    if (eocd64 >= 0 && eocd64 + 56 <= size && view.getUint32(eocd64, true) === SIG_EOCD64) {
      count = Number(view.getBigUint64(eocd64 + 32, true));
      dirOffset = Number(view.getBigUint64(eocd64 + 48, true));
    }
  }

  const decoder = new TextDecoder();
  const entries = [];
  let p = dirOffset;

  for (let i = 0; i < count; i++) {
    if (p + 46 > size || view.getUint32(p, true) !== SIG_CENTRAL) {
      throw new ArchiveError('The archive directory is damaged; the file may be truncated.');
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let compressedSize = view.getUint32(p + 20, true);
    let localOffset = view.getUint32(p + 42, true);

    // Bit 11 marks the name as UTF-8. Older writers used CP437, but every name this format
    // produces is ASCII, so decoding as UTF-8 either way is safe and simpler.
    const name = decoder.decode(new Uint8Array(buffer, p + 46, nameLen));

    // A ZIP64 extra field replaces any size field written as 0xffffffff.
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const headerId = view.getUint16(e, true);
        const dataSize = view.getUint16(e + 2, true);
        if (headerId === 0x0001) {
          let q = e + 4;
          // Fields appear in a fixed order, but only those that overflowed are present.
          if (view.getUint32(p + 24, true) === 0xffffffff) q += 8;      // uncompressed
          if (compressedSize === 0xffffffff) { compressedSize = Number(view.getBigUint64(q, true)); q += 8; }
          if (localOffset === 0xffffffff) localOffset = Number(view.getBigUint64(q, true));
          break;
        }
        e += 4 + dataSize;
      }
    }

    entries.push({ name, method, compressedSize, localOffset, hasDataDescriptor: (flags & 0x08) !== 0 });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * An opened archive. Entries are inflated on demand, so a tree with three hundred photographs
 * costs nothing until a photograph is actually drawn.
 */
export class Archive {
  constructor(buffer, entries) {
    this.buffer = buffer;
    this.entries = new Map(entries.map((e) => [e.name, e]));
  }

  has(name) {
    return this.entries.has(name);
  }

  names() {
    return [...this.entries.keys()];
  }

  async read(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new ArchiveError(`The archive has no ${name}.`);

    const view = new DataView(this.buffer);
    if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
      throw new ArchiveError('The archive is damaged; an entry header is missing.');
    }
    // Only the two lengths are trusted here — everything else in a local header may be zeroed.
    const nameLen = view.getUint16(entry.localOffset + 26, true);
    const extraLen = view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + 30 + nameLen + extraLen;
    const raw = new Uint8Array(this.buffer, start, entry.compressedSize);

    if (entry.method === METHOD_STORE) return raw;
    if (entry.method === METHOD_DEFLATE) return inflateRaw(raw);
    throw new ArchiveError(`Unsupported compression in the archive (method ${entry.method}).`);
  }

  async readText(name) {
    return new TextDecoder().decode(await this.read(name));
  }
}

export async function openArchive(buffer) {
  if (!canDecompress) {
    throw new ArchiveError('This browser cannot unzip files. Try a current Chrome, Safari or Firefox.');
  }
  return new Archive(buffer, readDirectory(buffer));
}

/**
 * Reads a dropped file into a tree document.
 *
 * Accepts a bare tree.json as well as an archive: someone who has unzipped the export to look
 * inside it should not have to zip it back up to view it, and the check costs two bytes.
 */
export async function readTreeFile(file) {
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength < 4) throw new ArchiveError('That file is empty.');

  const head = new Uint8Array(buffer, 0, 4);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;

  if (!isZip) {
    const text = new TextDecoder().decode(buffer).trim();
    if (!text.startsWith('{')) {
      throw new ArchiveError('That is neither a .ftree archive nor a tree.json file.');
    }
    return { document: parseDocument(text), archive: null };
  }

  const archive = await openArchive(buffer);
  if (!archive.has('tree.json')) {
    throw new ArchiveError('That ZIP has no tree.json, so it is not a .ftree export.');
  }
  return { document: parseDocument(await archive.readText('tree.json')), archive };
}

/**
 * Validates the document shape.
 *
 * Mirrors the app's own leniency: unknown keys are ignored and every field but format and version
 * is optional, so a file written by a later release still opens here. A file claiming a *higher*
 * version is refused rather than half-understood, which is the same call the importer makes.
 */
export function parseDocument(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ArchiveError('The tree.json inside that file is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object') throw new ArchiveError('The tree.json is not an object.');
  if (raw.format !== 'f-tree') {
    throw new ArchiveError(`That file says its format is "${raw.format ?? 'missing'}", not f-tree.`);
  }
  const version = Number(raw.version);
  if (!Number.isFinite(version)) throw new ArchiveError('That file does not say which format version it is.');
  if (version > 1) {
    throw new ArchiveError(
      `That file is format version ${version}, which is newer than this page understands. ` +
      'Update the page, or export again from an app of the same age.'
    );
  }

  const people = Array.isArray(raw.people) ? raw.people : [];
  const relationships = Array.isArray(raw.relationships) ? raw.relationships : [];

  return {
    format: raw.format,
    version,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    sourceTreeId: typeof raw.sourceTreeId === 'string' ? raw.sourceTreeId : '',
    people: people.filter((p) => p && typeof p.id === 'string'),
    relationships: relationships.filter(
      (r) => r && typeof r.from === 'string' && typeof r.to === 'string'
    ),
  };
}
