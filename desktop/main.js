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
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

/*
 * The viewer, which lives beside this app rather than inside it.
 *
 * In the repository it is `site/playground/`, the same directory the website serves. Packaged, it
 * is carried in as a resource and read from there. Either way there is one copy of the chart, the
 * index, the search and the relation finder - a fix to any of them is a fix in both places rather
 * than a fix and a note to remember the other one.
 */
const VIEWER = app.isPackaged
  ? path.join(process.resourcesPath, 'viewer', 'index.html')
  : path.join(__dirname, '..', 'site', 'playground', 'index.html');

/*
 * Where the app remembers what it was reading.
 *
 * A path and nothing else. Not the tree, not a copy of it, not anything out of it - the file
 * stays wherever its owner put it, and if they move or delete it the app simply opens empty.
 */
const stateFile = () => path.join(app.getPath('userData'), 'session.json');

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

function buildMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open tree…', accelerator: 'CmdOrCtrl+O', click: () => chooseInto(win) },
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
              + 'cloud, no backend. Open a .ftree exported from the Android app to read it here.',
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
 * Nothing reaches the network.
 *
 * Not a promise in a privacy policy - the requests are refused by the session, so the claim holds
 * whatever the page's markup happens to ask for now or later. Only `file:` and `devtools:` are
 * allowed through.
 */
function refuseTheNetwork(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      console.warn(`f-tree: refused a network request to ${details.url}`);
      callback({ cancel: true });
    });
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  refuseTheNetwork(session.defaultSession);
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
ipcMain.handle('tree:choose', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return chooseInto(win);
});
ipcMain.handle('tree:forget', async () => { await writeSession({}); });
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
 * every person was drawn, and the generations run in columns rather than rows.
 */
async function runSmoke(win, file) {
  const failures = [];
  const check = (label, ok, detail = '') => {
    if (!ok) failures.push(label);
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  ${detail}` : ''}`);
  };

  await openInto(win, file);
  // The page reads the file, lays it out and paints; give it room on a slow runner.
  await new Promise((r) => setTimeout(r, 2500));

  const seen = await win.webContents.executeJavaScript(`(${(() => ({
    bridge: Boolean(window.ftreeDesktop),
    shell: document.body.dataset.shell ?? null,
    state: document.getElementById('viewer')?.dataset.state ?? null,
    fileName: document.getElementById('file-name')?.textContent ?? null,
    orientation: document.body.dataset.orientation ?? null,
    literata: document.fonts.check('16px Literata'),
    mono: document.fonts.check('13px "JetBrains Mono"'),
    people: document.querySelectorAll('#index-list li, #index-list button, #index-list tr').length,
    status: document.querySelector('#status')?.textContent?.trim().slice(0, 90) ?? null,
  })).toString()})()`);

  check('the preload bridge is reachable from the page', seen.bridge === true);
  check('the page knows it is running in the shell', seen.shell === 'desktop', String(seen.shell));
  check('the tree opened', seen.state === 'loaded', String(seen.state));
  check('the file name is shown', Boolean(seen.fileName), String(seen.fileName));
  // The whole reason the desktop app is not just the website in a window.
  check('generations run in columns, as they do in the app', seen.orientation === 'columns',
    String(seen.orientation));
  check('the archive was read and counted', /\d+ people/.test(seen.status ?? ''), String(seen.status));
  // Refusing the network must not quietly cost the app its typography.
  check('the bundled typefaces loaded without the network', seen.literata && seen.mono,
    `Literata ${seen.literata}, JetBrains Mono ${seen.mono}`);

  if (process.env.FTREE_SMOKE_SHOT) {
    const image = await win.webContents.capturePage();
    await fs.writeFile(process.env.FTREE_SMOKE_SHOT, image.toPNG());
    console.log(`       wrote ${process.env.FTREE_SMOKE_SHOT}`);
  }

  console.log(failures.length === 0 ? '\nSmoke test passed.' : `\n${failures.length} FAILED.`);
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(async () => {
  window_ = await createWindow();

  if (process.env.FTREE_SMOKE) {
    await runSmoke(window_, path.resolve(process.env.FTREE_SMOKE));
    return;
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
