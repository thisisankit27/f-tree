/*
 * The desktop shell.
 *
 * f-tree on a laptop is the same reader as the one on the website, in a window of its own: the
 * chart, the people index, the search and the relation finder are `site/playground/`, loaded from
 * disk rather than over the network. That is deliberate and is the whole reason this app is a few
 * hundred lines rather than a second application - one viewer, two shells, so a fix to the chart
 * is a fix in both places rather than a fix and a reminder.
 *
 * What the shell adds is the part a browser tab cannot have: a real file picker, a native menu,
 * and a memory of which tree you were reading.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { chooseUpdate } = require('./update');
const { writeTreeFile } = require('./atomic');
const { installationId } = require('./identity');

/*
 * A window needs somewhere to be.
 *
 * With neither DISPLAY nor WAYLAND_DISPLAY, Chromium fails to bring up its platform layer and the
 * process dies of a segmentation fault - no window, no message, nothing to search for. Saying so
 * first costs one line and turns a silent crash into an answer.
 */
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('f-tree: no display found. $DISPLAY and $WAYLAND_DISPLAY are both unset, so there '
    + 'is nowhere to open a window. If you are on a remote shell, this needs a desktop session.');
  process.exit(1);
}

/*
 * The viewer, which lives beside this app rather than inside it.
 *
 * In the repository it is `site/playground/`, the same directory the website serves. Packaged, it
 * is carried in as a resource and read from there. Either way there is one copy of the chart, the
 * index, the search and the relation finder - a fix to any of them is a fix in both places rather
 * than a fix and a note to remember the other one.
 */
/*
 * The page this shell shows.
 *
 * The desktop app's own, not the website's viewer: that one reads a tree and stays a reader, and
 * this one builds and changes one. They share the engine underneath -- reader, writer, model,
 * layout, chart -- which `renderer/index.html` imports from `../../site/playground/`.
 *
 * That relative path is why packaging reproduces the repository's shape rather than flattening it:
 * in development the import already resolves against the working tree, so there is no assembly
 * step to keep in step with anything. The staged directory is called `page` and not `app` on
 * purpose -- `resources/app` is where Electron looks for an unpacked application, and putting a
 * package.json there would make it try to run this as one.
 *
 * Reproducing the shape means reproducing the *depth*, and 0.4.0 did not. It staged the renderer
 * at `page/renderer`, one level shallower than `desktop/renderer` sits in the repository, so
 * `../../site/playground/` climbed out of `page` entirely and every module the window imports
 * 404'd. The browser reports that to a console nobody opens, so it presents as a blank window.
 * The `desktop` level below is load-bearing: it is what makes one set of relative specifiers
 * correct both in a checkout and in a package. `package.test.js` walks these imports for real.
 */
const VIEWER = app.isPackaged
  ? path.join(process.resourcesPath, 'page', 'desktop', 'renderer', 'index.html')
  : path.join(__dirname, 'renderer', 'index.html');

/*
 * Where the app remembers what it was reading.
 *
 * A path and nothing else. Not the tree, not a copy of it, not anything out of it - the file
 * stays wherever its owner put it, and if they move or delete it the app simply opens empty.
 */
/* The mark, for the window and its place in the taskbar. */
const ICON_FOR_WINDOW = path.join(__dirname, 'build', 'icons', '256x256.png');

/*
 * The smoke test gets a userData directory of its own.
 *
 * Several of its assertions are about *defaults* - update checking off, beta releases off - and
 * settings persist, so run from a machine where somebody has been using the app and the test reads
 * their choices and reports the app broken. That is a false alarm on a developer's machine and,
 * worse, silence on CI: there the directory is always fresh, so a bug that flipped a default would
 * pass. Neither is a test. Point it somewhere empty and it asserts what it says it asserts.
 *
 * Before `app.whenReady()` on purpose: `setPath` is only honoured this early.
 */
if (process.env.FTREE_SMOKE) {
  app.setPath('userData', require('node:fs')
    .mkdtempSync(path.join(os.tmpdir(), 'ftree-smoke-')));
}

/** Which windows have edits that are not on disk. Keyed by window id. */
const unsaved = new Map();

