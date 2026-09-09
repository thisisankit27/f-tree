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

  /** Opens the system file picker and returns { name, bytes } or null if it was cancelled. */
  chooseTree: () => ipcRenderer.invoke('tree:choose'),

  /** The tree opened last time, reopened on launch so the app starts where it was left. */
  lastTree: () => ipcRenderer.invoke('tree:last'),
  forgetTree: () => ipcRenderer.invoke('tree:forget'),

  /** The menu and the OS both open files; the page hears about it the same way either way. */
  onOpenTree: (handler) => ipcRenderer.on('tree:opened', (_e, tree) => handler(tree)),
  onMenuCommand: (handler) => ipcRenderer.on('menu:command', (_e, command) => handler(command)),
});
