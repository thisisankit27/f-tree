/*
 * Writing a .ftree archive.
 *
 * The counterpart to archive.js, and the first piece of the editor: until a tree can go back to
 * disk, nothing that changes one can be built. What it produces has to be openable by the Android
 * app, because that is where these files live — a file only this code can read would be a private
 * format wearing the same extension.
 *
 * Two facts about the other end shape everything here, and they pull in opposite directions.
 *
 * Reading, the app writes with `java.util.zip.ZipOutputStream`, which for a DEFLATED entry zeroes
 * the CRC and both sizes in the local header, sets general purpose bit 3, and puts the real values
 * in a data descriptor after the compressed bytes. So archive.js must read the central directory;
 * a reader trusting local headers sees every entry as empty. That note is at the top of that file.
 *
 * Writing, the app reads with `java.util.zip.ZipInputStream` (TreeImporter.readDocument), which
 * walks *local headers* forward and never looks at the central directory at all. So the asymmetry
 * runs the other way and is the single most important thing in this file:
 *
 *      every local header must carry the true CRC-32 and both sizes, up front.
 *
 * No data descriptor, no bit 3, no streaming. The whole archive is built in memory and every size
 * is known before its header is written. A family tree is a few hundred kilobytes plus photographs
 * the machine was already holding, so buying certainty with memory is the right trade — and the
 * archive stays readable by both readers, and by `unzip`, Python and anything else.
 *
 * The JSON matches what the app's own exporter emits, field for field: `format` and `version`
 * always, everything else omitted when it equals its default. Kotlin would accept explicit nulls,
 * so this is not required — but a file written here should be indistinguishable from one written
 * there, and small for the same reasons.
 */

const ENTRY_JSON = 'tree.json';
const ENTRY_PHOTOS = 'photos/';
const FORMAT = 'f-tree';
const VERSION = 1;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/* Written into every header. 20 means "2.0", which is what DEFLATE requires and no more. */
const VERSION_MADE_BY = 20;
const VERSION_NEEDED = 20;

export class WriteError extends Error {}

/** Present wherever this runs: a modern browser, the Electron renderer, and Node 18+. */
export const canCompress = typeof CompressionStream === 'function';

/* ------------------------------------------------------------------ the document */

/**
 * The exchange format, with defaults left out.
 *
 * Mirrors `ExportJson` in the app (`encodeDefaults = false`), so `deceased` appears only when
 * true, `origins` only when there is one, and an absent name is an absent key rather than a null.
 * `format` and `version` are always written even though they equal their defaults: they are how a
 * reader knows what it is holding, and the app marks them `@EncodeDefault(ALWAYS)` for that reason.
 */
export function encodeDocument(document) {
  const doc = { format: FORMAT, version: VERSION };
  if (document.exportedAt) doc.exportedAt = document.exportedAt;
  if (document.sourceTreeId) doc.sourceTreeId = document.sourceTreeId;

  const people = (document.people ?? []).map((person) => {
    if (!person?.id) throw new WriteError('Every person needs an id.');
    const out = { id: person.id };
    if (person.name != null) out.name = person.name;
    if (person.gender != null) out.gender = person.gender;
    if (person.birthDate != null) out.birthDate = person.birthDate;
    if (person.deathDate != null) out.deathDate = person.deathDate;
    if (person.deceased) out.deceased = true;
    if (person.photo != null) out.photo = person.photo;
    if (person.notes != null) out.notes = person.notes;
    const origins = (person.origins ?? [])
      .filter((o) => o && o.treeId && o.personId)
      .map((o) => ({ treeId: o.treeId, personId: o.personId }));
    if (origins.length) out.origins = origins;
    return out;
  });
  if (people.length) doc.people = people;

  const relationships = (document.relationships ?? []).map((edge) => {
    if (!edge?.id || !edge.from || !edge.to || !edge.type) {
      throw new WriteError('Every relationship needs an id, both ends and a type.');
    }
    const out = { id: edge.id, from: edge.from, to: edge.to, type: edge.type };
    if (edge.subtype != null) out.subtype = edge.subtype;
    return out;
  });
  if (relationships.length) doc.relationships = relationships;

  return doc;
}

/* ------------------------------------------------------------------ the ZIP */