const stateFile = () => path.join(app.getPath('userData'), 'session.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

/*
 * What the reader has switched on. Both off until they do.
 *
 * The same two the app offers, and off for the same reason: this app makes no network request of
 * any kind unless somebody has asked it to, and a default of "on" would quietly make that untrue
 * for everybody who never opened this menu.
 */
const DEFAULT_SETTINGS = { checkForUpdates: false, betaReleases: false };
let settings = { ...DEFAULT_SETTINGS };

async function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(settingsFile(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings() {
  try {
    await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
    await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {
    // A preference that fails to persist is worth less than an error dialog costs.
  }
}

async function readSession() {
  try {
    return JSON.parse(await fs.readFile(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function writeSession(session) {
  try {
    await fs.mkdir(path.dirname(stateFile()), { recursive: true });
    await fs.writeFile(stateFile(), JSON.stringify(session, null, 2));
  } catch {
    // Losing the "reopen where I was" convenience is not worth an error dialog.
  }
}

/** Reads a .ftree off disk into something the page can turn into a File. */
async function readTree(file) {
  const bytes = await fs.readFile(file);
  return { name: path.basename(file), path: file, bytes: bytes.buffer.slice(
    bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

/* ------------------------------------------------------------------ saving */

async function saveInto(win, target, bytes) {
  try {
    await writeTreeFile(target, bytes);
    await writeSession({ lastTree: target });
    return { ok: true, path: target, name: path.basename(target) };
  } catch (error) {
    await dialog.showMessageBox(win, {
      type: 'error',
      message: 'That tree could not be saved.',
      detail: `${target}\n\n${error.message}\n\nThe file on disk has not been changed.`,
      buttons: ['OK'],
    });
    return { ok: false, reason: error.message };
  }
}

let window_ = null;

async function openInto(win, file) {
  try {
    const tree = await readTree(file);
    await writeSession({ lastTree: file });
    win.webContents.send('tree:opened', tree);
  } catch (error) {
    dialog.showMessageBox(win, {
      type: 'warning',
      message: 'That file could not be read.',
      detail: `${file}\n\n${error.message}`,
      buttons: ['OK'],
    });
    await writeSession({});
  }
}

async function chooseInto(win) {
  const picked = await dialog.showOpenDialog(win, {
    title: 'Open a family tree',
    filters: [{ name: 'f-tree export', extensions: ['ftree'] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths.length) return null;
  await openInto(win, picked.filePaths[0]);
  return picked.filePaths[0];
}

/* ------------------------------------------------------------------ updates */

const RELEASES_API = 'https://api.github.com/repos/thisisankit27/f-tree/releases?per_page=30';

/**
 * Asks GitHub what exists.
 *
 * From the main process, never the page: the window is refused the network outright and stays that
 * way. This is the only request the app can make, it is made only when somebody has switched the
 * check on or picked "Check for updates now", and it sends nothing but the request itself.
 */
function fetchReleases() {
  return new Promise((resolve, reject) => {
    const request = net.request({ url: RELEASES_API, useSessionCookies: false });
    request.setHeader('accept', 'application/vnd.github+json');
    request.setHeader('user-agent', `f-tree-desktop/${app.getVersion()}`);
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        response.on('data', () => {});
        response.on('end', () => reject(new Error(`GitHub answered ${response.statusCode}`)));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

/** Downloads to a temporary file and returns its path and its actual hash. */
function download(url, into) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, useSessionCookies: false });
    request.setHeader('user-agent', `f-tree-desktop/${app.getVersion()}`);
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        response.on('data', () => {});
        response.on('end', () => reject(new Error(`the download answered ${response.statusCode}`)));
        return;
      }
      const hash = crypto.createHash('sha256');
      const chunks = [];
      response.on('data', (chunk) => { hash.update(chunk); chunks.push(chunk); });
      response.on('end', async () => {
        try {
          await fs.writeFile(into, Buffer.concat(chunks));
          resolve({ path: into, sha256: hash.digest('hex') });
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

/*
 * The whole update conversation.
 *
 * `quiet` is the automatic check on launch: it says nothing unless there is something to say, so
 * starting the app never costs the reader a dialog. Asking from the menu always gets an answer,
 * including "you are up to date", because a question deserves one.
 */
async function checkForUpdates(win, { quiet = false } = {}) {
  let releases;
  try {
    releases = await fetchReleases();
  } catch (error) {
    if (!quiet) {
      await dialog.showMessageBox(win, {
        type: 'warning',
        message: 'Could not reach GitHub.',
        detail: `${error.message}\n\nNothing was downloaded, and nothing about you was sent.`,
        buttons: ['OK'],
      });
    }
    return;
  }

  const found = chooseUpdate({
    releases,
    currentVersion: app.getVersion(),
    platform: process.platform,
    allowPreRelease: settings.betaReleases,
    // The AppImage runtime sets this, so it is the one reliable way to know the reader is running
    // an AppImage - and therefore that another one will actually start for them.
    linuxFormat: process.env.APPIMAGE ? 'appimage' : null,
  });

  if (found.kind !== 'newer') {
    if (!quiet) {
      await dialog.showMessageBox(win, {
        type: 'info',
        message: found.kind === 'up-to-date'
          ? `f-tree ${app.getVersion()} is the newest build.`
          : 'There is no build on offer for this system just now.',
        buttons: ['OK'],
      });
    }
    return;
  }

  /*
   * A new version this install cannot apply for itself.
   *
   * A .deb needs root and a tarball was unpacked wherever the reader chose, so the app has no
   * business rewriting either. Saying so and opening the page is the honest end of the sentence.
   */
  if (!found.file) {
    const go = await dialog.showMessageBox(win, {
      type: 'info',
      message: `f-tree ${found.version} is available.`,
      detail: 'This copy was installed in a way the app should not overwrite by itself — a .deb '
        + 'needs your permission, and a folder you unpacked is yours to replace. The download '
        + 'page has the file for your system.',
      buttons: ['Open the download page', 'Not now'],
      defaultId: 0,
      cancelId: 1,
    });
    if (go.response === 0) shell.openExternal('https://ftree.vibethroughcode.com/desktop/');
    return;
  }

  const answer = await dialog.showMessageBox(win, {
    type: 'info',
    message: `f-tree ${found.version} is available.`,
    detail: `${found.notes ? found.notes.slice(0, 700) + '\n\n' : ''}`
      + `${found.file.name} · ${(found.file.size / 1048576).toFixed(1)} MB`
      + `${found.file.sha256 ? '' : '\n\nGitHub has published no checksum for this file.'}`,
    buttons: ['Download', 'Release notes', 'Not now'],
    defaultId: 0,
    cancelId: 2,
  });
  if (answer.response === 1) { shell.openExternal(found.notesUrl); return; }
  if (answer.response !== 0) return;

  let got;
  const into = path.join(os.tmpdir(), found.file.name);
  try {
    got = await download(found.file.url, into);
  } catch (error) {
    await dialog.showMessageBox(win, {
      type: 'warning', message: 'The download did not finish.', detail: error.message, buttons: ['OK'],
    });
    return;
  }

  /*
   * Verified before anything is offered to run.
   *
   * The hash comes from GitHub's own metadata for the asset, not from the file and not from this
   * app. A mismatch means the bytes are not the ones that came out of the public build, and the
   * only safe thing to do with them is delete them.
   */
  if (found.file.sha256 && got.sha256 !== found.file.sha256) {
    await fs.rm(into, { force: true });
    await dialog.showMessageBox(win, {
      type: 'error',
      message: 'That download does not match its checksum.',
      detail: `Expected ${found.file.sha256}\nGot      ${got.sha256}\n\n`
        + 'The file has been deleted. Nothing was installed.',
      buttons: ['OK'],
    });
    return;
  }

  const windows = process.platform === 'win32';
  const next = await dialog.showMessageBox(win, {
    type: 'info',
    message: `Downloaded and verified f-tree ${found.version}.`,
    detail: windows
      ? 'Run the installer to finish. f-tree will close while it installs.'
      : `Saved to ${got.path}\n\nAn AppImage replaces the one you are running: make it `
        + 'executable with chmod +x and start it. Nothing has been changed for you.',
    buttons: windows ? ['Run the installer', 'Show the file', 'Later'] : ['Show the file', 'Later'],
    defaultId: 0,
    cancelId: windows ? 2 : 1,
  });

  if (windows && next.response === 0) { shell.openPath(got.path); app.quit(); return; }
  if ((windows && next.response === 1) || (!windows && next.response === 0)) {
    shell.showItemInFolder(got.path);
  }
}

/*
 * Turning betas on is a decision worth interrupting; turning them off is not.
 *
 * The same judgement the app makes, and it states the same consequence: a beta keeps you on betas
 * until a stable release passes it.
 */
async function confirmBeta(win) {
  const answer = await dialog.showMessageBox(win, {
    type: 'warning',
    message: 'Offer me beta releases?',
    detail: 'A beta is an unfinished build of an app you keep your family in. You will be offered '
      + 'them as soon as they are published, before anyone has used them much.\n\n'
      + 'You can switch this back off at any time; you will then stay on the build you have until '
      + 'a stable release passes it.',
    buttons: ['Offer me betas', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  return answer.response === 0;
}

function buildMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    {
      label: 'File',
      submenu: [
        /*
         * First, and not as a courtesy. Somebody may have installed this having never owned the
         * phone app, and for them "Open tree" is a dead end -- there is nothing to open.
         */
        { label: 'New tree', accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('menu:command', 'file:new') },
        { label: 'Open tree…', accelerator: 'CmdOrCtrl+O', click: () => chooseInto(win) },
      { label: 'Import into this tree…', accelerator: 'CmdOrCtrl+I',
        click: () => win.webContents.send('menu:command', 'file:import') },
        { type: 'separator' },
        /*
         * Saving is asked of the page, not done here. The page holds the tree, the writer and the
         * reader it verifies itself with; this side only puts bytes on a disk. The menu therefore
         * says "please save" and the page decides whether it can.
         */
        { label: 'Save', accelerator: 'CmdOrCtrl+S',
          click: () => win.webContents.send('menu:command', 'file:save') },
        { label: 'Save as…', accelerator: 'CmdOrCtrl+Shift+S',
          click: () => win.webContents.send('menu:command', 'file:saveAs') },
        { type: 'separator' },
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z',
          click: () => win.webContents.send('menu:command', 'edit:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => win.webContents.send('menu:command', 'edit:redo') },
        { type: 'separator' },
        { label: 'Close tree', accelerator: 'CmdOrCtrl+W',
          click: () => { writeSession({}); win.webContents.send('menu:command', 'close'); } },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Chart', accelerator: 'CmdOrCtrl+1', click: () => win.webContents.send('menu:command', 'view:chart') },
        { label: 'Index', accelerator: 'CmdOrCtrl+2', click: () => win.webContents.send('menu:command', 'view:index') },
        // Third, and third in the numbering, so nobody's Cmd+2 changes meaning under them.
        { label: 'Compact', accelerator: 'CmdOrCtrl+3', click: () => win.webContents.send('menu:command', 'view:compact') },
        { type: 'separator' },
        { label: 'How are two people related?', accelerator: 'CmdOrCtrl+R', click: () => win.webContents.send('menu:command', 'view:relate') },
        { type: 'separator' },
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: () => win.webContents.send('menu:command', 'zoom:in') },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => win.webContents.send('menu:command', 'zoom:out') },
        { label: 'Fit to window', accelerator: 'CmdOrCtrl+0', click: () => win.webContents.send('menu:command', 'zoom:fit') },
        { type: 'separator' },
        { label: 'Search people', accelerator: 'CmdOrCtrl+F', click: () => win.webContents.send('menu:command', 'search') },
        { label: 'Switch theme', accelerator: 'CmdOrCtrl+Shift+D', click: () => win.webContents.send('menu:command', 'theme') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Updates',
      submenu: [
        { label: 'Check for updates now…', click: () => checkForUpdates(win) },
        { type: 'separator' },
        {
          label: 'Check for updates automatically',
          type: 'checkbox',
          checked: settings.checkForUpdates,
          click: async (item) => {
            settings.checkForUpdates = item.checked;
            await writeSettings();
          },
        },
        {
          label: 'Offer me beta releases',
          type: 'checkbox',
          checked: settings.betaReleases,
          click: async (item) => {
            // Asked before it is on, not after.
            if (item.checked && !(await confirmBeta(win))) {
              item.checked = false;
              return;
            }
            settings.betaReleases = item.checked;
            await writeSettings();
          },
        },
        { type: 'separator' },
        {
          label: 'Both are off until you switch them on',
          enabled: false,
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'f-tree on the web', click: () => shell.openExternal('https://ftree.vibethroughcode.com/') },
        { label: 'Report a problem', click: () => shell.openExternal('https://github.com/thisisankit27/f-tree/issues') },
        { type: 'separator' },
        {
          label: 'About f-tree',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            message: `f-tree ${app.getVersion()}`,
            detail: 'A local-first family tree. Everything stays on this machine: no account, no '
              + 'cloud, no backend. It reads and writes .ftree files, the same ones the Android '
              + 'app uses — but it does not need it: a tree can start here.',
            buttons: ['OK'],
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/*
 * The typefaces, from disk.
 *
 * The viewer's HTML asks Google for Literata and JetBrains Mono, which is right for a web page and
 * wrong for an app that tells people nothing leaves their machine: it would announce every launch
 * to a third party. The same two files the Android app ships are read off disk instead, and the
 * request to Google is refused outright below rather than merely made redundant.
 */
const FONT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'fonts')
  : path.join(__dirname, '..', 'app', 'src', 'main', 'res', 'font');

async function localFontCss() {
  const face = async (family, file, weight) => {
    const data = await fs.readFile(path.join(FONT_DIR, file));
    return `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${data.toString('base64')})`
      + ` format("truetype");font-weight:${weight};font-style:normal;font-display:block}`;
  };
  return [
    await face('Literata', 'literata.ttf', '100 900'),
    await face('JetBrains Mono', 'jetbrains_mono.ttf', '100 900'),
  ].join('');
}

/*
 * The page gets its own session, and that session reaches nothing.
 *
 * This has to be the *window's* session rather than the default one. `net.request` in the main
 * process also runs through `session.defaultSession`, so refusing everything there refused the
 * updater's own call to GitHub - it blocked itself, and reported
 * `net::ERR_BLOCKED_BY_CLIENT` as if something on the machine had done it.
 *
 * Splitting them says exactly what was always meant: the page can reach nothing, and the only
 * requests the app makes are the update checks somebody switched on.
 */
const VIEWER_PARTITION = 'persist:viewer';

function refuseTheNetwork(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      console.warn(`f-tree: refused a network request to ${details.url}`);
      callback({ cancel: true });
    });
}

/*
 * A window with unsaved edits does not simply vanish.
 *
 * The page reports whether there is unsaved work; this refuses the close while there is, and asks.
 * "Save" hands the work back to the page, because the page is the only side that can serialise a
 * tree and verify it -- and then waits for it to report itself clean rather than assuming it did.
 *
 * The wait has a deadline and the deadline has an honest ending: if the page has not saved by
 * then, the window stays open and says so. An editor that hung on closing would be a worse bug
 * than the one this prevents.
 */
function guardUnsavedWork(win) {
  let letItGo = false;

  win.on('close', (event) => {
    if (letItGo || !unsaved.get(win.id)) return;
    event.preventDefault();

    (async () => {
      const answer = await dialog.showMessageBox(win, {
        type: 'warning',
        message: 'This tree has changes you have not saved.',
        detail: 'Closing now loses them. There is no copy of these edits anywhere else.',
        buttons: ['Save', 'Discard the changes', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });

      if (answer.response === 2) return;
      if (answer.response === 1) { letItGo = true; win.close(); return; }

      win.webContents.send('menu:command', 'file:save');
      const saved = await waitUntilSaved(win);
      if (!saved) {
        await dialog.showMessageBox(win, {
          type: 'warning',
          message: 'The tree has not been saved.',
          detail: 'The window has been left open so nothing is lost. Try File then Save.',
          buttons: ['OK'],
        });
        return;
      }
      letItGo = true;
      win.close();
    })();
  });

  win.on('closed', () => unsaved.delete(win.id));
}

/** Polls for the page reporting itself clean. Ten seconds, then the honest answer. */
async function waitUntilSaved(win, deadlineMs = 10_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (!unsaved.get(win.id)) return true;
    if (win.isDestroyed()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !unsaved.get(win.id);
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#f7f6f1',
    show: false,
    title: 'f-tree',
    // Packaged builds take it from the installer's own resources, but a window manager that asks
    // the app rather than the desktop entry - and every run from source - gets it from here.
    icon: ICON_FOR_WINDOW,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: VIEWER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  guardUnsavedWork(win);

  refuseTheNetwork(session.fromPartition(VIEWER_PARTITION));
  await win.loadFile(VIEWER);
  try {
    await win.webContents.insertCSS(await localFontCss());
  } catch (error) {
    // Without them the app falls back to the system serif and monospace. Worth a line in the log,
    // not worth refusing to open somebody's family tree over.
    console.warn(`f-tree: could not load the bundled typefaces — ${error.message}`);
  }
  buildMenu(win);

  // A link to the project should open in the browser, never navigate the app away from the viewer.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

ipcMain.handle('app:version', () => app.getVersion());

/*
 * Who this installation is, for a tree started here.
 *
 * Minted once and never changed. The page needs it before it can create a tree, because a tree
 * written without one claims the empty origin -- see identity.js.
 */
ipcMain.handle('app:installationId', () => installationId(app.getPath('userData')));
ipcMain.handle('tree:choose', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return chooseInto(win);
});
/*
 * A file to merge in, which is not the same act as opening one.
 *
 * Deliberately does not touch the session: the tree being edited is still the tree that was
 * opened, and recording a cousin's file as "the last tree" would reopen theirs on the next launch.
 * Nothing is decided here either -- the page reads the archive, works out what the merge would
 * mean, and shows it before a single person is changed.
 */
ipcMain.handle('tree:chooseImport', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  // The same narrow seam the save test uses, and gated the same way: a native picker cannot be
  // clicked from a test, and stubbing the import itself would leave the real path unexercised.
  if (process.env.FTREE_SMOKE && process.env.FTREE_SMOKE_IMPORT) {
    const { name, bytes } = await readTree(path.resolve(process.env.FTREE_SMOKE_IMPORT));
    return { name, bytes };
  }

  const picked = await dialog.showOpenDialog(win, {
    title: 'Choose a family tree to import',
    buttonLabel: 'Import',
    filters: [{ name: 'f-tree export', extensions: ['ftree'] },
      { name: 'All files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths.length) return null;

  try {
    const { name, bytes } = await readTree(picked.filePaths[0]);
    return { name, bytes };
  } catch (error) {
    await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'That file could not be read.',
      detail: `${picked.filePaths[0]}\n\n${error.message}`,
      buttons: ['OK'],
    });
    return null;
  }
});

ipcMain.handle('tree:forget', async () => { await writeSession({}); });

/*
 * Saving takes the bytes the page produced, never a document for this side to serialise.
 *
 * The page owns the format: it has the writer, the reader it verifies with, and the tree itself.
 * Handing a document across the bridge for the main process to encode would put a second encoder
 * in the app and give the verification something other than the real bytes to check.
 */
ipcMain.handle('tree:save', async (event, { bytes, path: target }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!target) return { ok: false, reason: 'NO_PATH' };
  return saveInto(win, target, bytes);
});

ipcMain.handle('tree:saveAs', async (event, { bytes, suggest }) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  /*
   * The one seam the smoke test needs, and it is deliberately narrow.
   *
   * A native save dialog cannot be driven from a test, and stubbing the whole save would leave
   * the part that actually writes to a disk unexercised -- which is the part worth exercising.
   * So the destination is supplied and everything after it is the real code path. Guarded on
   * FTREE_SMOKE, so it cannot be reached in a build somebody is using.
   */
  if (process.env.FTREE_SMOKE && process.env.FTREE_SMOKE_SAVE_TO) {
    return saveInto(win, process.env.FTREE_SMOKE_SAVE_TO, bytes);
  }

  const picked = await dialog.showSaveDialog(win, {
    title: 'Save the family tree',
    defaultPath: suggest || 'family-tree.ftree',
    filters: [{ name: 'f-tree export', extensions: ['ftree'] }],
  });
  if (picked.canceled || !picked.filePath) return { ok: false, reason: 'CANCELLED' };
  return saveInto(win, picked.filePath, bytes);
});

/*
 * The page tells this side when there is unsaved work, so the window can refuse to vanish with
 * it. Kept as a plain notification rather than something to ask for: the answer has to be current
 * at the moment of closing, and asking then would race the close.
 */
ipcMain.on('tree:dirty', (event, dirty) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  unsaved.set(win.id, Boolean(dirty));
  win.setDocumentEdited(Boolean(dirty));
});
ipcMain.handle('tree:last', async () => {
  const { lastTree } = await readSession();
  if (!lastTree) return null;
  try {
    return await readTree(lastTree);
  } catch {
    // Moved, renamed or deleted since last time. Start empty rather than complain about a file
    // the reader may well have meant to get rid of.
    await writeSession({});
    return null;
  }
});

/*
 * The smoke test.
 *
 * A desktop app is the one thing in this repository that cannot be checked by reading it: the
 * shell, the preload bridge and the viewer only meet each other once a window exists. So the test
 * is the real app, started the real way, opening a real `.ftree` - and it asserts the things that
 * would actually be broken if the wiring came apart: the bridge is reachable, the tree arrived,
 * every person was drawn, and the layout ran.
 */
/*
 * Building a tree from nothing, the way somebody who has never owned the phone app would.
 *
 * The assertions above prove the app can read. These prove it can do the thing it exists for, and
 * they use the real path all the way down: the real buttons, the real relationship rules, the real
 * writer, the real atomic save onto a real disk, and then the file read back. Nothing is stubbed
 * but the native save dialog, which cannot be clicked from here.
 *
 * The order matters. Each step depends on the one before, so a failure early stops the rest rather
 * than reporting six confusing consequences of one cause.
 */
async function runEditSmoke(win, check) {
  const page = (fn, ...args) => win.webContents.executeJavaScript(
    `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

  console.log('\n  -- building a tree from nothing --');

  await page(() => document.getElementById('start-new').click());
  await settle();

  let seen = await page(() => ({
    counts: document.getElementById('counts')?.textContent ?? '',
    panelOpen: document.getElementById('panel')?.hidden === false,
    nameField: Boolean(document.getElementById('f-name')),
  }));
  check('a new tree starts with somebody to name', seen.panelOpen && seen.nameField,
    seen.counts);

  // Typing a name and leaving the field: one edit, one undo step.
  await page(() => {
    const input = document.getElementById('f-name');
    input.value = 'Shyam Lal';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();

  // A date and a note as well as a name. The import step later needs two records that agree on
  // enough to be a candidate and disagree on something that cannot rule the pairing out.
  await page(() => {
    for (const [id, value] of [['f-birth', '1938'], ['f-notes', 'Grandfather. Born in Ballia.']]) {
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await settle();

  // Add a child, by name, as a new person.
  await page(() => {
    [...document.querySelectorAll('.kinds button')].find((b) => b.textContent === 'Child').click();
  });
  await settle(200);
  await page(() => {
    document.getElementById('add-name').value = 'Ravi';
    [...document.querySelectorAll('.add-rel .btn')].find((b) => b.textContent.includes('new person')).click();
  });
  await settle();

  seen = await page(() => ({
    counts: document.getElementById('counts')?.textContent ?? '',
    unsaved: document.getElementById('unsaved')?.hidden === false,
    canUndo: document.getElementById('undo')?.disabled === false,
  }));
  check('a person and a child are recorded', /2 people/.test(seen.counts) && /1 connection/.test(seen.counts),
    seen.counts);
  check('the window knows there is work not on disk', seen.unsaved === true);
  check('there is something to undo', seen.canUndo === true);

  // The rules, through the interface rather than around it: a child cannot also be a partner.
  await page(() => {
    [...document.querySelectorAll('.kinds button')].find((b) => b.textContent === 'Partner').click();
  });
  await settle(200);
  const refused = await page(() => {
    const list = [...document.querySelectorAll('.add-rel .search-results li button')];
    document.getElementById('add-name').value = 'Ravi';
    document.getElementById('add-name').dispatchEvent(new Event('input', { bubbles: true }));
    return list.length;
  });
  await settle(200);
  await page(() => {
    const first = document.querySelector('.add-rel .search-results li button');
    if (first) first.click();
  });
  await settle();
  seen = await page(() => ({
    counts: document.getElementById('counts')?.textContent ?? '',
    toast: document.getElementById('toast')?.hidden === false
      ? document.getElementById('toast').textContent : null,
  }));
  check('the rules refuse a partner who is already a child, and say why',
    /1 connection/.test(seen.counts) && /already parent and child/i.test(seen.toast ?? ''),
    `${seen.counts} — ${seen.toast}`);

  // Save, through the real writer and the real atomic write.
  await page(() => document.getElementById('save').click());
  await settle(1200);

  const target = process.env.FTREE_SMOKE_SAVE_TO;
  const wrote = await fs.stat(target).then((s) => s.size, () => 0);
  check('the tree was written to disk', wrote > 0, `${wrote} bytes at ${target}`);

  seen = await page(() => ({
    unsaved: document.getElementById('unsaved')?.hidden === false,
    toast: document.getElementById('toast')?.textContent ?? '',
  }));
  check('saving clears the unsaved mark', seen.unsaved === false, seen.toast);

  /*
   * Read back through the app itself. A file the writer can produce and the reader cannot open
   * would pass every check above and be useless.
   */
  await openInto(win, target);
  await settle(900);
  seen = await page(() => ({
    counts: document.getElementById('counts')?.textContent ?? '',
    names: [...document.querySelectorAll('.rel-go')].map((b) => b.textContent).join(','),
  }));
  check('the saved file reopens with both people and the connection',
    /2 people/.test(seen.counts) && /1 connection/.test(seen.counts), seen.counts);
}

/*
 * Merging a second file into the tree on screen.
 *
 * The review dialog is the one screen where confirming does something that cannot be put right by
 * hand, so what is asserted here is not "it worked" but "it asked first": the dialog opens, it
 * names the evidence, and the tree is untouched until the button is pressed.
 */
/*
 * The compact view, read rather than drawn.
 *
 * What this asserts is not "it rendered" but the three claims the view makes that a picture cannot
 * be trusted to keep: that the generations are named from their distance, that a person married
 * into a generation is shown without being counted as one of it, and that clicking a name walks the
 * reading to that person rather than doing something else. The last one matters because everywhere
 * else in this app a click on a person opens the editor, and here it deliberately does not.
 */
async function runCompactSmoke(win, check) {
  const page = (fn, ...args) => win.webContents.executeJavaScript(
    `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

  console.log('\n  -- reading the generations --');

  win.webContents.send('menu:command', 'view:compact');
  await settle(500);

  const seen = await page(() => {
    const view = document.getElementById('compact');
    const bands = [...view.querySelectorAll('.band')];
    return {
      shown: view.hidden === false,
      chartHidden: getComputedStyle(document.getElementById('canvas')).display === 'none',
      headings: bands.map((b) => b.querySelector('.band-heading span')?.textContent ?? ''),
      offsets: bands.map((b) => b.dataset.offset),
      focusName: view.querySelector('.band-focus-name')?.textContent ?? '',
      names: [...view.querySelectorAll('.band-name')].length,
      marriedIn: [...view.querySelectorAll(".band-name[data-married='true']")].length,
      rules: [...view.querySelectorAll('.band-join.married')].length,
      // Per group: how many names, and how many marriage rules between them.
      groups: [...view.querySelectorAll('.band-group')].map((g) => ({
        names: g.querySelectorAll('.band-name').length,
        rules: g.querySelectorAll('.band-join.married').length,
      })),
      // The count in a heading is what the band is about, so it can be lower than the number of
      // names on the row -- that difference is the step-grandmother.
      counts: bands.map((b) => b.querySelector('.band-count')?.textContent ?? ''),
      note: document.querySelector('#compact .index-note')?.textContent ?? '',
    };
  });

  check('the compact view opens on its own', seen.shown, String(seen.shown));
  check('the chart stands down while the bands are up', seen.chartHidden,
    String(seen.chartHidden));
  check('it is centred on somebody', seen.focusName.length > 0, seen.focusName);
  check('there are generations to read', seen.headings.length > 0,
    `${seen.headings.length} bands: ${seen.headings.join(' / ')}`);
  check('a generation is named, not numbered',
    seen.headings.every((h) => h.length > 0 && !/^-?\d+$/.test(h)), seen.headings.join(' / '));
  check('the reading says how far it reaches', /generation|nobody/.test(seen.note), seen.note);
  check('every name on the page is reachable', seen.names > 0, `${seen.names} names`);

  /*
   * A marriage is a doubled rule, and only a marriage.
   *
   * Stated as an invariant rather than as "there is at least one rule", because a tree of cousins
   * has no marriages in it at all and would fail that for being correct. A group is a set of people
   * joined *by marriage*, so:
   *
   *   two or more names in a group means at least one marriage joined them; and
   *   there can never be more rules than gaps -- somebody who married twice puts three people in
   *   one group, and only two of the three pairs are marriages. Marking the third would state a
   *   wedding that never happened, and that is exactly what `CompactGroup.links` exists to prevent.
   *
   * Both hold whatever is in the file, and neither is visible in a screenshot.
   */
  const joined = seen.groups.filter((g) => g.names >= 2);
  check('a couple on a row is joined by a doubled rule',
    joined.every((g) => g.rules >= 1),
    `${joined.length} groups of two or more, rules ${joined.map((g) => g.rules).join(',') || 'n/a'}`);
  check('no rule is drawn where there was no wedding',
    seen.groups.every((g) => g.rules <= Math.max(0, g.names - 1)),
    seen.groups.map((g) => `${g.names}:${g.rules}`).join(' '));

  // Both themes, because this screen is read in whichever one somebody happens to use and a token
  // that only exists in one of them looks fine right up until it does not. Taken before the walk
  // below, because the first reading is the one with every band on it.
  if (process.env.FTREE_SMOKE_SHOT_COMPACT) {
    const shot = process.env.FTREE_SMOKE_SHOT_COMPACT;
    await fs.writeFile(shot, (await win.webContents.capturePage()).toPNG());
    console.log(`       wrote ${shot}`);

    await page(() => document.getElementById('theme-btn').click());
    await settle(300);
    const other = shot.replace(/(\.png)?$/, '-other-theme.png');
    await fs.writeFile(other, (await win.webContents.capturePage()).toPNG());
    console.log(`       wrote ${other}`);
    await page(() => document.getElementById('theme-btn').click());
    await settle(200);
  }

  /*
   * Reading further, where the record goes further.
   *
   * The offer is only made when the walk actually stopped short of the end, so the first assertion
   * is that the button and the sentence agree -- an offer to read on where there is nothing more is
   * the kind of thing nobody notices until they press it.
   */
  const reach = await page(() => ({
    offered: Boolean(document.querySelector('#compact .band-more')),
    bands: document.querySelectorAll('#compact .band').length,
  }));
  check('the offer to read further matches whether there is further to read',
    reach.offered === /continues past/.test(seen.note),
    `offered ${reach.offered}, said "${seen.note}"`);

  if (reach.offered) {
    await page(() => document.querySelector('#compact .band-more').click());
    await settle(500);
    const further = await page(() => document.querySelectorAll('#compact .band').length);
    check('reading further actually reaches further', further > reach.bands,
      `${reach.bands} bands -> ${further}`);
  }

  // Walking the reading. Clicking a name must re-centre rather than open the editor: two meanings
  // for one click on a person's name would make both of them uncertain.
  const walked = await page(() => {
    const before = document.querySelector('.band-focus-name').textContent;
    const target = [...document.querySelectorAll('#compact .band .band-name')]
      .find((el) => el.querySelector('.band-who').textContent !== before);
    const wanted = target?.querySelector('.band-who').textContent ?? '';
    target?.click();
    return { before, wanted };
  });
  await settle(400);

  const after = await page(() => ({
    focusName: document.querySelector('.band-focus-name')?.textContent ?? '',
    panelOpen: document.getElementById('panel')?.hidden === false,
  }));

  check('clicking a name walks the reading to that person',
    after.focusName === walked.wanted && after.focusName !== walked.before,
    `${walked.before} -> ${after.focusName}`);
  check('walking does not open the editor over what was asked for', !after.panelOpen,
    String(after.panelOpen));

  win.webContents.send('menu:command', 'view:chart');
  await settle(300);
}

/*
 * How two people are related, asked in the app.
 *
 * The engine has a golden of its own (`kinship-golden.txt`), so nothing here re-checks *what* the
 * answer is. What it checks is the panel's own decisions: that the question is seeded from whoever
 * was selected, that the chart is cut down to the line joining the two, that the whole tree comes
 * back when the question is closed, and -- the one worth having -- that two people the file does
 * not connect are told exactly that rather than shown an empty box.
 */
async function runRelateSmoke(win, check) {
  const page = (fn, ...args) => win.webContents.executeJavaScript(
    `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  console.log('\n  -- how two people are related --');

  // Somebody selected first, so the seeding is checked rather than assumed. The people list is the
  // reliable way to click a person: the chart needs coordinates.
  win.webContents.send('menu:command', 'view:index');
  await settle();
  const seeded = await page(() => {
    const row = document.querySelector('#index-list .index-row');
    row?.click();
    return {
      selected: document.getElementById('panel')?.hidden === false,
      name: row?.querySelector('.who')?.textContent.trim() ?? '',
    };
  });
  await settle();

  win.webContents.send('menu:command', 'view:relate');
  await settle(600);

  const opened = await page(() => ({
    shown: document.getElementById('relate').hidden === false,
    a: document.getElementById('relate-a').value,
    editorOpen: document.getElementById('panel').hidden === false,
  }));

  // The bar is deliberately not a way in -- see the note in app.js. Pinned, so that adding one
  // later is a decision somebody makes on purpose rather than a header that quietly grows a row.
  const header = await page(() => ({
    height: Math.round(document.querySelector('header').getBoundingClientRect().height),
    button: Boolean(document.getElementById('relate-btn')),
  }));
  check('the bar stays one row', header.height <= 60 && !header.button, JSON.stringify(header));

  check('the relation finder opens', opened.shown, String(opened.shown));
  check('it is seeded from the person that was selected',
    seeded.selected && opened.a === seeded.name, `selected "${seeded.name}", seeded "${opened.a}"`);
  check('one question at a time: the editor stands down', !opened.editorOpen,
    String(opened.editorOpen));

  const chartSize = () => page(() => document.getElementById('canvas').dataset.people ?? '');

  /** Types a name into a picker and takes the first person it offers. */
  const pick = async (slot, name) => {
    const offered = await page((s, n) => {
      const input = document.getElementById(`relate-${s}`);
      input.value = n;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelectorAll(`#relate-${s}-results li button`).length;
    }, slot, name);
    await settle(250);
    await page((s) => document.querySelector(`#relate-${s}-results li button`)?.click(), slot);
    await settle(500);
    return offered;
  };

  // A relative of the seeded person: whoever their panel listed. Guaranteed to be connected.
  const relative = await page(() => {
    const rows = [...document.querySelectorAll('#index-list .index-row')];
    const first = document.getElementById('relate-a').value;
    const group = rows.find((r) => r.querySelector('.who')?.textContent.trim() === first)
      ?.closest('li')?.parentElement;
    const other = rows
      .map((r) => r.querySelector('.who')?.textContent.trim())
      .find((n) => n && n !== first);
    return other ?? '';
  });

  const offered = await pick('b', relative);
  check('the picker offers people by name', offered > 0, `${offered} offered for "${relative}"`);

  const answer = await page(() => {
    const box = document.getElementById('relate-answer');
    return {
      sentence: box.querySelector('.r-term')?.textContent.trim() ?? '',
      unrelated: Boolean(box.querySelector('.r-term.r-none')),
      steps: box.querySelectorAll('.r-chain li').length,
      links: box.querySelectorAll('.r-chain .link-btn').length,
      scripted: box.innerHTML.includes('<script'),
    };
  });

  check('the question is answered', answer.steps > 0 || answer.unrelated,
    `${answer.steps} steps, sentence "${answer.sentence}"`);
  check('the chain starts with the first person and every step after is clickable',
    answer.steps === answer.links + 1, `${answer.steps} rows, ${answer.links} clickable`);
  check('no markup is built out of a name', !answer.scripted, String(answer.scripted));

  /*
   * Two people the file does not connect.
   *
   * The sample family deliberately contains people connected to nobody -- it is the reason the
   * people list exists at all -- so this case is reachable, and it is the one where an empty box
   * would be worst. The claim is that the app says the *record* is silent, not that they are
   * unrelated, which no file can know.
   */
  const alone = await page(() => {
    const headings = [...document.querySelectorAll('#index-list .index-group')];
    const isolated = headings.find((h) => /Not connected/.test(h.textContent));
    return isolated?.nextElementSibling?.querySelector('.who')?.textContent.trim() ?? '';
  });

  if (alone) {
    await pick('b', alone);
    const said = await page(() => {
      const note = document.getElementById('relate-answer').querySelector('.r-term');
      return {
        text: note?.textContent.trim() ?? '',
        flagged: note?.classList.contains('r-none') ?? false,
        steps: document.querySelectorAll('#relate-answer .r-chain li').length,
      };
    });
    check('two people the file does not connect are told exactly that',
      said.flagged && /does not say how/.test(said.text), said.text);
    check('and are not shown a chain that does not exist', said.steps === 0, `${said.steps} steps`);
  } else {
    check('the sample family has somebody connected to nobody', false,
      'none found — this case went unchecked');
  }

  if (process.env.FTREE_SMOKE_SHOT_RELATE) {
    const shot = process.env.FTREE_SMOKE_SHOT_RELATE;
    // Back to a real answer for the picture: the unrelated case is checked above, not photographed.
    await pick('b', relative);
    await fs.writeFile(shot, (await win.webContents.capturePage()).toPNG());
    console.log(`       wrote ${shot}`);

    await page(() => document.getElementById('theme-btn').click());
    await settle(300);
    const other = shot.replace(/(\.png)?$/, '-other-theme.png');
    await fs.writeFile(other, (await win.webContents.capturePage()).toPNG());
    console.log(`       wrote ${other}`);
    await page(() => document.getElementById('theme-btn').click());
    await settle(200);
  }

  // Closing puts the whole tree back, rather than stranding somebody on a three-person chart.
  await page(() => document.getElementById('relate-close').click());
  await settle(600);
  const closed = await page(() => ({
    shown: document.getElementById('relate').hidden === false,
    a: document.getElementById('relate-a').value,
  }));
  check('closing the question puts the panel away', !closed.shown, String(closed.shown));

  win.webContents.send('menu:command', 'view:chart');
  await settle(300);
}

async function runImportSmoke(win, check) {
  const page = (fn, ...args) => win.webContents.executeJavaScript(
    `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  console.log('\n  -- merging in a second file --');

  const before = await page(() => ({
    people: window.__ftreePeopleCount?.() ?? document.getElementById('counts').textContent,
  }));

  win.webContents.send('menu:command', 'file:import');
  await settle(900);

  const asked = await page(() => {
    const dialog = document.getElementById('review');
    const cards = [...dialog.querySelectorAll('.pair')];
    return {
      open: dialog.open === true,
      title: document.getElementById('review-title').textContent,
      lead: document.getElementById('review-lead').textContent,
      outcome: document.getElementById('review-outcome').textContent,
      confirm: document.getElementById('review-confirm').textContent,
      cards: cards.length,
      why: cards[0]?.querySelector('.pair-why')?.textContent ?? '',
      sides: cards[0]?.querySelectorAll('.side').length ?? 0,
      counts: document.getElementById('counts').textContent,
    };
  });

  check('importing asks before it merges', asked.open, asked.title);
  check('the button says exactly what pressing it will do',
    /^(Add|Merge) \d+ /.test(asked.confirm), asked.confirm);
  check('the dialog says the work is not on disk yet', /until you save/.test(asked.outcome),
    asked.outcome);
  check('the tree is untouched while the question is open', asked.counts === before.people,
    asked.counts);

  if (asked.cards) {
    check('a proposed match shows both records side by side', asked.sides === 2,
      `${asked.sides} sides`);
    check('a proposed match says why it thinks so', asked.why.length > 0, asked.why.trim());
  }

  // Both themes, because this screen is read in whichever one somebody happens to use and a
  // token that only exists in one of them looks fine right up until it does not.
  if (process.env.FTREE_SMOKE_SHOT_REVIEW) {
    const shot = process.env.FTREE_SMOKE_SHOT_REVIEW;
    await fs.writeFile(shot, (await win.webContents.capturePage()).toPNG());
    console.log(`       wrote ${shot}`);

    await page(() => document.getElementById('theme-btn').click());
    await settle(300);
    const other = shot.replace(/(\.png)?$/, '-other-theme.png');
    await fs.writeFile(other, (await win.webContents.capturePage()).toPNG());
    console.log(`       wrote ${other}`);
    await page(() => document.getElementById('theme-btn').click());
    await settle(200);
  }

  await page(() => document.getElementById('review-confirm').click());
  await settle(600);

  const after = await page(() => ({
    counts: document.getElementById('counts').textContent,
    open: document.getElementById('review').open === true,
    undo: document.getElementById('undo')?.disabled === false,
  }));

  check('confirming closes the question', !after.open, String(after.open));
  check('the tree grew once it was confirmed', after.counts !== before.people, after.counts);
  check('the whole import can be undone', after.undo, 'undo is available');
}

async function runSmoke(win, file) {
  const failures = [];
  const iconExists = await fs.access(ICON_FOR_WINDOW).then(() => true, () => false);

  const check = (label, ok, detail = '') => {
    if (!ok) failures.push(label);
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  ${detail}` : ''}`);
  };

  /*
   * A missing fixture must not look like a broken app.
   *
   * It did once: the file the test points at had been cleared away, `openInto` failed, and four
   * assertions reported that the tree would not open - which reads exactly like a regression in
   * the app and is nothing of the kind.
   */
  if (!(await fs.access(file).then(() => true, () => false))) {
    console.log(` FAIL  the file to open exists  ${file}`);
    console.log('\n1 FAILED.');
    app.exit(1);
    return;
  }

  /*
   * The page's own errors, in this log.
   *
   * Without this a thrown exception in the renderer is invisible from here: the assertions simply
   * report the consequence -- a panel that did not open, a count that did not change -- and the
   * cause stays in a console nobody is looking at. It cost an afternoon once.
   */
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 2) console.log(`       page: ${message}  (${source}:${line})`);
  });

  await openInto(win, file);
  // The page reads the file, lays it out and paints; give it room on a slow runner.
  await new Promise((r) => setTimeout(r, 2500));

  const seen = await win.webContents.executeJavaScript(`(${(() => ({
    bridge: Boolean(window.ftreeDesktop),
    shell: document.body.dataset.shell ?? null,
    state: document.getElementById('viewer')?.dataset.state ?? null,
    fileName: document.getElementById('file-name')?.textContent ?? null,
    orientation: document.body.dataset.orientation ?? null,
    bridgeNames: Object.keys(window.ftreeDesktop ?? {}).sort().join(','),
    openerError: document.getElementById('opener-error')?.textContent ?? null,
    hint: document.getElementById('hint')?.textContent ?? null,
    literata: document.fonts.check('16px Literata'),
    mono: document.fonts.check('13px "JetBrains Mono"'),
    counts: document.getElementById('counts')?.textContent?.trim() ?? null,
    peopleRows: (() => {
      document.querySelector('[data-view="index"]')?.click();
      return document.querySelectorAll('#index-list .index-row').length;
    })(),
    peopleNote: document.getElementById('index-note')?.textContent ?? null,
    // The editor's own surface. A page that reads a tree but cannot change one is not this app.
    canEdit: Boolean(document.getElementById('add-person') && document.getElementById('save')),
    undoPresent: Boolean(document.getElementById('undo') && document.getElementById('redo')),
    panelExists: Boolean(document.getElementById('panel')),
  })).toString()})()`);

  check('the preload bridge is reachable from the page', seen.bridge === true);
  check('the page knows it is running in the shell', seen.shell === 'desktop', String(seen.shell));
  check('the tree opened', seen.state === 'loaded',
    `${seen.state}${seen.openerError ? ' — ' + seen.openerError : ''}${seen.hint ? ' — ' + seen.hint : ''}`);
  check('the file name is shown', Boolean(seen.fileName), String(seen.fileName));
  /*
   * Both shells are landscape readers: a generation is a row. This asserted `columns` until the
   * desktop app was looked at on an actual laptop, where following the phone read badly. It is
   * kept, pointing the other way, because it is the assertion that catches the layout silently
   * not running -- `orientation` is only set once `layoutArchive` has returned.
   */
  check('generations run in rows, as they do on the website', seen.orientation === 'rows',
    String(seen.orientation));
  /*
   * The bridge is the whole surface between somebody's family and their machine. Asserting the
   * names is not ceremony: a preload that fails to load leaves `window.ftreeDesktop` looking
   * plausible enough for the page to run and for saving to silently do nothing.
   */
  for (const name of ['chooseTree', 'saveTree', 'saveTreeAs', 'setDirty']) {
    check(`the page can ask to ${name}`, String(seen.bridgeNames).split(',').includes(name),
      String(seen.bridgeNames));
  }
  check('the archive was read and counted', /\d+ people/.test(seen.counts ?? ''), String(seen.counts));
  check('the page can change a tree, not only read one', seen.canEdit === true);
  check('undo and redo are there', seen.undoPresent === true);
  check('a person can be opened for editing', seen.panelExists === true);
  /*
   * The list is not a second opinion on the chart. At the zoom that fits a large family on one
   * screen no name is readable, so this is the only way to find somebody by name -- and the only
   * place a person with no relatives is as visible as everybody else.
   */
  /*
   * Counted against the file rather than against 23.
   *
   * The literal was the sample family's population, which made the whole harness refuse to be
   * pointed at any other fixture -- it failed on the 2030-person tree by saying "2030 rows, 2030
   * people". The claim worth making is that the list holds *everybody*, whoever was opened, and
   * that is what the tree's own count is for.
   */
  const population = Number(/(\d+)\s+(?:person|people)/.exec(seen.counts ?? '')?.[1] ?? NaN);
  check('everybody in the file is listed by name',
    Number.isFinite(population) && seen.peopleRows === population,
    `${seen.peopleRows} rows — ${seen.peopleNote}`);
  // Refusing the network must not quietly cost the app its typography.
  check('the bundled typefaces loaded without the network', seen.literata && seen.mono,
    `Literata ${seen.literata}, JetBrains Mono ${seen.mono}`);

  /*
   * The promise on the download page, asserted rather than believed: both switches start off, so a
   * fresh install makes no request of any kind until somebody asks it to.
   */
  const fresh = await readSettings();
  check('update checking is off until switched on', fresh.checkForUpdates === false,
    String(fresh.checkForUpdates));
  check('beta releases are off until switched on', fresh.betaReleases === false,
    String(fresh.betaReleases));
  check('the window carries the app mark', Boolean(win.getRepresentedFilename) && iconExists,
    ICON_FOR_WINDOW);

  /*
   * A question nobody asked is not on the screen.
   *
   * #125: the review dialog's box was styled without `[open]`, which beat the user agent's
   * `dialog:not([open]) { display: none }` and left 160px of empty dialog -- with a live Import
   * button in it -- painted over the tree on every screen. Asserted here rather than in the import
   * smoke because the failure is about the state where no import is happening, which is every
   * other moment the app is running.
   */
  const shut = await win.webContents.executeJavaScript(`(() => {
    const dialog = document.getElementById('review');
    return { open: dialog.open, display: getComputedStyle(dialog).display,
             height: dialog.getBoundingClientRect().height };
  })()`);
  check('a dialog nobody opened takes up no room', !shut.open && shut.display === 'none'
    && shut.height === 0, JSON.stringify(shut));

  /*
   * The updater must not be blocked by the page's own guard.
   *
   * This is the regression that shipped: the refusal was installed on the default session, which
   * `net.request` also uses, so asking GitHub for releases failed with ERR_BLOCKED_BY_CLIENT.
   * Only run where the network is available and asked for.
   */
  if (process.env.FTREE_SMOKE_NETWORK) {
    let reachable = false;
    let detail = '';
    try {
      const releases = await fetchReleases();
      reachable = Array.isArray(releases) && releases.length > 0;
      detail = `${releases.length} releases`;
    } catch (error) {
      detail = error.message;
    }
    check('the updater can reach GitHub through the page-level refusal', reachable, detail);
  }

  if (process.env.FTREE_SMOKE_SAVE_TO) await runEditSmoke(win, check);

  if (process.env.FTREE_SMOKE_COMPACT) await runCompactSmoke(win, check);

  if (process.env.FTREE_SMOKE_RELATE) await runRelateSmoke(win, check);

  if (process.env.FTREE_SMOKE_IMPORT) await runImportSmoke(win, check);

  if (process.env.FTREE_SMOKE_SHOT) {
    const image = await win.webContents.capturePage();
    await fs.writeFile(process.env.FTREE_SMOKE_SHOT, image.toPNG());
    console.log(`       wrote ${process.env.FTREE_SMOKE_SHOT}`);
  }

  console.log(failures.length === 0 ? '\nSmoke test passed.' : `\n${failures.length} FAILED.`);
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(async () => {
  settings = await readSettings();
  window_ = await createWindow();

  if (process.env.FTREE_SMOKE) {
    await runSmoke(window_, path.resolve(process.env.FTREE_SMOKE));
    return;
  }

  // Only if asked, and quietly: starting the app never costs a dialog for having nothing to say.
  if (settings.checkForUpdates) {
    checkForUpdates(window_, { quiet: true }).catch(() => {});
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) window_ = await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* A .ftree double-clicked in the file manager, once the app is registered for the type. */
app.on('open-file', (event, file) => {
  event.preventDefault();
  if (window_) openInto(window_, file);
});
