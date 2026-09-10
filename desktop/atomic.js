/*
 * Putting a file on disk without ever being able to leave it half-written.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

/*
 * Writing a tree back, without ever being able to leave one half-written.
 *
 * Until now this app could only read, and the download page says so. This is where that stops
 * being true, so this is where the care goes. Three things, in order:
 *
 * 1. The page has already read its own bytes back and compared them against the tree it holds
 *    (renderer/save.js). Nothing reaches here that has not survived that.
 *
 * 2. The bytes go to a temporary file in the *same directory*, are flushed to the platter with
 *    fsync, and are then renamed over the target. Rename within a directory is atomic, so at
 *    every instant the path holds either the old complete file or the new complete file. A power
 *    cut in the middle costs the edit, never the tree. The temp file must share the directory:
 *    a rename across filesystems is a copy, and copies are interruptible.
 *
 * 3. Nothing else is written beside the file. It used to leave the previous version there as
 *    `<name>.bak`, which under autosave (#149) would be overwritten every second and so only ever
 *    hold the version from a moment ago. Earlier versions are kept by `backups.js` instead, in the
 *    app's own folder, on a schedule that makes them worth having.
 *
 * The directory itself is fsynced too, which is what actually makes the rename durable; without
 * it the file contents survive a crash and the directory entry pointing at them may not.
 */
async function writeTreeFile(target, bytes) {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${path.basename(target)}.saving-${process.pid}`);

  let handle;
  try {
    handle = await fs.open(temporary, 'w');
    await handle.writeFile(Buffer.from(bytes));
    await handle.sync();
  } finally {
    await handle?.close();
  }

  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }

  // Makes the rename itself survive a crash, not just the bytes it points at.
  let dir;
  try {
    dir = await fs.open(directory, 'r');
    await dir.sync();
  } catch {
    // Not every platform lets a directory be opened for sync; the rename is still atomic.
  } finally {
    await dir?.close();
  }
}


module.exports = { writeTreeFile };
