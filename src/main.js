/*
 * archivo — offline hard-disk catalog
 * Copyright (C) 2026 Noar (just edit)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, Tray, nativeImage, powerMonitor } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const zlib   = require('zlib');
const { Service } = require('./service');
const catalogIO = require('./catalog-io');
const { buildExportHtml } = require('./export-viewer');
const { sanitizeCatalog } = require('./catalog');

// gzip level for .archivo files and HTML exports. 6 compresses as well as 9
// on catalog data (measured: same size) in half the time.
const GZIP_LEVEL = 6;
// Largest catalog we accept once decompressed. Also stops a tiny forged
// file from inflating into gigabytes (a "zip bomb") and taking the app down.
const MAX_CATALOG_BYTES = 512 * 1024 * 1024;

app.setName('Archivo Fork');
app.setPath('userData', process.env.ARCHIVO_TEST_DATA || path.join(app.getPath('appData'), 'Archivo Fork'));
let mainWindow, tray, timer, quitting = false, docFingerprint;
let service;
function emitFork(kind, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('fork:' + kind, data);
  if (kind === 'scan' && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan:progress', data);
  if (kind === 'catalog' && currentPath === data.path) docFingerprint = data.fingerprint;
  if (kind === 'status') updateTray();
}
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show(); mainWindow.focus();
}
function updateTray() {
  if (!tray || !service) return;
  const st = service.status();
  const attention = st.activity[0]?.status === 'attention';
  tray.setToolTip('Archivo Fork' + (st.busy ? ' · ' + st.busy : st.paused ? ' · Schedules paused' : attention ? ' · Action needed' : ' · Background rescans ready'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Archivo Fork', click: showWindow },
    { label: attention ? 'Action needed — open activity' : st.busy ? 'Working: ' + st.busy : 'Schedules', click: () => { showWindow(); emitFork('view', 'schedules'); } },
    { label: st.paused ? 'Resume schedules' : 'Pause schedules', click: () => { service.settings.paused = !service.settings.paused; service.save(); } },
    { label: 'Run due scans', enabled: !st.busy, click: () => service.tick().catch(console.error) },
    { type: 'separator' }, { label: 'Quit Archivo Fork', click: () => app.quit() }
  ]));
}
function requireIdle() { if (service.busy) throw Error('Wait for ' + service.busy + ' to finish, or cancel it.'); }

const REPO_URL = 'https://github.com/tannerfugal/archivo';

// ─────────────────────────────────────────────────────────────
// DOCUMENT STATE — archivo behaves like a document-based app:
// one catalog is "open" at a time, it has a file path once saved,
// and an edited flag that drives the title bar and the quit guard.
// ─────────────────────────────────────────────────────────────
let currentPath     = null;  // path of the open .archivo file (null = never saved)
let docDirty        = false; // unsaved changes?
let forceClose      = false; // set once the user has decided, so close() goes through
let rendererReady   = false;
let pendingOpenPath = null;  // file handed over by the OS before the UI was ready

// A catalog path passed on the command line (Windows/Linux double-click).
function argvCatalog(argv) {
  return (argv || []).slice(1).find(a =>
    typeof a === 'string' && /\.(archivo|json)$/i.test(a) && fs.existsSync(a)
  ) || null;
}

// Only one instance: a second double-click hands its file to the running app.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = argvCatalog(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    if (p) requestOpen(p);
  });
}

// macOS hands over double-clicked documents through this event, which can
// fire before the app is ready — so it must be registered at module level.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  requestOpen(filePath);
});

// Ask the renderer to open a file (it owns the unsaved-changes guard).
function requestOpen(filePath) {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('doc:open-request', filePath);
    mainWindow.show(); mainWindow.focus();
  } else {
    pendingOpenPath = filePath;
  }
}

// ── Update check — reads version.json hosted in the GitHub repo ──
// Never blocks startup, fails silently on any network issue.
const UPDATE_URL = 'https://raw.githubusercontent.com/tannerfugal/archivo/main/version.json';
// The update manifest is fetched from the network: its link is only honoured
// if it points at archivo's own repository on GitHub, otherwise the fixed
// Releases page is used. A tampered manifest cannot send users elsewhere.
function safeReleaseUrl(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol === 'https:' && x.hostname === 'github.com' && (x.pathname === '/tannerfugal/archivo' || x.pathname.startsWith('/tannerfugal/archivo/'))) return x.toString();
  } catch (e) {}
  return REPO_URL + '/releases';
}
// interactive = triggered from the Help menu, so report "up to date" / "failed"
// as well. The silent launch check stays silent.
function checkForUpdate(interactive) {
  if (interactive) dialog.showMessageBox(mainWindow, { message: 'Test build', detail: 'Automatic update prompts are disabled. Download test builds from your fork’s Actions page.' });
}

// ─────────────────────────────────────────────────────────────
// WINDOW
// ─────────────────────────────────────────────────────────────
function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width:    1280,
    height:   820,
    // 1100: below this, with the inspector open, the name column would have
    // to shrink under its 160 px floor to keep every column on screen.
    minWidth: 1100,
    minHeight:580,
    backgroundColor: '#0d0d11',
    // macOS: hidden inset title bar (traffic lights over our custom bar).
    // Windows/Linux: standard native frame.
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : {}),
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'build', isMac ? 'icon.icns' : 'icon.ico')
  });

  // Security: never open popups; never navigate away from the local app file.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });

  // Unsaved-changes guard. Closing the window is also what quitting does,
  // so this covers Cmd+Q / Alt+F4 / the red button in one place.
  mainWindow.on('close', (e) => {
    if (!quitting && !process.env.ARCHIVO_TEST_MODE) { e.preventDefault(); mainWindow.hide(); return; }
    if (forceClose || !docDirty) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type:      'warning',
      buttons:   ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId:  2,
      message:   `Save changes to "${docBaseName()}" before closing?`,
      detail:    "If you don't save, your changes will be lost.",
    });
    if (choice === 2) { quitting = false; return; }                       // Cancel
    if (choice === 1) { forceClose = true; mainWindow.close(); return; }  // Don't Save
    // Save: the renderer owns the catalog, so it saves then calls back.
    mainWindow.webContents.send('menu:command', { cmd: 'save-and-close' });
  });

  // A scan left running would keep walking a disk for nothing.
  mainWindow.on('closed', () => { rendererReady = false; });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  if (process.argv.includes('--background')) mainWindow.hide();
  mainWindow.webContents.once('did-finish-load', () => {
    applyDocState();
    setTimeout(() => checkForUpdate(false), 1500);
  });
}

// ── Title bar / proxy icon / edited dot ──
function docBaseName() {
  return currentPath ? path.basename(currentPath) : 'Untitled catalog';
}
function applyDocState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitle('Archivo Fork — ' + docBaseName() + (docDirty ? ' — Edited' : ''));
  if (process.platform === 'darwin') {
    try { mainWindow.setRepresentedFilename(currentPath || ''); } catch (e) {}
    try { mainWindow.setDocumentEdited(docDirty); } catch (e) {}
  }
}

app.whenReady().then(() => {
  if (!pendingOpenPath) pendingOpenPath = argvCatalog(process.argv);
  buildMenu();
  createWindow();
  if (!process.env.ARCHIVO_TEST_MODE) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'app-icon.png')).resize({ width: 18, height: 18 });
    tray = new Tray(icon); tray.on('click', showWindow); updateTray();
    timer = setInterval(() => service.tick().catch(console.error), 15000);
    powerMonitor.on('resume', () => service.tick().catch(console.error));
    setTimeout(() => service.tick().catch(console.error), 3000);
  }
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { clearInterval(timer); service.jobs.stop(); });

app.on('window-all-closed', () => {
  if (quitting || process.env.ARCHIVO_TEST_MODE) app.quit();
});
app.on('activate', () => {
  showWindow();
});

// ─────────────────────────────────────────────────────────────
// PREFERENCES — small local file for app settings (e.g. dismissed
// update notice). The catalog itself is never auto-saved here; it
// only lives in the .archivo files the user explicitly saves.
// ─────────────────────────────────────────────────────────────
const PREFS_FILE = path.join(app.getPath('userData'), 'archivo_prefs.json');

function readPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) || {}; }
  catch { return {}; }
}
function writePrefs(prefs) {
  try {
    fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs || {}, null, 2), 'utf8');
  } catch {}
  return true;
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('prefs:load', () => readPrefs());
// The interface may only set its own keys, merged into the file. It used to
// replace the whole file, which wiped the recent catalogs list every time an
// update notice was dismissed.
const RENDERER_PREF_KEYS = ['dismissedUpdateVersion'];
ipcMain.handle('prefs:save', (_, prefs) => {
  const merged = readPrefs();
  for (const k of RENDERER_PREF_KEYS) {
    if (prefs && typeof prefs[k] === 'string') merged[k] = prefs[k].slice(0, 32);
  }
  return writePrefs(merged);
});

// ── RECENT CATALOGS ──
// Kept in our own prefs file (so the welcome screen can show them) and
// mirrored into the OS list (macOS "Open Recent", Windows jump list).
const MAX_RECENTS = 10;

function getRecents() {
  const list = readPrefs().recents;
  if (!Array.isArray(list)) return [];
  return list.filter(p => typeof p === 'string' && fs.existsSync(p)).slice(0, MAX_RECENTS);
}
function addRecent(filePath) {
  if (!filePath) return;
  const prefs = readPrefs();
  const list  = (Array.isArray(prefs.recents) ? prefs.recents : []).filter(p => p !== filePath);
  list.unshift(filePath);
  prefs.recents = list.slice(0, MAX_RECENTS);
  writePrefs(prefs);
  try { app.addRecentDocument(filePath); } catch (e) {}
  buildMenu();
}
function clearRecents() {
  const prefs = readPrefs();
  prefs.recents = [];
  writePrefs(prefs);
  try { app.clearRecentDocuments(); } catch (e) {}
  buildMenu();
  return [];
}

ipcMain.handle('recents:list',  () => getRecents());
ipcMain.handle('recents:clear', () => clearRecents());

// ── DOCUMENT LIFECYCLE ──
// The renderer tells us when the catalog becomes dirty/clean and when it
// starts a new or closes the current document; we own the path and title.
ipcMain.handle('doc:set-dirty', (_, d) => { docDirty = !!d; applyDocState(); return true; });
ipcMain.handle('doc:new',   () => { requireIdle(); service.clearSession(); currentPath = null; docFingerprint = undefined; docDirty = false; applyDocState(); return true; });
ipcMain.handle('doc:close', () => { requireIdle(); service.clearSession(); currentPath = null; docFingerprint = undefined; docDirty = false; applyDocState(); return true; });

// What the menu needs to know to grey out what makes no sense right now:
// no catalog open, no disk to export, a scan running.
let docUi = { open: false, disks: 0, scanning: false };
ipcMain.handle('doc:ui-state', (_, st) => {
  const next = { open: !!(st && st.open), disks: Math.max(0, Number(st && st.disks) || 0), scanning: !!(st && st.scanning) };
  if (next.open !== docUi.open || next.disks !== docUi.disks || next.scanning !== docUi.scanning) {
    docUi = next;
    buildMenu();
  }
  return true;
});

// Called once the UI is wired: returns a file the OS asked us to open, if any.
ipcMain.handle('doc:ready', () => {
  rendererReady = true;
  const p = pendingOpenPath;
  pendingOpenPath = null;
  return p;
});

// The renderer has finished saving on the way out (or gave up).
ipcMain.handle('window:force-close', (_, ok) => {
  if (ok === false) { quitting = false; return true; }   // save failed/cancelled → stay open
  forceClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  return true;
});
ipcMain.handle('shell:external', (_, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:' && u.hostname === 'github.com') shell.openExternal(u.toString());
  } catch {}
  return true;
});

// ─────────────────────────────────────────────────────────────
// CATALOG FILES — open / save / save as
// .archivo is gzip-compressed JSON; a plain .json catalog is read
// transparently (gzip magic bytes) and written uncompressed if the
// user explicitly picks the .json filter.
// ─────────────────────────────────────────────────────────────
function defaultSaveDir() {
  try {
    const d = app.getPath('documents');
    if (d && fs.existsSync(d)) return d;
  } catch (e) {}
  return os.homedir();
}

// path optional: when given (double-click, recents, drag & drop) no dialog.
ipcMain.handle('catalog:open', async (_, filePath) => {
  requireIdle();
  let fp = filePath;
  if (!fp) {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title:      'Open archivo Catalog',
      filters:    [{ name: 'archivo Catalog', extensions: ['archivo','json','gz'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths.length) return null;
    fp = filePaths[0];
  }
  const loaded = await service.exclusive('opening catalog', () => service.jobs.run('read', { file: fp }));
  const data = loaded.data; docFingerprint = loaded.fingerprint; service.clearSession(); service.context(data);
  currentPath = fp;
  docDirty    = false;
  applyDocState();
  addRecent(fp);
  return { path: fp, data };
});

// Save in place. Returns { needsPath:true } when the catalog was never saved.
ipcMain.handle('catalog:save', async (_, catalog) => {
  if (!currentPath) return { needsPath: true };
  requireIdle();
  const clean = sanitizeCatalog(catalog);
  const written = await service.exclusive('saving catalog', () => service.jobs.run('write', { file: currentPath, data: clean, expected: docFingerprint, backups: true }));
  docFingerprint = written.fingerprint; service.context(clean);
  docDirty = false;
  applyDocState();
  addRecent(currentPath);
  return { path: currentPath };
});

ipcMain.handle('catalog:save-as', async (_, { catalog, suggestedName }) => {
  requireIdle();
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title:       'Save Archivo Fork Catalog',
    defaultPath: currentPath || path.join(defaultSaveDir(), suggestedName || 'archivo_catalog.archivo'),
    filters:     [
      { name: 'archivo Catalog (compressed)', extensions: ['archivo'] },
      { name: 'JSON (uncompressed)', extensions: ['json'] },
    ]
  });
  if (canceled || !filePath) return null;
  requireIdle();
  const clean = sanitizeCatalog(catalog);
  const written = await service.exclusive('saving catalog', () => service.jobs.run('write', { file: filePath, data: clean, expected: filePath === currentPath ? docFingerprint : undefined, backups: true }));
  service.migrate(currentPath, filePath, clean.disks); service.context(clean);
  docFingerprint = written.fingerprint; currentPath = filePath;
  docDirty    = false;
  applyDocState();
  addRecent(filePath);
  return { path: filePath };
});

// ─────────────────────────────────────────────────────────────
// VOLUMES — df (macOS) / PowerShell + wmic fallback (Windows)
// ─────────────────────────────────────────────────────────────
service = new Service({
  directory: app.getPath('userData'),
  document: () => ({ path: currentPath, dirty: docDirty, scanning: docUi.scanning }),
  emit: emitFork,
  trash: file => shell.trashItem(file),
  confirmTrash: async count => (await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['Cancel', 'Move to Trash'], defaultId: 0, cancelId: 0,
    message: 'Move ' + count + ' verified duplicate copies to Trash?', detail: 'A verified copy will be kept. Network files and files that have changed will remain untouched.' })).response === 1,
});
if (process.env.ARCHIVO_TEST_MODE) app.__archivoTestService = service;
ipcMain.handle('volumes:list', () => service.jobs.run('list'));
ipcMain.handle('volumes:info', async (_, root) => { const s = await service.jobs.run('identify', { root }); return { model:s.model,serial:s.serial,iface:s.iface }; });
ipcMain.handle('volumes:cancel-scan', () => { service.cancel(); return true; });
ipcMain.handle('volumes:scan', (_, root) => service.scan(root));
ipcMain.handle('fork:context', (_, data) => service.context(data));
ipcMain.handle('fork:status', () => ({ ...service.status(), sources: service.sourceStatus(), login: app.getLoginItemSettings().openAtLogin }));
ipcMain.handle('fork:link-scan', (_, diskId, token) => service.linkScanned(diskId, token));
ipcMain.handle('fork:resolve', (_, diskId) => service.resolve(diskId));
ipcMain.handle('fork:scan-bound', (_, diskId) => service.scan(null, service.binding(currentPath, diskId)));
ipcMain.handle('fork:locate', async (_, diskId) => {
  requireIdle();
  const choice = await dialog.showOpenDialog(mainWindow, { title: 'Locate source — select its drive or folder', properties: ['openDirectory'] });
  if (choice.canceled || !choice.filePaths.length) return null;
  const answer = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['Cancel', 'Link this source'], defaultId: 0, cancelId: 0,
    message: 'Link this folder to the selected catalog disk?', detail: choice.filePaths[0] + '\nFuture rescans will replace this catalog disk’s file list with the contents of this folder.' });
  if (answer.response !== 1) return null;
  return service.bind(diskId, choice.filePaths[0]);
});
ipcMain.handle('fork:pick-source', async () => {
  requireIdle();
  const choice = await dialog.showOpenDialog(mainWindow, { title: 'Add a drive, server share, or folder', properties: ['openDirectory'] });
  if (choice.canceled || !choice.filePaths.length) return null;
  const source = await service.jobs.run('identify', { root: choice.filePaths[0] });
  return { ...source, name: path.basename(source.root) || source.name, mount_point: source.root };
});
ipcMain.handle('fork:reveal', async (_, diskId, segments) => { const r = await service.reveal(diskId, segments); shell.showItemInFolder(r.file); return true; });
ipcMain.handle('fork:schedule-save', (_, input) => service.addSchedule(input));
ipcMain.handle('fork:schedule-action', (_, id, action) => service.scheduleAction(id, action));
ipcMain.handle('fork:schedule-run', (_, id) => service.runSchedule(id));
ipcMain.handle('fork:pause', (_, on) => { service.settings.paused = !!on; service.save(); return true; });
ipcMain.handle('fork:login', (_, on) => { if (!app.isPackaged) throw Error('Launch at login is available in the installed app.'); app.setLoginItemSettings({ openAtLogin: !!on, args: ['--background'] }); return app.getLoginItemSettings().openAtLogin; });
ipcMain.handle('fork:cancel', () => { service.cancel(); return true; });
ipcMain.handle('fork:duplicates', (_, ids, verify) => service.duplicates(ids, verify === true));
ipcMain.handle('fork:trash', (_, reportId, ids) => service.trashCopies(reportId, ids));
ipcMain.handle('fork:backups', async () => { if (!currentPath) throw Error('Save a catalog first.'); const directory = currentPath + '.backups'; await fs.promises.mkdir(directory, { recursive: true }); return shell.openPath(directory); });

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// EXPORT — CSV (plain text) and standalone HTML viewer (gzip-embedded)
// ─────────────────────────────────────────────────────────────
ipcMain.handle('export:text', async (_, { content, defaultName, filterName, extensions }) => {
  // Only plain-text formats: the interface cannot ask the main process to
  // write, say, an executable script under an innocent name.
  const ALLOWED = ['csv', 'txt'];
  const exts = (Array.isArray(extensions) ? extensions : ['txt']).filter(e => ALLOWED.includes(String(e).toLowerCase()));
  if (!exts.length || typeof content !== 'string') return null;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title:       'Export',
    defaultPath: path.join(defaultSaveDir(), path.basename(String(defaultName || 'export.' + exts[0]))),
    filters:     [{ name: String(filterName || 'File'), extensions: exts }]
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
});

ipcMain.handle('export:html', async (_, { json, defaultName }) => {
  if (typeof json !== 'string') return null;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title:       'Export as HTML',
    defaultPath: path.join(defaultSaveDir(), path.basename(String(defaultName || 'archivo_export.html'))),
    filters:     [{ name: 'HTML', extensions: ['html'] }]
  });
  if (canceled || !filePath) return null;
  // Gzip the catalog JSON and embed it as base64. The exported file's own
  // script decompresses it client-side with the browser's native
  // DecompressionStream — no bundled libraries, smallest possible output.
  const gz  = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: GZIP_LEVEL });
  fs.writeFileSync(filePath, buildExportHtml(gz.toString('base64')), 'utf8');
  return filePath;
});

// ─────────────────────────────────────────────────────────────
// SHELL
// ─────────────────────────────────────────────────────────────
// Reveal only: shows the item selected in Finder / Explorer, never opens or
// runs it. (The former shell:open channel could launch any file, and the
// interface never used it: removed.)
ipcMain.handle('shell:reveal', (_, filePath) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false;
  const p = path.normalize(filePath);
  if (!fs.existsSync(p)) return false;
  shell.showItemInFolder(p);
  return true;
});

// ─────────────────────────────────────────────────────────────
// APPLICATION MENU
// Every command is forwarded to the renderer, which owns the catalog
// and the unsaved-changes guard. Rebuilt whenever the recents change.
// ─────────────────────────────────────────────────────────────
function sendMenu(cmd, arg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:command', { cmd, arg });
  }
}

function buildMenu() {
  const isMac   = process.platform === 'darwin';
  const recents = getRecents();

  const recentItems = recents.length
    ? recents.map(p => ({
        label:   path.basename(p),
        toolTip: p,
        enabled: !docUi.scanning,
        click:   () => requestOpen(p),
      })).concat([
        { type: 'separator' },
        { label: 'Clear Menu', click: () => clearRecents() },
      ])
    : [{ label: 'No Recent Catalogs', enabled: false }];

  const template = [
    ...(isMac ? [{
      label: 'archivo',
      submenu: [
        { label: 'About archivo', click: () => sendMenu('about') },
        { label: 'Check for Updates…', click: () => checkForUpdate(true) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Catalog',   accelerator: 'CmdOrCtrl+N', enabled: !docUi.scanning, click: () => sendMenu('new') },
        { label: 'Open Catalog…', accelerator: 'CmdOrCtrl+O', enabled: !docUi.scanning, click: () => sendMenu('open') },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { label: 'Add Disk…', accelerator: 'CmdOrCtrl+D', enabled: docUi.open && !docUi.scanning, click: () => sendMenu('add-disk') },
        { type: 'separator' },
        { label: 'Save',     accelerator: 'CmdOrCtrl+S',       enabled: docUi.open, click: () => sendMenu('save') },
        { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', enabled: docUi.open, click: () => sendMenu('save-as') },
        { type: 'separator' },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', enabled: docUi.open && docUi.disks > 0, click: () => sendMenu('export') },
        { type: 'separator' },
        { label: 'Close Catalog', accelerator: 'Shift+CmdOrCtrl+W', enabled: docUi.open && !docUi.scanning, click: () => sendMenu('close-doc') },
        isMac ? { role: 'close', label: 'Close Window' } : { role: 'quit', label: 'Quit archivo' },
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Find',             accelerator: 'CmdOrCtrl+F', enabled: docUi.open, click: () => sendMenu('focus-search') },
        { label: 'Toggle Inspector', accelerator: 'CmdOrCtrl+I', enabled: docUi.open, click: () => sendMenu('toggle-inspector') },
        { type: 'separator' },
        // Reload wiped an unsaved catalog without warning (⌘R): development
        // builds only, together with the developer tools.
        ...(app.isPackaged ? [] : [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }]),
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Archivo Fork on GitHub', click: () => shell.openExternal(REPO_URL) },
        { label: 'Report an Issue',   click: () => shell.openExternal(REPO_URL + '/issues') },
        ...(isMac ? [] : [
          { type: 'separator' },
          { label: 'Check for Updates…', click: () => checkForUpdate(true) },
          { label: 'About archivo',      click: () => sendMenu('about') },
        ]),
      ]
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// For the test suite only (test/smoke.js): the app itself never imports main.js.
module.exports = { safeReleaseUrl, getService: () => service };
