/*
 * This installation's stable id.
 *
 * A port of `transfer/TreeIdentity.kt`, and the thing that lets somebody use this app having never
 * owned the phone app.
 *
 * Every `.ftree` records the installation that produced it, in `sourceTreeId`. That is not
 * bookkeeping: when a file is imported, the importer uses it to recognise people by identity
 * rather than by comparing names --
 *
 *     if (document.sourceTreeId == identity.treeId) {
 *         local.forEach { put(identity.treeId to it.id, it.id) }
 *     }
 *
 * -- so two files claiming the same origin are asserting that people sharing an id are the same
 * person. Without an id of its own, a tree created on this desktop would be written claiming the
 * empty origin, and every desktop in the world would be claiming it too. Importing one such tree
 * into another would then merge strangers.
 *
 * Which is why this exists before the editor does. A file already written with an empty origin
 * cannot be repaired afterwards: it is on somebody's disk, claiming nothing.
 *
 * Note what this is *not* for. A tree that arrived from a phone keeps that phone's id when it is
 * saved here, so the phone still recognises its own file on the way back. This id is minted only
 * for a tree that came from nowhere -- one started on this machine.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = 'identity.json';

/**
 * Reads this installation's id, minting one the first time.
 *
 * @param {string} directory the app's userData directory
 * @returns {Promise<string>}
 */
async function installationId(directory) {
  const file = path.join(directory, FILE);

  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof saved?.treeId === 'string' && saved.treeId) return saved.treeId;
  } catch {
    // Absent on first run, which is ordinary. Unreadable is not, and is handled below the same
    // way: there is nothing to recover, and refusing to start would be a worse answer than
    // starting with a new identity.
  }

  const treeId = crypto.randomUUID();
  await fs.mkdir(directory, { recursive: true });
  /*
   * Written the same way a tree is: to a temporary file, then renamed. An identity half-written
   * by a crash would be read back as absent on the next launch and replaced, quietly detaching
   * this installation from every file it had already produced.
   */
  const temporary = `${file}.new-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify({ treeId }, null, 2)}\n`);
  await fs.rename(temporary, file);
  return treeId;
}

module.exports = { installationId, IDENTITY_FILE: FILE };