let crcTable = null;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * MS-DOS date and time, which is what a ZIP header stores.
 *
 * Two-second resolution and no time zone: that is the format, not an approximation chosen here.
 * Local time, because every other tool writes local time and a reader showing a file's timestamp
 * two hours out is a puzzle nobody needs. Dates before 1980 cannot be represented and clamp.
 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * One entry, compressed and measured.
 *
 * Stored rather than deflated when deflating made it bigger, which happens with small already-
 * compressed data — a JPEG thumbnail, most often. Both methods are ordinary ZIP and every reader
 * handles them; there is no reason to pay bytes for the label.
 */
async function prepareEntry(name, bytes) {
  const nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length > 0xffff) throw new WriteError(`Entry name too long: ${name}`);

  let method = METHOD_STORE;
  let body = bytes;
  if (bytes.length > 0 && canCompress) {
    const deflated = await deflateRaw(bytes);
    if (deflated.length < bytes.length) {
      method = METHOD_DEFLATE;
      body = deflated;
    }
  }
  return { nameBytes, method, body, crc: crc32(bytes), size: bytes.length };
}

/**
 * A `.ftree`: `tree.json` first, then one entry per photo.
 *
 * `tree.json` leads because the app's reader stops at it, so putting it first means opening a
 * tree never reads past the only entry it wanted. No `photos/` directory entry is written; the
 * app's exporter does not write one either, and the paths carry the structure.
 *
 * @param {object} document        the tree, in the exchange shape
 * @param {Map<string, Uint8Array>|object} photos  entry path -> bytes, e.g. `photos/abc.jpg`
 * @param {Date} now               timestamp for the entries
 * @returns {Promise<Uint8Array>}  the whole archive
 */
export async function writeTreeArchive(document, photos = new Map(), now = new Date()) {
  const json = new TextEncoder().encode(JSON.stringify(encodeDocument(document)));

  const photoEntries = photos instanceof Map ? [...photos] : Object.entries(photos ?? {});
  for (const [name] of photoEntries) {
    if (!name.startsWith(ENTRY_PHOTOS) || name.endsWith('/')) {
      throw new WriteError(`A photo entry must be a file under ${ENTRY_PHOTOS}, got: ${name}`);
    }
  }

  const entries = [await prepareEntry(ENTRY_JSON, json)];
  for (const [name, bytes] of photoEntries) {
    entries.push(await prepareEntry(name, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
  }

  const { time, date } = dosDateTime(now);
  const local = entries.reduce((n, e) => n + 30 + e.nameBytes.length + e.body.length, 0);
  const central = entries.reduce((n, e) => n + 46 + e.nameBytes.length, 0);

  const out = new Uint8Array(local + central + 22);
  const view = new DataView(out.buffer);
  let at = 0;

  for (const entry of entries) {
    entry.offset = at;
    view.setUint32(at, SIG_LOCAL, true);
    view.setUint16(at + 4, VERSION_NEEDED, true);
    // Flags zero: no data descriptor, because the app reads local headers and would believe them.
    view.setUint16(at + 6, 0, true);
    view.setUint16(at + 8, entry.method, true);
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.body.length, true);
    view.setUint32(at + 22, entry.size, true);
    view.setUint16(at + 26, entry.nameBytes.length, true);
    view.setUint16(at + 28, 0, true);
    at += 30;
    out.set(entry.nameBytes, at); at += entry.nameBytes.length;
    out.set(entry.body, at); at += entry.body.length;
  }

  const centralAt = at;
  for (const entry of entries) {
    view.setUint32(at, SIG_CENTRAL, true);
    view.setUint16(at + 4, VERSION_MADE_BY, true);
    view.setUint16(at + 6, VERSION_NEEDED, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, entry.method, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.body.length, true);
    view.setUint32(at + 24, entry.size, true);
    view.setUint16(at + 28, entry.nameBytes.length, true);
    view.setUint16(at + 30, 0, true);   // extra
    view.setUint16(at + 32, 0, true);   // comment
    view.setUint16(at + 34, 0, true);   // disk
    view.setUint16(at + 36, 0, true);   // internal attributes
    view.setUint32(at + 38, 0, true);   // external attributes
    view.setUint32(at + 42, entry.offset, true);
    at += 46;
    out.set(entry.nameBytes, at); at += entry.nameBytes.length;
  }

  view.setUint32(at, SIG_EOCD, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, central, true);
  view.setUint32(at + 16, centralAt, true);
  view.setUint16(at + 20, 0, true);

  return out;
}
