/*
 * The only bridge between the page and the machine.
 *
 * The renderer is the website's viewer, loaded from disk and running with node integration off,
 * so it cannot reach the filesystem on its own. Everything it is allowed to do is named here and
 * nowhere else: choose a file, read the one it was given, remember which one that was. A tree is
 * somebody's family, and the reason the app never uploads it is the same reason this list is
 * short and explicit rather than a general-purpose `fs`.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ftreeDesktop', {
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),

  /**
   * What the reader has chosen, and one way to change it.
   *
   * `set` returns the settings as they *became*, not as they were asked to be. Two reasons: the
   * cross-setting rules can change more than the one key that was set -- turning updates off also
   * clears what the last check found -- and turning betas on asks a question the reader can answer
   * no to. A dialog that assumed its own value would then show the opposite of the truth.
   */
  settings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),

  /**
   * This installation's own id, stamped into a tree started here.
   *
   * Not cosmetic: a tree written with an empty origin cannot be told apart from every other
   * desktop's, and importing two of them into one another merges strangers. See identity.js.
   */
  installationId: () => ipcRenderer.invoke('app:installationId'),

  /** Opens the system file picker and returns { name, bytes } or null if it was cancelled. */
  chooseTree: () => ipcRenderer.invoke('tree:choose'),

  /**
   * Picks a second tree to merge into the one already open.
   *
   * Separate from `chooseTree` because the two are different acts: opening replaces what is on
   * screen, importing adds to it, and only opening should be remembered for next launch.
   */
  chooseImportTree: () => ipcRenderer.invoke('tree:chooseImport'),

  /** The tree opened last time, reopened on launch so the app starts where it was left. */
  lastTree: () => ipcRenderer.invoke('tree:last'),
  forgetTree: () => ipcRenderer.invoke('tree:forget'),

  /**
   * Saves a tree the page has already serialised and verified.
   *
   * Bytes, never a document: the page owns the format -- the writer, the reader it checks itself
   * with, and the tree. Sending a document for the other side to encode would put a second
   * encoder in the app and leave the verification checking something other than what gets
   * written. The main process writes to a temporary file, fsyncs it, keeps the previous contents
   * as `.bak` and renames atomically over the target.
   */
  saveTree: (bytes, path) => ipcRenderer.invoke('tree:save', { bytes, path }),
  saveTreeAs: (bytes, suggest) => ipcRenderer.invoke('tree:saveAs', { bytes, suggest }),

  /** Lets the window refuse to close on unsaved work, and marks the title bar as edited. */
  setDirty: (dirty) => ipcRenderer.send('tree:dirty', dirty),

  /** The menu and the OS both open files; the page hears about it the same way either way. */
  onOpenTree: (handler) => ipcRenderer.on('tree:opened', (_e, tree) => handler(tree)),
  onMenuCommand: (handler) => ipcRenderer.on('menu:command', (_e, command) => handler(command)),
});
