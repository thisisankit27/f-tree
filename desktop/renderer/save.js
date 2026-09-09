/*
 * Turning an edited tree into bytes, and checking them before they go anywhere near the disk.
 *
 * The desktop app has been able to lose nothing so far, because it only ever read. This is the
 * file where that stops being true, so it is the file that has to be careful.
 *
 * The guarantee is not "the writer is correct" -- it is a second implementation of a format and
 * it can be wrong. The guarantee is that **a save that would lose something does not happen at
 * all**. Every save is read back, in memory, through the same reader the app opens files with,
 * and compared against the tree still held in memory -- not against the document that was handed
 * to the writer, which would only ever catch the writer. If the count of people or relationships
 * disagrees, or the archive will not parse, the bytes are refused and the file on disk is left
 * exactly as it was.
 *
 * That is cheaper than it sounds -- a tree is a few hundred kilobytes and no disk is touched --
 * and it turns a whole category of writer bug from "somebody's family is gone" into "f-tree
 * would not save, and said why".
 */

import { writeTreeArchive } from '../../site/playground/write.js';
import { openArchive, parseDocument } from '../../site/playground/archive.js';

export class SaveRefused extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

/**
 * Compares what came back against what the tree actually holds.
 *
 * Note the second operand: the *tree*, not the exchange document that was handed to the writer.
 * Comparing the document against the read-back would only ever catch a bug in the writer, because
 * a `toExchange` that quietly dropped somebody would produce a document that agrees with itself
 * perfectly. Measuring from the tree covers the whole chain -- model, serialiser, ZIP, reader --
 * and makes the guarantee the one worth having: what is on screen is what is in the file.
 *
 * Counts and ids, not deep equality: the reader is allowed to normalise (it drops edges whose ends
 * are missing, for one), and asserting identical structures would fail on the reader doing its
 * job. What must never differ is *who is in the file*.
 */
function differences(before, after) {
  const problems = [];

  if (after.people.length !== before.people.length) {
    problems.push(`${before.people.length} people written, ${after.people.length} read back`);
  }
  if (after.relationships.length !== before.relationships.length) {
    problems.push(`${before.relationships.length} relationships written, `
      + `${after.relationships.length} read back`);
  }

  const wrote = new Set(before.people.map((p) => p.id));
  const missing = before.people.filter((p) => !after.people.some((q) => q.id === p.id));
  const strangers = after.people.filter((p) => !wrote.has(p.id));
  if (missing.length) {
    problems.push(`missing after the round trip: ${missing.slice(0, 3)
      .map((p) => p.name ?? p.id).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}`);
  }
  if (strangers.length) problems.push(`${strangers.length} people appeared that were not written`);

  return problems;
}

/**
 * The bytes for a tree, proven readable before they are returned.
 *
 * @param {{toExchange: (now?: Date) => object}} tree
 * @param {Map<string, Uint8Array>} photos entry path -> bytes
 * @returns {Promise<{bytes: Uint8Array, people: number, relationships: number}>}
 * @throws {SaveRefused} when the archive does not read back as what was written
 */
export async function bytesForTree(tree, photos = new Map(), now = new Date()) {
  const held = { people: tree.people, relationships: tree.relationships };

  let bytes;
  try {
    bytes = await writeTreeArchive(tree.toExchange(now), photos, now);
  } catch (error) {
    /*
     * The writer refuses documents it cannot represent -- a person with no id, an edge with one
     * end. From here that is the same outcome as a failed check and deserves the same answer:
     * nothing was written, and here is why.
     */
    throw new SaveRefused('f-tree could not write your tree to a file.',
      `${error.message}\n\nNothing has been saved and the file on disk is unchanged.`);
  }

  let read;
  try {
    const archive = await openArchive(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (!archive.has('tree.json')) throw new Error('the archive came back without a tree.json');
    read = parseDocument(await archive.readText('tree.json'));

    for (const name of photos.keys()) {
      if (!archive.has(name)) throw new Error(`the archive came back without ${name}`);
    }
  } catch (error) {
    throw new SaveRefused('f-tree could not verify the file it was about to write.',
      `${error.message}\n\nNothing has been saved and the file on disk is unchanged.`);
  }

  const problems = differences(held, read);
  if (problems.length) {
    throw new SaveRefused('f-tree would have written a file that does not match your tree.',
      `${problems.join('\n')}\n\nNothing has been saved and the file on disk is unchanged. `
      + 'Please report this — it is a bug in f-tree, not in your tree.');
  }

  return {
    bytes,
    people: read.people.length,
    relationships: read.relationships.length,
  };
}
