/*
 * Earlier versions of a tree, kept where the reader never has to see them.
 *
 * Autosave (#149) writes the open file a second or two after every change. That is what makes the
 * Save button unnecessary, and it is also what makes a mistake permanent the moment it is made: an
 * accidental delete is on disk before anybody has noticed it. Undo covers the window the app is
 * open; this covers the rest.
 *
 * The rule is Android's, from `TreeImporter.kt`'s pre-import backup -- "keep a few, not a growing
 * pile; these exist to undo a mistake noticed soon after" -- with a policy for *when* that suits a
 * file written continuously:
 *
 *   - one copy of the file as it was before the first write of each run, so opening a tree and
 *     spoiling it always leaves the version you opened
 *   - then at most one every ten minutes while writing continues, so an afternoon's work has a few
 *     points to go back to rather than one per keystroke
 *   - the newest five per tree, and nothing older
 *
 * They live in the app's own data folder, one folder per tree, and nothing is added beside the file
 * the reader chose. That replaces the `<name>.bak` the atomic writer used to leave next to it, which
 * under autosave would have been overwritten every second and so held only the version from a
 * moment earlier.
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const KEEP = 5;
const INTERVAL_MS = 10 * 60 * 1000;

/** Sortable as text, and legal in a file name on every platform: no colons. */
function stampFor(date) {
  return `${date.toISOString().replace(/:/g, '-')}.ftree`;
}

/** The moment a stamp was taken, or NaN for a file that is not one of ours. */
function timeOf(name) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(\.\d+)?Z\.ftree$/.exec(name);
  if (!match) return NaN;
  return Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[5] ?? ''}Z`);
}

/**
 * The folder one tree's backups live in.
 *
 * Named for the file so a person looking in it can tell trees apart, and suffixed with a hash of the
 * full path so two files both called `family.ftree` in different folders never share one.
 */
function folderFor(root, target) {
  const resolved = path.resolve(target);
  const base = path.basename(resolved).replace(/\.ftree$/i, '');
  const slug = base.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    || 'tree';
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 10);
  return path.join(root, `${slug}-${hash}`);
}

/**
 * Whether to take a backup now, and which old ones to let go.
 *
 * Pure, so the policy is settled by a test table rather than by waiting ten minutes.
 *
 * @param {{existing: string[], takenThisRun: boolean, now: Date, keep?: number, interval?: number}}
 * @returns {{take: boolean, prune: string[]}}
 */
function plan({ existing, takenThisRun, now, keep = KEEP, interval = INTERVAL_MS }) {
  const ours = existing.filter((name) => Number.isFinite(timeOf(name))).sort();
  const newest = ours.at(-1);
  const take = !takenThisRun || !newest || now.getTime() - timeOf(newest) >= interval;
  const after = take ? ours.length + 1 : ours.length;
  const excess = Math.max(0, after - keep);
  return { take, prune: ours.slice(0, excess) };
}

/**
 * Copies the file at `target` into its backup folder, if the policy says so.
 *
 * Called before every write, and deliberately unable to stop one: a backup that failed is a line in
 * the log, while a save refused because a backup failed would lose the very edit it was protecting.
 *
 * @param {string} target the tree about to be overwritten
 * @param {{root: string, now?: Date, takenThisRun: Set<string>}} options `takenThisRun` is the set of
 *   paths already backed up since the app started; this adds to it
 * @returns {Promise<string|null>} the backup written, or null if none was needed
 */
async function backUpBefore(target, { root, now = new Date(), takenThisRun }) {
  const resolved = path.resolve(target);
  const existing = await fs.readFile(resolved).catch(() => null);
  if (!existing) return null;   // a new file has no earlier version to keep

  const folder = folderFor(root, resolved);
  await fs.mkdir(folder, { recursive: true });
  const names = await fs.readdir(folder);
  const { take, prune } = plan({ existing: names, takenThisRun: takenThisRun.has(resolved), now });
  if (!take) return null;

  const written = path.join(folder, stampFor(now));
  await fs.writeFile(written, existing);
  // Which tree this folder is for, in words, for whoever opens it from File > Show backups.
  await fs.writeFile(path.join(folder, 'README.txt'),
    `Earlier versions of ${resolved}, kept by f-tree.\n`
    + 'Open one with File > Open tree to look at it; save it under a new name to keep it.\n');
  takenThisRun.add(resolved);

  for (const name of prune) await fs.rm(path.join(folder, name), { force: true });
  return written;
}

module.exports = { KEEP, INTERVAL_MS, stampFor, timeOf, folderFor, plan, backUpBefore };
